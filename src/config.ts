import { join, resolve } from 'node:path';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${name}. See .env.example.`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

const dataDir = resolve(optional('DATA_DIR', './appdata'));

export const env = {
  /** Bot token (Developer Portal > Bot > Token). */
  token: required('DISCORD_TOKEN'),
  /** Application ID (Developer Portal > General Information). */
  clientId: required('DISCORD_CLIENT_ID'),
  /** OAuth2 client secret, used by the Activity to exchange the login code. */
  clientSecret: required('DISCORD_CLIENT_SECRET'),
  /** HTTP port for the Activity web app and its API. */
  port: Number(optional('PORT', '3000')),
  /** Folder for everything persistent (database). /appdata in Docker. */
  dataDir,
  /** SQLite file for all bot data. */
  databasePath: join(dataDir, 'ryze.db'),
  /**
   * Old Python bot database; imported once on first start if it exists.
   * Looked up in the data folder first, then in the working directory.
   */
  legacyDatabasePaths: [join(dataDir, 'voice.db'), './voice.db'],
  /** Days of activity log to keep. */
  eventRetentionDays: Number(optional('EVENT_RETENTION_DAYS', '90')),
  /** Optional: register slash commands in this guild only (instant updates while developing). */
  devGuildId: process.env.DEV_GUILD_ID?.trim() || undefined,
  /** Bot presence text. */
  presenceText: optional('PRESENCE_TEXT', '/help · /voice'),
};
