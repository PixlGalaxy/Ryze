import { Router, type NextFunction, type Request, type Response } from 'express';
import type { GuildMember, VoiceBasedChannel } from 'discord.js';
import { z } from 'zod';
import { createFor, ownedChannel } from '../bot/tempChannels.js';
import {
  VoiceActionError,
  accessLists,
  canCustomize,
  claimChannel,
  clearUserAccess,
  isLocked,
  kickUser,
  permitUser,
  rejectUser,
  renameChannel,
  setLimit,
  setLocked,
  transferChannel,
} from '../bot/voiceActions.js';
import { getSettings, tempChannels, userSettings } from '../db.js';
import { HttpError, type AuthedRequest } from './auth.js';
import { resolveUsers } from './users.js';

/**
 * Routes for every server member: manage *their own* temporary voice channel
 * from the Activity. Mounted under /api/me after requireSession.
 */

type Handler = (req: AuthedRequest, res: Response) => Promise<unknown>;
const route =
  (handler: Handler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    handler(req as AuthedRequest, res).catch((error: unknown) =>
      next(error instanceof VoiceActionError ? new HttpError(400, error.message) : error),
    );
  };

const snowflake = z.string().regex(/^\d{17,20}$/);

async function channelState(channel: VoiceBasedChannel, ownerId: string) {
  const { permitted, rejected } = accessLists(channel, ownerId);
  const memberIds = [...channel.members.keys()];
  const users = await resolveUsers(channel.guild, [...memberIds, ...permitted, ...rejected]);
  const temp = tempChannels.get(channel.id);
  return {
    id: channel.id,
    name: channel.name,
    limit: channel.userLimit,
    bitrateKbps: Math.round(channel.bitrate / 1000),
    locked: isLocked(channel),
    createdAt: temp?.createdAt ?? channel.createdTimestamp,
    ownerId,
    members: memberIds.map((id) => ({ ...users[id]!, bot: channel.members.get(id)?.user.bot ?? false })).filter((u) => u.id),
    permitted: permitted.map((id) => users[id] ?? { id, name: id, avatar: '' }),
    rejected: rejected.map((id) => users[id] ?? { id, name: id, avatar: '' }),
  };
}

function requireOwned(member: GuildMember): VoiceBasedChannel {
  const channel = ownedChannel(member);
  if (!channel) throw new HttpError(404, 'No tienes un canal temporal ahora mismo.');
  return channel;
}

export function createMemberRouter(): Router {
  const router = Router();

  /** Everything the "My channel" screen needs. */
  router.get(
    '/',
    route(async (req, res) => {
      const { guild, member, access } = req.auth;
      const { voice } = getSettings(guild.id);
      const owned = ownedChannel(member);
      const current = member.voice.channel;
      const currentTemp = current ? tempChannels.get(current.id) : undefined;
      const lobby = voice.lobbyChannelId ? guild.channels.cache.get(voice.lobbyChannelId) : undefined;

      const claimable =
        !owned && current && currentTemp && !current.members.has(currentTemp.ownerId)
          ? { id: current.id, name: current.name, ownerId: currentTemp.ownerId }
          : null;

      res.json({
        user: { id: member.id, name: member.displayName, avatar: member.displayAvatarURL({ size: 64 }) },
        access,
        guild: { id: guild.id, name: guild.name, icon: guild.iconURL({ size: 64 }) },
        canCustomize: canCustomize(member),
        lobby: lobby ? { id: lobby.id, name: lobby.name } : null,
        inVoice: current ? { id: current.id, name: current.name, isLobby: current.id === voice.lobbyChannelId } : null,
        preferences: userSettings.get(guild.id, member.id) ?? { channelName: null, channelLimit: null },
        channel: owned ? await channelState(owned, member.id) : null,
        claimable,
      });
    }),
  );

  const patchBody = z.object({
    name: z.string().trim().min(1).max(100).optional(),
    limit: z.number().int().min(0).max(99).optional(),
    locked: z.boolean().optional(),
  });

  router.patch(
    '/channel',
    route(async (req, res) => {
      const { member } = req.auth;
      const channel = requireOwned(member);
      const body = patchBody.parse(req.body);
      let renamed = true;
      if (body.locked !== undefined && body.locked !== isLocked(channel)) await setLocked(channel, member, body.locked);
      if (body.limit !== undefined && body.limit !== channel.userLimit) await setLimit(channel, member, body.limit);
      if (body.name !== undefined && body.name !== channel.name) renamed = await renameChannel(channel, member, body.name);
      res.json({ renamed, channel: await channelState(channel, member.id) });
    }),
  );

  const accessBody = z.object({ userId: snowflake, mode: z.enum(['permit', 'reject', 'clear']) });

  router.post(
    '/channel/access',
    route(async (req, res) => {
      const { member } = req.auth;
      const channel = requireOwned(member);
      const { userId, mode } = accessBody.parse(req.body);
      if (mode === 'permit') await permitUser(channel, member, userId);
      else if (mode === 'reject') await rejectUser(channel, member, userId);
      else await clearUserAccess(channel, member, userId);
      res.json({ channel: await channelState(channel, member.id) });
    }),
  );

  const userBody = z.object({ userId: snowflake });

  router.post(
    '/channel/kick',
    route(async (req, res) => {
      const { member } = req.auth;
      const channel = requireOwned(member);
      await kickUser(channel, member, userBody.parse(req.body).userId);
      res.json({ channel: await channelState(channel, member.id) });
    }),
  );

  router.post(
    '/channel/transfer',
    route(async (req, res) => {
      const { member } = req.auth;
      const channel = requireOwned(member);
      await transferChannel(channel, member, userBody.parse(req.body).userId);
      res.json({ ok: true });
    }),
  );

  router.post(
    '/claim',
    route(async (req, res) => {
      const { member } = req.auth;
      const channel = await claimChannel(member);
      res.json({ channel: await channelState(channel, member.id) });
    }),
  );

  /** Creates a channel and moves the member there (they must be connected to voice). */
  router.post(
    '/create',
    route(async (req, res) => {
      const { member, guild } = req.auth;
      if (!member.voice.channel) throw new HttpError(400, 'Conéctate primero a cualquier canal de voz del servidor.');
      if (!getSettings(guild.id).voice.lobbyChannelId) throw new HttpError(400, 'Los admins todavía no configuraron Ryze en este servidor.');
      await createFor(member, { fromPanel: true });
      const channel = ownedChannel(member);
      if (!channel) throw new HttpError(429, 'No se pudo crear el canal (¿cooldown?). Inténtalo en unos segundos.');
      res.json({ channel: await channelState(channel, member.id) });
    }),
  );

  const prefsBody = z.object({
    channelName: z.string().trim().min(1).max(100).nullable(),
    channelLimit: z.number().int().min(0).max(99).nullable(),
  });

  /** Name/limit used for the member's next channels. */
  router.put(
    '/preferences',
    route(async (req, res) => {
      const { guild, member } = req.auth;
      if (!canCustomize(member)) throw new HttpError(403, 'Los administradores desactivaron la personalización.');
      const prefs = prefsBody.parse(req.body);
      userSettings.set(guild.id, member.id, prefs);
      res.json(prefs);
    }),
  );

  return router;
}
