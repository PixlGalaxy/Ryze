import type { Guild } from 'discord.js';
import { client } from '../bot/client.js';

export interface UserInfo {
  id: string;
  name: string;
  avatar: string;
}

/** Display name + avatar for a set of user IDs (members first, then users). */
export async function resolveUsers(guild: Guild, ids: Iterable<string>): Promise<Record<string, UserInfo>> {
  const out: Record<string, UserInfo> = {};
  for (const id of new Set(ids)) {
    const member = guild.members.cache.get(id) ?? (await guild.members.fetch(id).catch(() => null));
    if (member) {
      out[id] = { id, name: member.displayName, avatar: member.displayAvatarURL({ size: 64 }) };
      continue;
    }
    const user = await client.users.fetch(id).catch(() => null);
    if (user) out[id] = { id, name: user.globalName ?? user.username, avatar: user.displayAvatarURL({ size: 64 }) };
  }
  return out;
}
