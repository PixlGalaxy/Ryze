import {
  ChannelType,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Interaction,
} from 'discord.js';
import { env } from '../config.js';
import { events, updateSettings } from '../db.js';
import { getAccess } from '../permissions.js';
import { OPEN_ACTIVITY_BUTTON, openActivityRow } from './alerts.js';
import { ownedChannel } from './tempChannels.js';
import {
  VoiceActionError,
  claimChannel,
  permitUser,
  rejectUser,
  renameChannel,
  setLimit,
  setLocked,
} from './voiceActions.js';

const voiceCommand = new SlashCommandBuilder()
  .setName('voice')
  .setDescription('Manage your temporary voice channel')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('lock').setDescription('Lock your channel: only permitted users can join'))
  .addSubcommand((s) => s.setName('unlock').setDescription('Unlock your channel'))
  .addSubcommand((s) =>
    s
      .setName('permit')
      .setDescription('Let someone join your channel')
      .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('reject')
      .setDescription('Remove someone\'s access and kick them from your channel')
      .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('limit')
      .setDescription('Change the user limit (0 = no limit)')
      .addIntegerOption((o) =>
        o.setName('number').setDescription('0 to 99').setMinValue(0).setMaxValue(99).setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('name')
      .setDescription('Rename your channel')
      .addStringOption((o) =>
        o.setName('name').setDescription('New name').setMinLength(1).setMaxLength(100).setRequired(true),
      ),
  )
  .addSubcommand((s) => s.setName('claim').setDescription('Claim the channel if its owner left'))
  .addSubcommand((s) =>
    s
      .setName('setup')
      .setDescription('(Admin) Create the category and the "Join to Create" channel')
      .addStringOption((o) =>
        o.setName('category').setDescription('Category name').setMaxLength(100).setRequired(false),
      )
      .addStringOption((o) =>
        o.setName('channel').setDescription('Lobby channel name').setMaxLength(100).setRequired(false),
      ),
  );

const helpCommand = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Show Ryze commands')
  .setContexts(InteractionContextType.Guild);

const panelCommand = new SlashCommandBuilder()
  .setName('panel')
  .setDescription('Open the Ryze panel: manage your channel (and the settings if you are an admin)')
  .setContexts(InteractionContextType.Guild);

/**
 * Entry Point command: the "Launch" button of the Activity in Discord's app launcher.
 * Discord creates one automatically when Activities are enabled; a bulk overwrite
 * must include it or Discord rejects the request.
 */
const entryPointCommand = {
  name: 'launch',
  description: 'Open the Ryze panel',
  type: 4, // PRIMARY_ENTRY_POINT
  handler: 2, // DISCORD_LAUNCH_ACTIVITY
  contexts: [0], // guilds only
  integration_types: [0],
};

export async function registerCommands(): Promise<void> {
  const rest = new REST().setToken(env.token);
  const body = [voiceCommand.toJSON(), helpCommand.toJSON(), panelCommand.toJSON()];
  const globalBody = env.devGuildId ? [] : body;

  if (env.devGuildId) {
    await rest.put(Routes.applicationGuildCommands(env.clientId, env.devGuildId), { body });
    console.log(`[commands] Registered ${body.length} commands in dev guild ${env.devGuildId}`);
  }

  try {
    await rest.put(Routes.applicationCommands(env.clientId), { body: [...globalBody, entryPointCommand] });
    console.log(`[commands] Registered ${globalBody.length + 1} global commands (incl. Activity entry point)`);
  } catch (error) {
    // Usually: Activities are not enabled yet in the Developer Portal.
    console.warn(
      '[commands] Could not register the Activity entry point. Enable Activities in the Developer Portal. ' +
        `Registering the other commands only. (${error instanceof Error ? error.message : error})`,
    );
    await rest.put(Routes.applicationCommands(env.clientId), { body: globalBody });
  }
}

// ------------------------------------------------------------------ handlers

function reply(interaction: ChatInputCommandInteraction, content: string) {
  return interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

async function handleVoice(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const member = interaction.member;
  const sub = interaction.options.getSubcommand();

  if (sub === 'setup') return handleSetup(interaction);

  try {
    if (sub === 'claim') {
      await claimChannel(member);
      return void (await reply(interaction, 'You now own this channel. 👑'));
    }

    const channel = ownedChannel(member);
    if (!channel) {
      return void (await reply(interaction, 'You don\'t have a temporary channel. Join the lobby channel to create one.'));
    }

    switch (sub) {
      case 'lock':
        await setLocked(channel, member, true);
        return void (await reply(interaction, 'Channel locked. 🔒'));
      case 'unlock':
        await setLocked(channel, member, false);
        return void (await reply(interaction, 'Channel unlocked. 🔓'));
      case 'permit': {
        const user = interaction.options.getUser('user', true);
        await permitUser(channel, member, user.id);
        return void (await reply(interaction, `${user} can now join your channel. ✅`));
      }
      case 'reject': {
        const user = interaction.options.getUser('user', true);
        await rejectUser(channel, member, user.id);
        return void (await reply(interaction, `${user} can no longer join your channel. ❌`));
      }
      case 'limit': {
        const limit = interaction.options.getInteger('number', true);
        await setLimit(channel, member, limit);
        return void (await reply(interaction, limit ? `Limit set to ${limit}.` : 'Limit removed.'));
      }
      case 'name': {
        const name = interaction.options.getString('name', true);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const renamed = await renameChannel(channel, member, name);
        await interaction.editReply(
          renamed
            ? `Renamed to **${name.trim()}**.`
            : `Saved. Discord limits renames (2 every 10 min), so it will apply shortly: **${name.trim()}**.`,
        );
        return;
      }
    }
  } catch (error) {
    if (!(error instanceof VoiceActionError)) throw error;
    if (interaction.deferred) await interaction.editReply(error.message);
    else await reply(interaction, error.message);
  }
}

async function handleSetup(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const { guild, member } = interaction;
  if (!getAccess(member)) {
    return void (await reply(interaction, 'Only the server owner or Ryze managers can do this.'));
  }
  const categoryName = interaction.options.getString('category') ?? 'Voice Channels';
  const channelName = interaction.options.getString('channel') ?? '➕ Join to Create';
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const category = await guild.channels.create({ name: categoryName, type: ChannelType.GuildCategory });
  const lobby = await guild.channels.create({ name: channelName, type: ChannelType.GuildVoice, parent: category });
  updateSettings(guild.id, (s) => {
    s.voice.categoryId = category.id;
    s.voice.lobbyChannelId = lobby.id;
    return s;
  });
  events.log(guild.id, 'setup', { actorId: member.id, data: { categoryId: category.id, lobbyChannelId: lobby.id } });
  await interaction.editReply({
    content: `Done! Join ${lobby} to create your channel. You can adjust everything else from the panel.`,
    components: [openActivityRow()],
  });
}

async function handleHelp(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const embed = new EmbedBuilder()
    .setTitle('Ryze · Help')
    .setColor(0xff7b00)
    .setDescription('Join the **Join to Create** channel and Ryze creates a voice channel just for you, deleted once it is empty.')
    .addFields(
      { name: '/voice lock · /voice unlock', value: 'Lock or unlock your channel.' },
      { name: '/voice permit @user', value: 'Let someone in even when the channel is locked.' },
      { name: '/voice reject @user', value: 'Kick someone and remove their access.' },
      { name: '/voice limit <n>', value: 'User limit (0 = no limit).' },
      { name: '/voice name <name>', value: 'Rename your channel (remembered for next time).' },
      { name: '/voice claim', value: 'Take over the channel if its owner left.' },
      { name: 'Panel', value: '`/panel` or **Activities → Ryze** opens the panel: manage your channel from there. Admins also see **Configure Ryze**.' },
      { name: 'Administration', value: '`/voice setup` creates the category and the lobby channel.' },
    );
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

/** Anyone can open the Activity: members manage their channel, admins also get the config. */
async function launchPanel(interaction: Interaction<'cached'>): Promise<void> {
  if ('launchActivity' in interaction && typeof interaction.launchActivity === 'function') {
    await interaction.launchActivity();
  }
}

export async function onInteraction(interaction: Interaction): Promise<void> {
  if (!interaction.inCachedGuild()) {
    if (interaction.isRepliable()) {
      await interaction.reply({ content: 'Ryze only works inside servers.', flags: MessageFlags.Ephemeral });
    }
    return;
  }
  try {
    if (interaction.isButton() && interaction.customId === OPEN_ACTIVITY_BUTTON) {
      await launchPanel(interaction);
    } else if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'voice') await handleVoice(interaction);
      else if (interaction.commandName === 'help') await handleHelp(interaction);
      else if (interaction.commandName === 'panel') await launchPanel(interaction);
    }
  } catch (error) {
    console.error('[interaction] Error:', error);
    if (interaction.isRepliable()) {
      const content = 'Something went wrong. Check that Ryze has the required permissions.';
      if (interaction.deferred || interaction.replied) await interaction.editReply({ content }).catch(() => {});
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}

