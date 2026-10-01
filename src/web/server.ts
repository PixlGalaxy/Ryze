import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import {
  ChannelType,
  PermissionFlagsBits,
  type Guild,
  type GuildBasedChannel,
} from 'discord.js';
import { z } from 'zod';
import { client } from '../bot/client.js';
import { createMemberRouter } from './member.js';
import { resolveUsers } from './users.js';
import { env } from '../config.js';
import { events, getSettings, tempChannels, updateSettings } from '../db.js';
import { getAccess } from '../permissions.js';
import {
  antiSpamSettingsSchema,
  managersSchema,
  voiceSettingsSchema,
  type ActivityEvent,
} from '../settings.js';
import {
  HttpError,
  createSession,
  exchangeCode,
  fetchDiscordUser,
  rateLimit,
  requireAdmin,
  requireSession,
  type AuthedRequest,
} from './auth.js';

type Handler = (req: AuthedRequest, res: Response) => Promise<unknown> | unknown;
const authed =
  (handler: Handler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(handler(req as AuthedRequest, res)).catch(next);
  };

function channelInfo(c: GuildBasedChannel) {
  return {
    id: c.id,
    name: c.name,
    type:
      c.type === ChannelType.GuildCategory
        ? 'category'
        : c.isVoiceBased()
          ? 'voice'
          : c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement
            ? 'text'
            : 'other',
    parentId: c.parentId,
    position: 'rawPosition' in c ? c.rawPosition : 0,
  };
}

function botPermissionWarnings(guild: Guild): string[] {
  const me = guild.members.me;
  if (!me) return [];
  const needed: [bigint, string][] = [
    [PermissionFlagsBits.ManageChannels, 'Gestionar canales'],
    [PermissionFlagsBits.ManageRoles, 'Gestionar roles (permisos de los canales)'],
    [PermissionFlagsBits.MoveMembers, 'Mover miembros'],
    [PermissionFlagsBits.ModerateMembers, 'Aislar temporalmente a miembros (timeout)'],
    [PermissionFlagsBits.ManageMessages, 'Gestionar mensajes (borrar spam)'],
    [PermissionFlagsBits.SendMessages, 'Enviar mensajes'],
  ];
  return needed.filter(([flag]) => !me.permissions.has(flag)).map(([, label]) => label);
}

