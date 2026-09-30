import { z } from 'zod';

const snowflake = z.string().regex(/^\d{17,20}$/, 'Invalid Discord ID');

export const voiceSettingsSchema = z.object({
  /** "Join to create" channel. */
  lobbyChannelId: snowflake.nullable().default(null),
  /** Category where temporary channels are created. */
  categoryId: snowflake.nullable().default(null),
  /** Default name. Placeholders: {user}, {nick}, {count}. */
  nameTemplate: z.string().trim().min(1).max(100).default("{user}'s channel"),
  /** Default user limit, 0 = unlimited. */
  defaultLimit: z.number().int().min(0).max(99).default(0),
  /** Default bitrate in kbps; 0 = Discord default. */
  bitrateKbps: z.number().int().min(0).max(384).default(0),
  /** New channels start locked (only the owner and permitted users can join). */
  lockedByDefault: z.boolean().default(false),
  /** Members may use /voice name and /voice limit, and their choice is remembered. */
  allowUserCustomization: z.boolean().default(true),
  /** Seconds a member must wait between channel creations. */
  cooldownSeconds: z.number().int().min(0).max(600).default(15),
});

export const antiSpamSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  /** Same message in this many different channels inside the window = spam. */
  channelThreshold: z.number().int().min(2).max(25).default(3),
  windowSeconds: z.number().int().min(5).max(900).default(60),
  /** Only count duplicate messages that contain a link. */
  linksOnly: z.boolean().default(true),
  /** Text/URL fragments that are always treated as scam (case-insensitive). */
  blockedPatterns: z.array(z.string().trim().min(2).max(100)).max(100).default([
    'mrbeast',
    'mr-beast',
    'mr beast',
    'free nitro',
    'nitro for free',
    'steamcommunnity',
  ]),
  /** Only apply blocked patterns when the message has a link. */
  blockedPatternsRequireLink: z.boolean().default(true),
  timeoutMinutes: z.number().int().min(1).max(40320).default(60),
  deleteMessages: z.boolean().default(true),
  /** Channel for alerts. null = system channel / #general. */
  alertChannelId: snowflake.nullable().default(null),
  /** Mention the server owner and managers in the alert. */
  pingAdmins: z.boolean().default(true),
  /** Roles ignored by the anti-spam. */
  exemptRoleIds: z.array(snowflake).max(50).default([]),
});

export const managersSchema = z.object({
  userIds: z.array(snowflake).max(50).default([]),
  roleIds: z.array(snowflake).max(50).default([]),
});

export const guildSettingsSchema = z.object({
  voice: voiceSettingsSchema.prefault({}),
  antiSpam: antiSpamSettingsSchema.prefault({}),
  managers: managersSchema.prefault({}),
});

export type VoiceSettings = z.infer<typeof voiceSettingsSchema>;
export type AntiSpamSettings = z.infer<typeof antiSpamSettingsSchema>;
export type Managers = z.infer<typeof managersSchema>;
export type GuildSettings = z.infer<typeof guildSettingsSchema>;

export const EVENT_TYPES = [
  'setup',
  'config.voice',
  'config.antispam',
  'config.managers',
  'voice.created',
  'voice.deleted',
  'voice.claimed',
  'voice.locked',
  'voice.unlocked',
  'voice.permit',
  'voice.reject',
  'voice.rename',
  'voice.limit',
  'spam.timeout',
  'spam.timeout_failed',
  'spam.untimeout',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export interface ActivityEvent {
  id: number;
  guildId: string;
  type: EventType;
  actorId: string | null;
  targetId: string | null;
  data: Record<string, unknown>;
  createdAt: number;
}
