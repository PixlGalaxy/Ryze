import { readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { env } from './config.js';
import { closeDatabase, events, importLegacyDatabase } from './db.js';
import { client, startBot } from './bot/client.js';
import { createServer } from './web/server.js';

for (const path of env.legacyDatabasePaths) importLegacyDatabase(path);

const pruned = events.prune(env.eventRetentionDays);
if (pruned) console.log(`[db] Pruned ${pruned} old activity events`);
setInterval(() => events.prune(env.eventRetentionDays), 86_400_000).unref();

const app = createServer();
// Optional local HTTPS: Discord desktop only loads an "Application URL Override" over HTTPS.
const server = env.httpsCert
  ? createHttpsServer({ cert: readFileSync(env.httpsCert.cert), key: readFileSync(env.httpsCert.key) }, app)
  : createHttpServer(app);
server.listen(env.port, () => {
  console.log(`[web] Activity server listening on ${env.httpsCert ? 'https' : 'http'}://localhost:${env.port}`);
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
