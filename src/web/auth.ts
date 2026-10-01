import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Guild, GuildMember } from 'discord.js';
import { client } from '../bot/client.js';
import { env } from '../config.js';
import { getAccess, type AccessLevel } from '../permissions.js';

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

interface Session {
  userId: string;
  guildId: string;
  expiresAt: number;
}

const sessions = new Map<string, Session>();

export interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

export async function exchangeCode(code: string): Promise<string> {
  const response = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.clientId,
      client_secret: env.clientSecret,
      grant_type: 'authorization_code',
      code,
    }),
  });
  if (!response.ok) {
    throw new HttpError(401, `Discord rechazó el código de inicio de sesión (${response.status})`);
  }
  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

export async function fetchDiscordUser(accessToken: string): Promise<DiscordUser> {
  const response = await fetch('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new HttpError(401, 'Token de Discord inválido');
  return (await response.json()) as DiscordUser;
}

export function createSession(userId: string, guildId: string): string {
  const token = randomBytes(32).toString('base64url');
  sessions.set(token, { userId, guildId, expiresAt: Date.now() + SESSION_TTL_MS });
  return token;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface AuthedRequest extends Request {
  auth: { guild: Guild; member: GuildMember; access: AccessLevel | null };
}

/** Checks the session; the member's access level is re-read on every request. */
export async function requireSession(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.header('authorization')?.replace(/^Bearer\s+/i, '');
    const session = token ? sessions.get(token) : undefined;
    if (!session || session.expiresAt < Date.now()) {
      if (token) sessions.delete(token);
      throw new HttpError(401, 'La sesión expiró, vuelve a abrir la Activity');
    }
    const guild = client.guilds.cache.get(session.guildId);
    if (!guild) throw new HttpError(404, 'Ryze ya no está en este servidor');
    const member = await guild.members.fetch(session.userId).catch(() => null);
    if (!member) throw new HttpError(403, 'No eres miembro de este servidor');
    (req as AuthedRequest).auth = { guild, member, access: getAccess(member) };
    next();
  } catch (error) {
    next(error);
  }
}

/** Only the server owner and Ryze managers. Use after requireSession. */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!(req as AuthedRequest).auth?.access) return next(new HttpError(403, 'Solo el dueño del servidor o los managers de Ryze'));
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) if (session.expiresAt < now) sessions.delete(token);
}, 10 * 60_000).unref();

/** Tiny fixed-window limiter for the login endpoint. */
const hits = new Map<string, { count: number; resetAt: number }>();
export function rateLimit(max: number, windowMs: number) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt < now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (++entry.count > max) return next(new HttpError(429, 'Demasiadas solicitudes, espera un momento'));
    next();
  };
}
