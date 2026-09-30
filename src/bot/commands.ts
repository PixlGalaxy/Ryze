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
  .setDescription('Gestiona tu canal de voz temporal')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('lock').setDescription('Bloquea tu canal: solo entran los permitidos'))
  .addSubcommand((s) => s.setName('unlock').setDescription('Desbloquea tu canal'))
  .addSubcommand((s) =>
    s
      .setName('permit')
      .setDescription('Permite a alguien entrar a tu canal')
      .addUserOption((o) => o.setName('usuario').setDescription('Usuario').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('reject')
      .setDescription('Quita el acceso a alguien y lo saca de tu canal')
      .addUserOption((o) => o.setName('usuario').setDescription('Usuario').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('limit')
      .setDescription('Cambia el límite de usuarios (0 = sin límite)')
      .addIntegerOption((o) =>
        o.setName('numero').setDescription('0 a 99').setMinValue(0).setMaxValue(99).setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('name')
      .setDescription('Cambia el nombre de tu canal')
      .addStringOption((o) =>
        o.setName('nombre').setDescription('Nuevo nombre').setMinLength(1).setMaxLength(100).setRequired(true),
      ),
  )
  .addSubcommand((s) => s.setName('claim').setDescription('Reclama el canal si su dueño se fue'))
  .addSubcommand((s) =>
    s
      .setName('setup')
      .setDescription('(Admin) Crea la categoría y el canal "Join to Create"')
      .addStringOption((o) =>
        o.setName('categoria').setDescription('Nombre de la categoría').setMaxLength(100).setRequired(false),
      )
      .addStringOption((o) =>
        o.setName('canal').setDescription('Nombre del canal lobby').setMaxLength(100).setRequired(false),
      ),
  );

const helpCommand = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Muestra los comandos de Ryze')
  .setContexts(InteractionContextType.Guild);

const panelCommand = new SlashCommandBuilder()
  .setName('panel')
  .setDescription('Abre el panel de Ryze: gestiona tu canal (y la configuración si eres admin)')
  .setContexts(InteractionContextType.Guild);

/**
 * Entry Point command: the "Launch" button of the Activity in Discord's app launcher.
 * Discord creates one automatically when Activities are enabled; a bulk overwrite
 * must include it or Discord rejects the request.
 */
const entryPointCommand = {
  name: 'launch',
  description: 'Abre el panel de Ryze',
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
      return void (await reply(interaction, 'Ahora eres el dueño del canal. 👑'));
    }

    const channel = ownedChannel(member);
    if (!channel) {
      return void (await reply(interaction, 'No tienes un canal temporal. Entra al canal lobby para crear uno.'));
    }

    switch (sub) {
      case 'lock':
        await setLocked(channel, member, true);
        return void (await reply(interaction, 'Canal bloqueado. 🔒'));
      case 'unlock':
        await setLocked(channel, member, false);
        return void (await reply(interaction, 'Canal desbloqueado. 🔓'));
      case 'permit': {
        const user = interaction.options.getUser('usuario', true);
        await permitUser(channel, member, user.id);
        return void (await reply(interaction, `${user} ahora puede entrar a tu canal. ✅`));
      }
      case 'reject': {
        const user = interaction.options.getUser('usuario', true);
        await rejectUser(channel, member, user.id);
        return void (await reply(interaction, `${user} ya no puede entrar a tu canal. ❌`));
      }
      case 'limit': {
        const limit = interaction.options.getInteger('numero', true);
        await setLimit(channel, member, limit);
        return void (await reply(interaction, limit ? `Límite cambiado a ${limit}.` : 'Límite quitado.'));
      }
      case 'name': {
        const name = interaction.options.getString('nombre', true);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const renamed = await renameChannel(channel, member, name);
        await interaction.editReply(
          renamed
            ? `Nombre cambiado a **${name.trim()}**.`
            : `Guardado. Discord limita los cambios de nombre (2 cada 10 min), se aplicará en breve: **${name.trim()}**.`,
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
    return void (await reply(interaction, 'Solo el dueño del servidor o los managers de Ryze pueden hacer esto.'));
  }
  const categoryName = interaction.options.getString('categoria') ?? 'Voice Channels';
  const channelName = interaction.options.getString('canal') ?? '➕ Join to Create';
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
    content: `¡Listo! Entra a ${lobby} para crear tu canal. Puedes ajustar todo lo demás desde el panel.`,
    components: [openActivityRow()],
  });
}

async function handleHelp(interaction: ChatInputCommandInteraction<'cached'>): Promise<void> {
  const embed = new EmbedBuilder()
    .setTitle('Ryze · Ayuda')
    .setColor(0xff7b00)
    .setDescription('Entra al canal **Join to Create** y Ryze te crea un canal de voz propio, que se borra cuando queda vacío.')
    .addFields(
      { name: '/voice lock · /voice unlock', value: 'Bloquea o desbloquea tu canal.' },
      { name: '/voice permit @usuario', value: 'Deja entrar a alguien aunque esté bloqueado.' },
      { name: '/voice reject @usuario', value: 'Saca a alguien y le quita el acceso.' },
      { name: '/voice limit <n>', value: 'Límite de usuarios (0 = sin límite).' },
      { name: '/voice name <nombre>', value: 'Cambia el nombre (se recuerda para la próxima vez).' },
      { name: '/voice claim', value: 'Quédate con el canal si su dueño se fue.' },
      { name: 'Panel', value: '`/panel` o **Activities → Ryze** abre el panel: gestiona tu canal desde ahí. Los admins además ven **Configurar Ryze**.' },
      { name: 'Administración', value: '`/voice setup` crea la categoría y el canal lobby.' },
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
      await interaction.reply({ content: 'Ryze solo funciona dentro de servidores.', flags: MessageFlags.Ephemeral });
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
      const content = 'Algo salió mal. Revisa que Ryze tenga los permisos necesarios.';
      if (interaction.deferred || interaction.replied) await interaction.editReply({ content }).catch(() => {});
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  }
}

