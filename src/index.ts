import { env } from './config.js';
import { closeDatabase, events, importLegacyDatabase } from './db.js';
import { client, startBot } from './bot/client.js';
import { createServer } from './web/server.js';

for (const path of env.legacyDatabasePaths) importLegacyDatabase(path);

const pruned = events.prune(env.eventRetentionDays);
if (pruned) console.log(`[db] Pruned ${pruned} old activity events`);
setInterval(() => events.prune(env.eventRetentionDays), 86_400_000).unref();

const server = createServer().listen(env.port, () => {
  console.log(`[web] Activity server listening on :${env.port}`);
});

await startBot();

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  console.log(`[ryze] ${signal} received, shutting down`);
  server.close();
  await client.destroy();
  closeDatabase();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
