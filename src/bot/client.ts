import { ActivityType, Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { env } from '../config.js';
import { onMessage } from './antispam.js';
import { onInteraction, registerCommands } from './commands.js';
import { onVoiceStateUpdate, sweepTempChannels } from './tempChannels.js';

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers, // privileged: role checks for managers and anti-spam
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // privileged: needed to read links for anti-spam
  ],
  partials: [Partials.GuildMember],
});

function logError(where: string) {
  return (error: unknown) => console.error(`[${where}]`, error);
}

client.once(Events.ClientReady, async (ready) => {
  console.log(`[bot] Connected as ${ready.user.tag} (${ready.user.id}) in ${ready.guilds.cache.size} server(s)`);
  ready.user.setPresence({
    activities: [{ name: env.presenceText, type: ActivityType.Custom, state: env.presenceText }],
    status: 'online',
  });
  await registerCommands().catch(logError('commands'));
  await sweepTempChannels(ready).catch(logError('sweep'));
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  onVoiceStateUpdate(oldState, newState).catch(logError('voice'));
});

client.on(Events.MessageCreate, (message) => {
  onMessage(message).catch(logError('antispam'));
});

client.on(Events.InteractionCreate, (interaction) => {
  onInteraction(interaction).catch(logError('interaction'));
});

client.on(Events.Error, logError('client'));

export async function startBot(): Promise<void> {
  await client.login(env.token);
}
