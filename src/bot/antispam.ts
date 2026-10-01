import {
  EmbedBuilder,
  PermissionFlagsBits,
  type GuildMember,
  type Message,
} from 'discord.js';
import { events, getSettings } from '../db.js';
import { isSpamExempt } from '../permissions.js';
import { adminMentions, findAlertChannel, openActivityRow } from './alerts.js';

interface Seen {
  channelId: string;
  messageId: string;
  fingerprint: string;
  at: number;
}

const URL_RE = /\bhttps?:\/\/[^\s<>]+|\bdiscord(?:\.gg|(?:app)?\.com\/invite)\/[^\s<>]+/gi;

/** Recent messages per `${guildId}:${userId}`. */
const recent = new Map<string, Seen[]>();
/** Members currently being punished, so a burst only triggers once. */
const handling = new Set<string>();

function extractLinks(content: string): string[] {
  return content.match(URL_RE) ?? [];
}

/** Normalised message so small changes (case, spaces, zero-width chars) still match. */
function fingerprint(message: Message): string {
  const text = message.content
    .toLowerCase()
    .replace(/[​-‏⁠﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const attachments = [...message.attachments.values()].map((a) => `${a.name}:${a.size}`).join('|');
  return `${text}#${attachments}`;
}

function matchBlockedPattern(content: string, patterns: string[]): string | null {
  const haystack = content.toLowerCase().replace(/[​-‏⁠﻿]/g, '');
  const compact = haystack.replace(/[\s._-]+/g, '');
  for (const pattern of patterns) {
    const p = pattern.toLowerCase();
    if (haystack.includes(p) || compact.includes(p.replace(/[\s._-]+/g, ''))) return pattern;
  }
  return null;
}

export async function onMessage(message: Message): Promise<void> {
  if (!message.inGuild() || message.author.bot || message.webhookId || message.system) return;
  const settings = getSettings(message.guildId).antiSpam;
  if (!settings.enabled) return;

  const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (!member || isSpamExempt(member)) return;

  const links = extractLinks(message.content);
  const key = `${message.guildId}:${member.id}`;
  const now = Date.now();

  // 1) Blocked patterns (e.g. "MrBeast giveaway" scam links): act on the first message.
  if (!settings.blockedPatternsRequireLink || links.length > 0) {
    const pattern = matchBlockedPattern(message.content, settings.blockedPatterns);
    if (pattern) {
      const fp = fingerprint(message);
      const same = pruneAndPush(key, message, now, settings.windowSeconds).filter((s) => s.fingerprint === fp);
      await punish(member, message, same, { reason: 'blocked_pattern', pattern, links });
      return;
    }
  }

  // 2) Same message in several channels within the time window.
  if (settings.linksOnly && links.length === 0 && message.attachments.size === 0) return;
  if (!message.content.trim() && message.attachments.size === 0) return;

  const seen = pruneAndPush(key, message, now, settings.windowSeconds);
  const fp = fingerprint(message);
  const same = seen.filter((s) => s.fingerprint === fp);
  const channels = new Set(same.map((s) => s.channelId));
  if (channels.size >= settings.channelThreshold) {
    await punish(member, message, same, { reason: 'cross_channel', links, channelCount: channels.size });
  }
}

function pruneAndPush(key: string, message: Message, now: number, windowSeconds: number): Seen[] {
  const list = (recent.get(key) ?? []).filter((s) => now - s.at <= windowSeconds * 1000);
  list.push({ channelId: message.channelId, messageId: message.id, fingerprint: fingerprint(message), at: now });
  recent.set(key, list.slice(-50));
  return recent.get(key)!;
}

async function punish(
  member: GuildMember,
  trigger: Message<true>,
  seen: Seen[],
  detail: { reason: 'blocked_pattern' | 'cross_channel'; pattern?: string; links: string[]; channelCount?: number },
): Promise<void> {
  const guild = member.guild;
  const key = `${guild.id}:${member.id}`;
  const settings = getSettings(guild.id).antiSpam;

  // Messages that arrive while we are already acting just get deleted.
  if (handling.has(key)) {
    if (settings.deleteMessages) await trigger.delete().catch(() => {});
    return;
  }
  handling.add(key);

  try {
    // Delete every message of the burst.
    let deleted = 0;
    if (settings.deleteMessages) {
      for (const s of seen) {
        const channel = guild.channels.cache.get(s.channelId);
        if (!channel?.isTextBased()) continue;
        const ok = await channel.messages
          .delete(s.messageId)
          .then(() => true)
          .catch(() => false);
        if (ok) deleted++;
      }
    }
    recent.delete(key);

    const reasonText =
      detail.reason === 'blocked_pattern'
        ? `Enlace/texto bloqueado ("${detail.pattern}")`
        : `Mismo mensaje en ${detail.channelCount} canales en ${settings.windowSeconds}s`;

    // Timeout.
    const me = guild.members.me;
    let timeoutError: string | null = null;
    if (!me?.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      timeoutError = 'Al bot le falta el permiso "Aislar temporalmente a miembros" (Moderate Members).';
    } else if (!member.moderatable) {
      timeoutError = 'El rol del usuario está por encima del rol del bot (o es administrador).';
    } else {
      try {
        await member.timeout(settings.timeoutMinutes * 60_000, `Ryze anti-spam: ${reasonText}`);
      } catch (error) {
        timeoutError = error instanceof Error ? error.message : String(error);
      }
    }

    const channelIds = [...new Set(seen.map((s) => s.channelId))];
    const event = events.log(guild.id, timeoutError ? 'spam.timeout_failed' : 'spam.timeout', {
      targetId: member.id,
      data: {
        reason: detail.reason,
        reasonText,
        pattern: detail.pattern ?? null,
        links: detail.links.slice(0, 10),
        content: trigger.content.slice(0, 1500),
        channelIds,
        messagesDeleted: deleted,
        timeoutMinutes: settings.timeoutMinutes,
        error: timeoutError,
        userTag: member.user.tag,
        userAvatar: member.user.displayAvatarURL({ size: 64 }),
      },
    });

    // Alert.
    const alertChannel = findAlertChannel(guild);
    if (!alertChannel) return;
    const embed = new EmbedBuilder()
      .setColor(timeoutError ? 0xf0b232 : 0xed4245)
      .setTitle(timeoutError ? '⚠️ Spam detectado (sin timeout)' : '🔇 Timeout por spam')
      .setDescription(
        timeoutError
          ? `Se detectó spam de ${member} pero **no se pudo aplicar el timeout**: ${timeoutError}`
          : `Se aplicó timeout de **${settings.timeoutMinutes} min** a ${member} por spam.`,
      )
      .addFields(
        { name: 'Motivo', value: reasonText, inline: true },
        { name: 'Mensajes borrados', value: String(deleted), inline: true },
        { name: 'Canales', value: channelIds.map((id) => `<#${id}>`).join(' ').slice(0, 1024) || '—' },
      )
      .setFooter({ text: `Evento #${event.id} · Revisa los detalles en la Activity de Ryze` })
      .setTimestamp();

    await alertChannel
      .send({
        content: settings.pingAdmins
          ? `${adminMentions(guild)} revisen la actividad desde **Activities → Ryze**.`
          : undefined,
        embeds: [embed],
        components: [openActivityRow()],
        allowedMentions: { parse: [], users: [guild.ownerId, ...getSettings(guild.id).managers.userIds], roles: getSettings(guild.id).managers.roleIds },
      })
      .catch((error) => console.error('[antispam] Could not send alert:', error));
  } finally {
    // Keep the lock a few seconds so the rest of the burst is just deleted.
    setTimeout(() => handling.delete(key), 10_000);
  }
}

// Keep memory bounded.
setInterval(() => {
  const now = Date.now();
  for (const [key, list] of recent) {
    if (list.every((s) => now - s.at > 15 * 60_000)) recent.delete(key);
  }
}, 5 * 60_000).unref();
