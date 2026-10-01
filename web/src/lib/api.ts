import type { ActivityEvent, AntiSpamSettings, GuildSettings, Managers, VoiceSettings } from '../../../src/settings';

export type { ActivityEvent, AntiSpamSettings, GuildSettings, Managers, VoiceSettings };

export interface UserInfo {
  id: string;
  name: string;
  avatar: string;
  username?: string;
}

export interface ChannelInfo {
  id: string;
  name: string;
  type: 'category' | 'voice' | 'text';
  parentId: string | null;
  position: number;
}

export interface RoleInfo {
  id: string;
  name: string;
  color: string;
  managed: boolean;
}

export interface GuildData {
  guild: { id: string; name: string; icon: string | null; ownerId: string };
  me: { id: string; access: 'owner' | 'manager' };
  settings: GuildSettings;
  channels: ChannelInfo[];
  roles: RoleInfo[];
  users: Record<string, UserInfo>;
  warnings: string[];
}

export type Access = 'owner' | 'manager' | null;

export interface AuthResult {
  accessToken: string;
  user: { id: string; name: string };
  access: Access;
  session?: string;
  reason?: 'no_guild' | 'bot_not_in_guild' | 'not_member';
}

export interface ChannelState {
  id: string;
  name: string;
  limit: number;
  bitrateKbps: number;
  locked: boolean;
  createdAt: number;
  ownerId: string;
  members: (UserInfo & { bot: boolean })[];
  permitted: UserInfo[];
  rejected: UserInfo[];
}

export interface MeData {
  user: UserInfo;
  access: Access;
  guild: { id: string; name: string; icon: string | null };
  canCustomize: boolean;
  lobby: { id: string; name: string } | null;
  inVoice: { id: string; name: string; isLobby: boolean } | null;
  preferences: { channelName: string | null; channelLimit: number | null };
  channel: ChannelState | null;
  claimable: { id: string; name: string; ownerId: string } | null;
}

export interface EventsPage {
  events: ActivityEvent[];
  users: Record<string, UserInfo>;
  currentlyTimedOut: string[];
}

export interface TempChannelInfo {
  channelId: string;
  ownerId: string;
  createdAt: number;
  name: string;
  members: number;
  limit: number;
  locked: boolean;
}

let session: string | null = null;
export function setSession(token: string) {
  session = token;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Error ${response.status}`);
  return data as T;
}
