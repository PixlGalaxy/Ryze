import {
  OverwriteType,
  PermissionFlagsBits,
  type GuildMember,
  type VoiceBasedChannel,
} from 'discord.js';
import { events, getSettings, tempChannels, userSettings } from '../db.js';
import { getAccess } from '../permissions.js';

/**
 * Actions on a temporary voice channel, shared by the /voice commands and the
 * Activity. They throw VoiceActionError with a user-facing message.
 */
export class VoiceActionError extends Error {}

function fail(message: string): never {
  throw new VoiceActionError(message);
}

/** Members can customise unless admins turned it off; owner/managers always can. */
export function canCustomize(member: GuildMember): boolean {
  return getSettings(member.guild.id).voice.allowUserCustomization || getAccess(member) !== null;
}

export function isLocked(channel: VoiceBasedChannel): boolean {
  return channel.permissionOverwrites.cache.get(channel.guild.id)?.deny.has(PermissionFlagsBits.Connect) ?? false;
}

/** Users with an explicit allow / deny on the channel (owner and bot excluded). */
export function accessLists(channel: VoiceBasedChannel, ownerId: string) {
  const permitted: string[] = [];
  const rejected: string[] = [];
  const botId = channel.client.user.id;
  for (const ow of channel.permissionOverwrites.cache.values()) {
    if (ow.type !== OverwriteType.Member || ow.id === ownerId || ow.id === botId) continue;
    if (ow.deny.has(PermissionFlagsBits.Connect)) rejected.push(ow.id);
    else if (ow.allow.has(PermissionFlagsBits.Connect)) permitted.push(ow.id);
  }
  return { permitted, rejected };
}

export async function setLocked(channel: VoiceBasedChannel, actor: GuildMember, locked: boolean): Promise<void> {
  await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { Connect: locked ? false : null });
  events.log(channel.guild.id, locked ? 'voice.locked' : 'voice.unlocked', { actorId: actor.id, targetId: channel.id });
}

export async function permitUser(channel: VoiceBasedChannel, actor: GuildMember, userId: string): Promise<void> {
  if (userId === actor.id) fail('Ya eres el dueño del canal.');
  await channel.permissionOverwrites.edit(userId, { ViewChannel: true, Connect: true }, { type: OverwriteType.Member });
  events.log(channel.guild.id, 'voice.permit', { actorId: actor.id, targetId: userId, data: { channelId: channel.id } });
}

export async function rejectUser(channel: VoiceBasedChannel, actor: GuildMember, userId: string): Promise<void> {
  if (userId === actor.id) fail('No puedes rechazarte a ti mismo.');
  if (userId === channel.client.user.id) fail('No puedes rechazar a Ryze.');
  const inside = channel.members.get(userId);
  if (inside) await inside.voice.disconnect('Ryze: rechazado por el dueño del canal').catch(() => {});
  await channel.permissionOverwrites.edit(userId, { Connect: false }, { type: OverwriteType.Member });
  events.log(channel.guild.id, 'voice.reject', { actorId: actor.id, targetId: userId, data: { channelId: channel.id } });
}

/** Removes a permit or a reject, back to the channel default. */
export async function clearUserAccess(channel: VoiceBasedChannel, actor: GuildMember, userId: string): Promise<void> {
  if (userId === actor.id || userId === channel.client.user.id) fail('No puedes cambiar ese acceso.');
  await channel.permissionOverwrites.delete(userId, 'Ryze: acceso restablecido por el dueño');
}

export async function kickUser(channel: VoiceBasedChannel, actor: GuildMember, userId: string): Promise<void> {
  if (userId === actor.id) fail('No puedes expulsarte a ti mismo.');
  const inside = channel.members.get(userId);
  if (!inside) fail('Esa persona ya no está en el canal.');
  await inside.voice.disconnect('Ryze: expulsado por el dueño del canal');
}

export async function setLimit(channel: VoiceBasedChannel, actor: GuildMember, limit: number): Promise<void> {
  if (!canCustomize(actor)) fail('Los administradores desactivaron esta opción.');
  if (!Number.isInteger(limit) || limit < 0 || limit > 99) fail('El límite debe ser un número entre 0 y 99.');
  await channel.setUserLimit(limit);
  userSettings.setLimit(channel.guild.id, actor.id, limit);
  events.log(channel.guild.id, 'voice.limit', { actorId: actor.id, targetId: channel.id, data: { limit } });
}

/**
 * Discord allows only 2 renames per channel every 10 minutes. Returns false when
 * the rename is queued by the rate limit instead of applied right away.
 */
export async function renameChannel(channel: VoiceBasedChannel, actor: GuildMember, rawName: string): Promise<boolean> {
  if (!canCustomize(actor)) fail('Los administradores desactivaron esta opción.');
  const name = rawName.trim().slice(0, 100);
  if (!name) fail('El nombre no puede estar vacío.');
  userSettings.setName(channel.guild.id, actor.id, name);
  events.log(channel.guild.id, 'voice.rename', { actorId: actor.id, targetId: channel.id, data: { name } });
  return Promise.race([
    channel.setName(name).then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000)),
  ]).catch(() => false);
}

export async function claimChannel(member: GuildMember): Promise<VoiceBasedChannel> {
  const channel = member.voice.channel;
  if (!channel) fail('No estás en un canal de voz.');
  const temp = tempChannels.get(channel.id);
  if (!temp) fail('Ese canal no es un canal temporal de Ryze.');
  if (temp.ownerId === member.id) fail('Ya eres el dueño de este canal.');
  if (channel.members.has(temp.ownerId)) fail(`Este canal ya es de <@${temp.ownerId}>.`);
  if (tempChannels.byOwner(member.guild.id, member.id)) fail('Ya tienes otro canal temporal.');
  tempChannels.setOwner(channel.id, member.id);
  await channel.permissionOverwrites
    .edit(member.id, { ViewChannel: true, Connect: true }, { type: OverwriteType.Member })
    .catch(() => {});
  events.log(member.guild.id, 'voice.claimed', { actorId: member.id, targetId: channel.id, data: { previousOwner: temp.ownerId } });
  return channel;
}

export async function transferChannel(channel: VoiceBasedChannel, actor: GuildMember, userId: string): Promise<void> {
  const target = channel.members.get(userId);
  if (!target) fail('Solo puedes transferir el canal a alguien que esté dentro.');
  if (target.user.bot) fail('No puedes transferir el canal a un bot.');
  if (target.id === actor.id) fail('Ya eres el dueño.');
  if (tempChannels.byOwner(channel.guild.id, target.id)) fail('Esa persona ya tiene otro canal temporal.');
  tempChannels.setOwner(channel.id, target.id);
  await channel.permissionOverwrites
    .edit(target.id, { ViewChannel: true, Connect: true }, { type: OverwriteType.Member })
    .catch(() => {});
  events.log(channel.guild.id, 'voice.claimed', {
    actorId: target.id,
    targetId: channel.id,
    data: { previousOwner: actor.id, transfer: true },
  });
}