function changedKeys(before: object, after: object): string[] {
  const a = before as Record<string, unknown>;
  const b = after as Record<string, unknown>;
  return Object.keys(b).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

function userIdsOf(list: ActivityEvent[]): string[] {
  const ids: string[] = [];
  for (const e of list) {
    if (e.actorId) ids.push(e.actorId);
    if (e.targetId && /^\d+$/.test(e.targetId) && e.type.startsWith('spam')) ids.push(e.targetId);
    if (e.type === 'voice.permit' || e.type === 'voice.reject') if (e.targetId) ids.push(e.targetId);
    if (typeof e.data.ownerId === 'string') ids.push(e.data.ownerId);
    if (typeof e.data.previousOwner === 'string') ids.push(e.data.previousOwner);
    if (typeof e.data.userId === 'string') ids.push(e.data.userId);
  }
  return ids;
}

export function createServer() {
  const app = express();
  app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  // --------------------------------------------------------------- public

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, bot: client.isReady() });
  });

  app.get('/api/public', (_req, res) => {
    res.json({ clientId: env.clientId });
  });

  const authBody = z.object({ code: z.string().min(1).max(200), guildId: z.string().regex(/^\d{17,20}$/).nullable() });

  app.post('/api/auth', rateLimit(20, 60_000), async (req, res, next) => {
    try {
      const { code, guildId } = authBody.parse(req.body);
      const accessToken = await exchangeCode(code);
      const user = await fetchDiscordUser(accessToken);
      const base = {
        accessToken,
        user: { id: user.id, name: user.global_name ?? user.username },
      };
      if (!guildId) return void res.json({ ...base, access: null, reason: 'no_guild' });
      const guild = client.guilds.cache.get(guildId);
      if (!guild) return void res.json({ ...base, access: null, reason: 'bot_not_in_guild' });
      const member = await guild.members.fetch(user.id).catch(() => null);
      if (!member) return void res.json({ ...base, access: null, reason: 'not_member' });
      res.json({ ...base, access: getAccess(member), session: createSession(user.id, guild.id) });
    } catch (error) {
      next(error);
    }
  });

  // -------------------------------------------------------------- authed

  app.use('/api', requireSession);
  app.use('/api/me', createMemberRouter());
  app.use(['/api/guild', '/api/settings', '/api/events', '/api/stats', '/api/voice-channels', '/api/members/:userId/untimeout'], requireAdmin);

  app.get(
    '/api/guild',
    authed(async (req, res) => {
      const { guild, access, member } = req.auth;
      const settings = getSettings(guild.id);
      const channels = [...guild.channels.cache.values()]
        .filter((c) => !c.isThread())
        .map(channelInfo)
        .filter((c) => c.type !== 'other')
        .sort((a, b) => a.position - b.position);
      const roles = [...guild.roles.cache.values()]
        .filter((r) => r.id !== guild.id)
        .sort((a, b) => b.position - a.position)
        .map((r) => ({ id: r.id, name: r.name, color: r.hexColor, managed: r.managed }));
      res.json({
        guild: { id: guild.id, name: guild.name, icon: guild.iconURL({ size: 64 }), ownerId: guild.ownerId },
        me: { id: member.id, access },
        settings,
        channels,
        roles,
        users: await resolveUsers(guild, [guild.ownerId, ...settings.managers.userIds]),
        warnings: botPermissionWarnings(guild),
      });
    }),
  );

  function assertChannel(guild: Guild, id: string | null, kind: 'voice' | 'category' | 'text', label: string) {
    if (!id) return;
    const channel = guild.channels.cache.get(id);
    if (!channel || channelInfo(channel).type !== kind) throw new HttpError(400, `${label}: canal inválido`);
  }

  app.put(
    '/api/settings/voice',
    authed((req, res) => {
      const { guild, member } = req.auth;
      const voice = voiceSettingsSchema.parse(req.body);
      assertChannel(guild, voice.lobbyChannelId, 'voice', 'Canal lobby');
      assertChannel(guild, voice.categoryId, 'category', 'Categoría');
      const before = getSettings(guild.id).voice;
      const saved = updateSettings(guild.id, (s) => ({ ...s, voice }));
      const changed = changedKeys(before, voice);
      if (changed.length) events.log(guild.id, 'config.voice', { actorId: member.id, data: { changed } });
      res.json(saved);
    }),
  );

  app.put(
    '/api/settings/antispam',
    authed((req, res) => {
      const { guild, member } = req.auth;
      const antiSpam = antiSpamSettingsSchema.parse(req.body);
      assertChannel(guild, antiSpam.alertChannelId, 'text', 'Canal de alertas');
      antiSpam.blockedPatterns = [...new Set(antiSpam.blockedPatterns.map((p) => p.toLowerCase()))];
      const before = getSettings(guild.id).antiSpam;
      const saved = updateSettings(guild.id, (s) => ({ ...s, antiSpam }));
      const changed = changedKeys(before, antiSpam);
      if (changed.length) events.log(guild.id, 'config.antispam', { actorId: member.id, data: { changed } });
      res.json(saved);
    }),
  );

  app.put(
    '/api/settings/managers',
    authed(async (req, res) => {
      const { guild, member, access } = req.auth;
      if (access !== 'owner') throw new HttpError(403, 'Solo el dueño del servidor puede cambiar los managers');
      const managers = managersSchema.parse(req.body);
      managers.userIds = [...new Set(managers.userIds)].filter((id) => id !== guild.ownerId);
      managers.roleIds = [...new Set(managers.roleIds)].filter((id) => guild.roles.cache.has(id) && id !== guild.id);
      const saved = updateSettings(guild.id, (s) => ({ ...s, managers }));
      events.log(guild.id, 'config.managers', { actorId: member.id, data: { ...managers } });
      res.json({ settings: saved, users: await resolveUsers(guild, managers.userIds) });
    }),
  );

  app.get(
    '/api/members/search',
    authed(async (req, res) => {
      const { guild } = req.auth;
      const query = String(req.query.q ?? '').trim();
      if (query.length < 2) return void res.json([]);
      const found = await guild.members.search({ query, limit: 10 });
      res.json(
        [...found.values()]
          .filter((m) => !m.user.bot)
          .map((m) => ({ id: m.id, name: m.displayName, username: m.user.username, avatar: m.displayAvatarURL({ size: 64 }) })),
      );
    }),
  );

  const EVENT_GROUPS: Record<string, string[]> = {
    spam: ['spam.timeout', 'spam.timeout_failed', 'spam.untimeout'],
    voice: ['voice.created', 'voice.deleted', 'voice.claimed', 'voice.locked', 'voice.unlocked', 'voice.permit', 'voice.reject', 'voice.rename', 'voice.limit'],
    config: ['setup', 'config.voice', 'config.antispam', 'config.managers'],
  };

  app.get(
    '/api/events',
    authed(async (req, res) => {
      const { guild } = req.auth;
      const group = String(req.query.group ?? '');
      const before = Number(req.query.before) || undefined;
      const list = events.list(guild.id, { before, types: EVENT_GROUPS[group], limit: 50 });
      const timedOut = new Set<string>();
      for (const e of list) {
        if (e.type !== 'spam.timeout' || !e.targetId) continue;
        const m = guild.members.cache.get(e.targetId);
        if (m?.isCommunicationDisabled()) timedOut.add(e.targetId);
      }
      res.json({
        events: list,
        users: await resolveUsers(guild, userIdsOf(list)),
        currentlyTimedOut: [...timedOut],
      });
    }),
  );

  app.get(
    '/api/stats',
    authed((req, res) => {
      const { guild } = req.auth;
      const dayAgo = Date.now() - 86_400_000;
      const recent = events.list(guild.id, { limit: 200 }).filter((e) => e.createdAt > dayAgo);
      res.json({
        activeChannels: tempChannels.byGuild(guild.id).length,
        spam24h: recent.filter((e) => e.type.startsWith('spam.timeout')).length,
        created24h: recent.filter((e) => e.type === 'voice.created').length,
      });
    }),
  );

  app.post(
    '/api/members/:userId/untimeout',
    authed(async (req, res) => {
      const { guild, member } = req.auth;
      const userId = String(req.params.userId);
      const target = await guild.members.fetch(userId).catch(() => null);
      if (!target) throw new HttpError(404, 'El usuario ya no está en el servidor');
      await target.timeout(null, `Ryze: timeout quitado por ${member.user.tag}`);
      events.log(guild.id, 'spam.untimeout', { actorId: member.id, targetId: userId });
      res.json({ ok: true });
    }),
  );

  app.get(
    '/api/voice-channels',
    authed(async (req, res) => {
      const { guild } = req.auth;
      const list = tempChannels.byGuild(guild.id).map((t) => {
        const found = guild.channels.cache.get(t.channelId);
        const channel = found?.isVoiceBased() ? found : undefined;
        return {
          ...t,
          name: channel?.name ?? '(borrado)',
          members: channel?.members.size ?? 0,
          limit: channel?.userLimit ?? 0,
          locked: channel?.permissionOverwrites.cache.get(guild.id)?.deny.has(PermissionFlagsBits.Connect) ?? false,
        };
      });
      res.json({ channels: list, users: await resolveUsers(guild, list.map((c) => c.ownerId)) });
    }),
  );

  app.delete(
    '/api/voice-channels/:channelId',
    authed(async (req, res) => {
      const { guild, member } = req.auth;
      const channelId = String(req.params.channelId);
      const temp = tempChannels.get(channelId);
      if (!temp || temp.guildId !== guild.id) throw new HttpError(404, 'Canal no encontrado');
      tempChannels.remove(channelId);
      const channel = guild.channels.cache.get(channelId);
      await channel?.delete(`Ryze: borrado desde el panel por ${member.user.tag}`).catch(() => {});
      events.log(guild.id, 'voice.deleted', {
        actorId: member.id,
        targetId: channelId,
        data: { name: channel?.name, ownerId: temp.ownerId, byAdmin: true },
      });
      res.json({ ok: true });
    }),
  );

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Ruta no encontrada')));

  // ------------------------------------------------------- Discord CDN proxy

  // Activities can only load resources through URL mappings, so avatars and
  // server icons are fetched through this server.
  app.get(/^\/cdn\/((?:avatars|icons|guilds|embed\/avatars)\/[\w/.-]+)$/, async (req, res, next) => {
    try {
      const path = String((req.params as Record<string, string>)[0]);
      const query = typeof req.query.size === 'string' && /^\d+$/.test(req.query.size) ? `?size=${req.query.size}` : '';
      const upstream = await fetch(`https://cdn.discordapp.com/${path}${query}`);
      if (!upstream.ok) return void res.sendStatus(upstream.status === 404 ? 404 : 502);
      res.set('Content-Type', upstream.headers.get('content-type') ?? 'image/png');
      res.set('Cache-Control', 'public, max-age=86400');
      res.send(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      next(error);
    }
  });

  // ------------------------------------------------------------- frontend

  const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
  if (existsSync(publicDir)) {
    app.use(express.static(publicDir, { index: 'index.html', maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(join(publicDir, 'index.html')));
  }

  // --------------------------------------------------------------- errors

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) {
      return void res.status(400).json({ error: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    }
    if (error instanceof HttpError) return void res.status(error.status).json({ error: error.message });
    console.error('[web]', error);
    res.status(500).json({ error: 'Error interno' });
  });

  return app;
}
