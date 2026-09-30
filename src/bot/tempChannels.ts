import {
  ChannelType,
  OverwriteType,
  PermissionFlagsBits,
  type Client,
  type GuildMember,
  type OverwriteResolvable,
  type VoiceBasedChannel,
  type VoiceState,
} from 'discord.js';
import { events, getSettings, tempChannels, userSettings } from '../db.js';
import { VoiceActionError } from './voiceActions.js';

const lastCreated = new Map<string, number>(); // `${guildId}:${userId}` -> timestamp
const creating = new Set<string>();

export function renderName(template: string, member: GuildMember, count: number): string {
  const name = template
    .replaceAll('{user}', member.user.globalName ?? member.user.username)
    .replaceAll('{nick}', member.displayName)
    .replaceAll('{username}', member.user.username)
    .replaceAll('{count}', String(count));
  return name.slice(0, 100) || `${member.user.username}'s channel`;
}

/**
 * Creates the member's channel and moves them into it. From the lobby, a member
 * on cooldown is DM'd and disconnected; from the Activity (`fromPanel`) we just
 * throw so the panel can show the message.
 */
export async function createFor(member: GuildMember, opts: { fromPanel?: boolean } = {}): Promise<void> {
  const guild = member.guild;
  const key = `${guild.id}:${member.id}`;
  if (creating.has(key)) return;

  const { voice } = getSettings(guild.id);

  // Already owns a channel that still exists: send them back to it.
  const existing = tempChannels.byOwner(guild.id, member.id);
  if (existing) {
    const channel = guild.channels.cache.get(existing.channelId);
    if (channel?.isVoiceBased()) {
      await member.voice.setChannel(channel).catch(() => {});
      return;
    }
    tempChannels.remove(existing.channelId);
  }

  const now = Date.now();
  const last = lastCreated.get(key) ?? 0;
  const waitMs = last + voice.cooldownSeconds * 1000 - now;
  if (waitMs > 0) {
    if (opts.fromPanel) throw new VoiceActionError(`Espera ${Math.ceil(waitMs / 1000)} s antes de crear otro canal.`);
    await member
      .send(`Estás creando canales muy rápido. Espera ${Math.ceil(waitMs / 1000)} s e inténtalo de nuevo.`)
      .catch(() => {});
    await member.voice.disconnect('Ryze cooldown').catch(() => {});
    return;
  }

  creating.add(key);
  try {
    const saved = voice.allowUserCustomization ? userSettings.get(guild.id, member.id) : undefined;
    const count = tempChannels.byGuild(guild.id).length + 1;
    const name = saved?.channelName || renderName(voice.nameTemplate, member, count);
    const limit = saved?.channelLimit || voice.defaultLimit;

    const me = guild.members.me!;
    const overwrites: OverwriteResolvable[] = [
      {
        id: me.id,
        type: OverwriteType.Member,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels],
      },
      {
        id: member.id,
        type: OverwriteType.Member,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
      },
    ];
    if (voice.lockedByDefault) {
      overwrites.push({ id: guild.roles.everyone.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.Connect] });
    }

    const category = voice.categoryId ? guild.channels.cache.get(voice.categoryId) : undefined;
    const parent = category?.type === ChannelType.GuildCategory ? category : undefined;
    const maxBitrate = guild.maximumBitrate;
    const channel = await guild.channels.create({
      name,
      type: ChannelType.GuildVoice,
      parent,
      userLimit: limit,
      bitrate: voice.bitrateKbps ? Math.min(voice.bitrateKbps * 1000, maxBitrate) : undefined,
      // Inherit the category permissions, then add ours on top.
      permissionOverwrites: [...(parent?.permissionOverwrites.cache.values() ?? []), ...overwrites],
      reason: `Ryze: canal temporal de ${member.user.tag}`,
    });
    tempChannels.add(channel.id, guild.id, member.id);
    lastCreated.set(key, now);
    events.log(guild.id, 'voice.created', {
      actorId: member.id,
      targetId: channel.id,
      data: { name, limit },
    });

    try {
      await member.voice.setChannel(channel);
    } catch {
      // Member left before we could move them: clean up right away.
      await deleteIfEmpty(channel);
    }
  } catch (error) {
    console.error(`[voice] Could not create channel in ${guild.name}:`, error);
  } finally {
    creating.delete(key);
  }
}

async function deleteIfEmpty(channel: VoiceBasedChannel): Promise<void> {
  const temp = tempChannels.get(channel.id);
  if (!temp || channel.members.size > 0) return;
  tempChannels.remove(channel.id);
  try {
    await channel.delete('Ryze: canal temporal vacío');
    events.log(channel.guild.id, 'voice.deleted', {
      targetId: channel.id,
      data: { name: channel.name, ownerId: temp.ownerId, lifetimeMs: Date.now() - temp.createdAt },
    });
  } catch (error) {
    console.error(`[voice] Could not delete channel ${channel.id}:`, error);
  }
}

export async function onVoiceStateUpdate(oldState: VoiceState, newState: VoiceState): Promise<void> {
  if (oldState.channelId === newState.channelId) return;

  if (oldState.channel) await deleteIfEmpty(oldState.channel);

  const member = newState.member;
  if (!member || member.user.bot || !newState.channelId) return;
  if (getSettings(newState.guild.id).voice.lobbyChannelId === newState.channelId) {
    await createFor(member);
  }
}

/** After a restart: forget channels that no longer exist and delete empty ones. */
export async function sweepTempChannels(client: Client): Promise<void> {
  for (const temp of tempChannels.all()) {
    const guild = client.guilds.cache.get(temp.guildId);
    if (!guild) continue;
    const channel = await guild.channels.fetch(temp.channelId).catch(() => null);
    if (!channel || !channel.isVoiceBased()) {
      tempChannels.remove(temp.channelId);
      continue;
    }
    await deleteIfEmpty(channel);
  }
}

/** The temp channel the member owns, for the /voice commands. */
export function ownedChannel(member: GuildMember): VoiceBasedChannel | null {
  const temp = tempChannels.byOwner(member.guild.id, member.id);
  if (!temp) return null;
  const channel = member.guild.channels.cache.get(temp.channelId);
  return channel?.isVoiceBased() ? channel : null;
}
