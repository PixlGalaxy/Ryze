import { PermissionFlagsBits, type GuildMember } from 'discord.js';
import { getSettings } from './db.js';

export type AccessLevel = 'owner' | 'manager';

/**
 * Who may configure Ryze in a server: the server owner, plus the users and
 * roles the owner added as managers from the Activity.
 */
export function getAccess(member: GuildMember): AccessLevel | null {
  if (member.guild.ownerId === member.id) return 'owner';
  const { managers } = getSettings(member.guild.id);
  if (managers.userIds.includes(member.id)) return 'manager';
  if (managers.roleIds.some((roleId) => member.roles.cache.has(roleId))) return 'manager';
  return null;
}

/** Members the anti-spam never acts on. */
export function isSpamExempt(member: GuildMember): boolean {
  if (getAccess(member)) return true;
  if (member.user.bot) return true;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const { antiSpam } = getSettings(member.guild.id);
  return antiSpam.exemptRoleIds.some((roleId) => member.roles.cache.has(roleId));
}
