import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  type Guild,
  type GuildTextBasedChannel,
} from 'discord.js';
import { getSettings } from '../db.js';

export const OPEN_ACTIVITY_BUTTON = 'ryze:open-activity';

function canSend(guild: Guild, channel: GuildTextBasedChannel): boolean {
  const me = guild.members.me;
  if (!me) return false;
  return channel
    .permissionsFor(me)
    .has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]);
}

/**
 * Where alerts go: the configured channel, else the server's system channel,
 * else a text channel called "general", else the first channel the bot can write in.
 */
export function findAlertChannel(guild: Guild): GuildTextBasedChannel | null {
  const { alertChannelId } = getSettings(guild.id).antiSpam;
  const candidates: (GuildTextBasedChannel | null | undefined)[] = [];
  if (alertChannelId) {
    const configured = guild.channels.cache.get(alertChannelId);
    if (configured?.isTextBased()) candidates.push(configured);
  }
  candidates.push(guild.systemChannel);
  const textChannels = [...guild.channels.cache.values()]
    .filter((c): c is GuildTextBasedChannel => c.type === ChannelType.GuildText)
    .sort((a, b) => ('position' in a && 'position' in b ? a.position - b.position : 0));
  candidates.push(textChannels.find((c) => c.name.toLowerCase().includes('general')));
  candidates.push(...textChannels);
  return candidates.find((c): c is GuildTextBasedChannel => !!c && canSend(guild, c)) ?? null;
}

/** Mentions of the server owner and every manager (users and roles). */
export function adminMentions(guild: Guild): string {
  const { managers } = getSettings(guild.id);
  const mentions = new Set<string>([`<@${guild.ownerId}>`]);
  for (const id of managers.userIds) mentions.add(`<@${id}>`);
  for (const id of managers.roleIds) mentions.add(`<@&${id}>`);
  return [...mentions].join(' ');
}

export function openActivityRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(OPEN_ACTIVITY_BUTTON)
      .setLabel('Abrir panel de Ryze')
      .setEmoji('🛡️')
      .setStyle(ButtonStyle.Primary),
  );
}
