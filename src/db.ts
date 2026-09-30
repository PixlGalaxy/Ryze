import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { env } from './config.js';
import {
  guildSettingsSchema,
  type ActivityEvent,
  type EventType,
  type GuildSettings,
} from './settings.js';

mkdirSync(dirname(env.databasePath), { recursive: true });
const db = new DatabaseSync(env.databasePath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- All per-server configuration, stored as validated JSON.
  CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id   TEXT PRIMARY KEY,
    settings   TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  -- Temporary voice channels created by the bot.
  CREATE TABLE IF NOT EXISTS temp_channels (
    channel_id TEXT PRIMARY KEY,
    guild_id   TEXT NOT NULL,
    owner_id   TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS temp_channels_owner ON temp_channels (guild_id, owner_id);

  -- Name/limit a member chose for their channel, remembered per server.
  CREATE TABLE IF NOT EXISTS user_settings (
    guild_id      TEXT NOT NULL,
    user_id       TEXT NOT NULL,
    channel_name  TEXT,
    channel_limit INTEGER,
    PRIMARY KEY (guild_id, user_id)
  );

  -- Activity log shown in the admin Activity.
  CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL,
    type       TEXT NOT NULL,
    actor_id   TEXT,
    target_id  TEXT,
    data       TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS events_guild ON events (guild_id, id DESC);
`);

// ---------------------------------------------------------------- settings

const settingsCache = new Map<string, GuildSettings>();

export function getSettings(guildId: string): GuildSettings {
  const cached = settingsCache.get(guildId);
  if (cached) return cached;
  const row = db.prepare('SELECT settings FROM guild_settings WHERE guild_id = ?').get(guildId) as
    | { settings: string }
    | undefined;
  let raw: unknown = {};
  if (row) {
    try {
      raw = JSON.parse(row.settings);
    } catch {
      raw = {};
    }
  }
  const parsed = guildSettingsSchema.safeParse(raw);
  const settings = parsed.success ? parsed.data : guildSettingsSchema.parse({});
  settingsCache.set(guildId, settings);
  return settings;
}

export function saveSettings(guildId: string, settings: GuildSettings): GuildSettings {
  const valid = guildSettingsSchema.parse(settings);
  db.prepare(
    `INSERT INTO guild_settings (guild_id, settings, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (guild_id) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at`,
  ).run(guildId, JSON.stringify(valid), Date.now());
  settingsCache.set(guildId, valid);
  return valid;
}

export function updateSettings(
  guildId: string,
  patch: (current: GuildSettings) => GuildSettings,
): GuildSettings {
  return saveSettings(guildId, patch(structuredClone(getSettings(guildId))));
}

/** Guild whose lobby channel is `channelId`, if any. */
export function isLobby(guildId: string, channelId: string | null): boolean {
  return channelId !== null && getSettings(guildId).voice.lobbyChannelId === channelId;
}

// ---------------------------------------------------------- temp channels

export interface TempChannel {
  channelId: string;
  guildId: string;
  ownerId: string;
  createdAt: number;
}

function toTempChannel(row: Record<string, unknown>): TempChannel {
  return {
    channelId: String(row.channel_id),
    guildId: String(row.guild_id),
    ownerId: String(row.owner_id),
    createdAt: Number(row.created_at),
  };
}

export const tempChannels = {
  add(channelId: string, guildId: string, ownerId: string): void {
    db.prepare(
      'INSERT OR REPLACE INTO temp_channels (channel_id, guild_id, owner_id, created_at) VALUES (?, ?, ?, ?)',
    ).run(channelId, guildId, ownerId, Date.now());
  },
  get(channelId: string): TempChannel | undefined {
    const row = db.prepare('SELECT * FROM temp_channels WHERE channel_id = ?').get(channelId);
    return row ? toTempChannel(row) : undefined;
  },
  byOwner(guildId: string, ownerId: string): TempChannel | undefined {
    const row = db
      .prepare('SELECT * FROM temp_channels WHERE guild_id = ? AND owner_id = ? ORDER BY created_at DESC')
      .get(guildId, ownerId);
    return row ? toTempChannel(row) : undefined;
  },
  byGuild(guildId: string): TempChannel[] {
    return db
      .prepare('SELECT * FROM temp_channels WHERE guild_id = ? ORDER BY created_at')
      .all(guildId)
      .map(toTempChannel);
  },
  all(): TempChannel[] {
    return db.prepare('SELECT * FROM temp_channels').all().map(toTempChannel);
  },
  setOwner(channelId: string, ownerId: string): void {
    db.prepare('UPDATE temp_channels SET owner_id = ? WHERE channel_id = ?').run(ownerId, channelId);
  },
  remove(channelId: string): void {
    db.prepare('DELETE FROM temp_channels WHERE channel_id = ?').run(channelId);
  },
};

// ---------------------------------------------------------- user settings

export interface UserSettings {
  channelName: string | null;
  channelLimit: number | null;
}

export const userSettings = {
  get(guildId: string, userId: string): UserSettings | undefined {
    const row = db
      .prepare('SELECT channel_name, channel_limit FROM user_settings WHERE guild_id = ? AND user_id = ?')
      .get(guildId, userId) as { channel_name: string | null; channel_limit: number | null } | undefined;
    return row ? { channelName: row.channel_name, channelLimit: row.channel_limit } : undefined;
  },
  setName(guildId: string, userId: string, name: string): void {
    db.prepare(
      `INSERT INTO user_settings (guild_id, user_id, channel_name) VALUES (?, ?, ?)
       ON CONFLICT (guild_id, user_id) DO UPDATE SET channel_name = excluded.channel_name`,
    ).run(guildId, userId, name);
  },
  set(guildId: string, userId: string, prefs: UserSettings): void {
    db.prepare(
      `INSERT INTO user_settings (guild_id, user_id, channel_name, channel_limit) VALUES (?, ?, ?, ?)
       ON CONFLICT (guild_id, user_id) DO UPDATE SET channel_name = excluded.channel_name, channel_limit = excluded.channel_limit`,
    ).run(guildId, userId, prefs.channelName, prefs.channelLimit);
  },
  setLimit(guildId: string, userId: string, limit: number): void {
    db.prepare(
      `INSERT INTO user_settings (guild_id, user_id, channel_limit) VALUES (?, ?, ?)
       ON CONFLICT (guild_id, user_id) DO UPDATE SET channel_limit = excluded.channel_limit`,
    ).run(guildId, userId, limit);
  },
};

// ------------------------------------------------------------------ events

type EventListener = (event: ActivityEvent) => void;
const eventListeners = new Set<EventListener>();

function toEvent(row: Record<string, unknown>): ActivityEvent {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(String(row.data)) as Record<string, unknown>;
  } catch {
    /* keep empty */
  }
  return {
    id: Number(row.id),
    guildId: String(row.guild_id),
    type: String(row.type) as EventType,
    actorId: row.actor_id == null ? null : String(row.actor_id),
    targetId: row.target_id == null ? null : String(row.target_id),
    data,
    createdAt: Number(row.created_at),
  };
}

export const events = {
  log(
    guildId: string,
    type: EventType,
    opts: { actorId?: string | null; targetId?: string | null; data?: Record<string, unknown> } = {},
  ): ActivityEvent {
    const createdAt = Date.now();
    const result = db
      .prepare(
        'INSERT INTO events (guild_id, type, actor_id, target_id, data, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(guildId, type, opts.actorId ?? null, opts.targetId ?? null, JSON.stringify(opts.data ?? {}), createdAt);
    const event: ActivityEvent = {
      id: Number(result.lastInsertRowid),
      guildId,
      type,
      actorId: opts.actorId ?? null,
      targetId: opts.targetId ?? null,
      data: opts.data ?? {},
      createdAt,
    };
    for (const listener of eventListeners) listener(event);
    return event;
  },
  get(guildId: string, id: number): ActivityEvent | undefined {
    const row = db.prepare('SELECT * FROM events WHERE guild_id = ? AND id = ?').get(guildId, id);
    return row ? toEvent(row) : undefined;
  },
  list(guildId: string, opts: { before?: number; types?: string[]; limit?: number } = {}): ActivityEvent[] {
    const where = ['guild_id = ?'];
    const params: (string | number)[] = [guildId];
    if (opts.before) {
      where.push('id < ?');
      params.push(opts.before);
    }
    if (opts.types?.length) {
      where.push(`type IN (${opts.types.map(() => '?').join(', ')})`);
      params.push(...opts.types);
    }
    params.push(Math.min(Math.max(opts.limit ?? 50, 1), 200));
    return db
      .prepare(`SELECT * FROM events WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`)
      .all(...params)
      .map(toEvent);
  },
  prune(olderThanDays: number): number {
    const cutoff = Date.now() - olderThanDays * 86_400_000;
    return Number(db.prepare('DELETE FROM events WHERE created_at < ?').run(cutoff).changes);
  },
  subscribe(listener: EventListener): () => void {
    eventListeners.add(listener);
    return () => eventListeners.delete(listener);
  },
};

// ------------------------------------------------------- legacy migration

/**
 * Imports the configuration of the old Python bot (voice.db) once.
 * Discord IDs are read as BigInt so they keep full precision.
 */
export function importLegacyDatabase(path: string): void {
  const done = db.prepare("SELECT value FROM meta WHERE key = 'legacy_imported'").get();
  if (done || !existsSync(path)) return;

  const legacy = new DatabaseSync(path, { readOnly: true });
  try {
    const tables = new Set(
      legacy
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => String(row.name)),
    );
    let imported = 0;

    if (tables.has('guild')) {
      const stmt = legacy.prepare('SELECT guildID, voiceChannelID, voiceCategoryID FROM guild');
      stmt.setReadBigInts(true);
      for (const row of stmt.all()) {
        const guildId = String(row.guildID);
        updateSettings(guildId, (s) => {
          s.voice.lobbyChannelId = row.voiceChannelID == null ? null : String(row.voiceChannelID);
          s.voice.categoryId = row.voiceCategoryID == null ? null : String(row.voiceCategoryID);
          return s;
        });
        imported++;
      }
    }

    if (tables.has('guildSettings')) {
      const stmt = legacy.prepare('SELECT guildID, channelLimit FROM guildSettings');
      stmt.setReadBigInts(true);
      for (const row of stmt.all()) {
        const limit = Math.min(Math.max(Number(row.channelLimit ?? 0), 0), 99);
        updateSettings(String(row.guildID), (s) => {
          s.voice.defaultLimit = limit;
          return s;
        });
      }
    }

    db.prepare("INSERT INTO meta (key, value) VALUES ('legacy_imported', ?)").run(new Date().toISOString());
    console.log(`[db] Imported ${imported} server(s) from legacy database ${path}`);
  } finally {
    legacy.close();
  }
}

export function closeDatabase(): void {
  db.close();
}
