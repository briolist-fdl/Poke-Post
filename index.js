require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags
} = require("discord.js");

const { Pool } = require("pg");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages
  ],
  partials: [Partials.Channel]
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("railway")
    ? { rejectUnauthorized: false }
    : false
});

const VIVILLON_PATTERNS = new Set([
  "archipelago",
  "continental",
  "elegant",
  "garden",
  "high_plains",
  "icy_snow",
  "jungle",
  "marine",
  "meadow",
  "modern",
  "monsoon",
  "ocean",
  "polar",
  "river",
  "sandstorm",
  "savanna",
  "sun",
  "tundra"
]);

const INTERNATIONAL_CHANNEL_ID = process.env.INTERNATIONAL_CHANNEL_ID;
const TUNDRA_CHANNEL_ID = process.env.TUNDRA_CHANNEL_ID;

client.once(Events.ClientReady, async readyClient => {
  console.log(`Logged in as ${readyClient.user.tag}`);

  await ensureDatabaseConnection();

  if (String(process.env.BUMP_ENABLED).toLowerCase() === "true") {
    startBumpJob();
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const protectedChannels = [
    '459637573904760843',
    '1494308341977976946'
  ];

  if (!protectedChannels.includes(message.channel.id)) return;

  try {
    await message.delete();

    const warning = await message.channel.send({
      content: `<@${message.author.id}> Use \`/friendcode setup\`. Regular messages are removed.`
    });

    setTimeout(async () => {
      try {
        await warning.delete();
      } catch (err) {
        console.error('Failed to delete warning message:', err);
      }
    }, 4000);

  } catch (error) {
    console.error('Failed to moderate friend code channel message:', error);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "friendcode") {
        await handleFriendcodeCommand(interaction);
      }
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId.startsWith("copy_friend_code:")) {
        await handleCopyButton(interaction);
      }
    }
  } catch (error) {
    console.error("Interaction error:", error);

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({
        content: "Something went wrong. Please try again.",
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
    } else {
      await interaction.reply({
        content: "Something went wrong. Please try again.",
        flags: MessageFlags.Ephemeral
      }).catch(() => {});
    }
  }
});

async function handleFriendcodeCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "setup") {
    const pokemonUsername = interaction.options.getString("pokemon_username", true).trim();
    const trainerCodeInput = interaction.options.getString("trainer_code", true).trim();
    const vivillonPattern = interaction.options.getString("vivillon_pattern", true);
    const campfireUsername = interaction.options.getString("campfire_username")?.trim() || null;

    if (!VIVILLON_PATTERNS.has(vivillonPattern)) {
      return interaction.reply({
        content: "Invalid Vivillon pattern.",
        flags: MessageFlags.Ephemeral
      });
    }

    const normalizedCode = normalizeTrainerCode(trainerCodeInput);
    if (!normalizedCode) {
      return interaction.reply({
        content: "Trainer code must contain exactly 12 digits.",
        flags: MessageFlags.Ephemeral
      });
    }

    const formattedCode = formatTrainerCode(normalizedCode);
    const publicChannelId = getPublicChannelId(vivillonPattern);

    await upsertProfile({
      discordUserId: interaction.user.id,
      discordTag: interaction.user.tag,
      pokemonUsername,
      trainerCodeRaw: normalizedCode,
      trainerCodeFormatted: formattedCode,
      campfireUsername,
      vivillonPattern,
      publicChannelId
    });

    const profile = await getProfile(interaction.user.id);
    await publishOrUpdateProfile(profile, interaction.guild);

    await interaction.reply({
      content: `Saved your profile and published it in <#${publicChannelId}>.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (subcommand === "view") {
    const profile = await getProfile(interaction.user.id);

    if (!profile) {
      return interaction.reply({
        content: "You do not have a saved friend code profile yet.",
        flags: MessageFlags.Ephemeral
      });
    }

    return interaction.reply({
      content: buildProfilePreview(profile),
      flags: MessageFlags.Ephemeral
    });
  }

  if (subcommand === "delete") {
    const profile = await getProfile(interaction.user.id);

    if (!profile) {
      return interaction.reply({
        content: "You do not have a saved profile to delete.",
        flags: MessageFlags.Ephemeral
      });
    }

    await deletePublicPost(profile, interaction.guild);
    await deleteProfile(interaction.user.id);

    return interaction.reply({
      content: "Your saved profile and public post have been deleted.",
      flags: MessageFlags.Ephemeral
    });
  }

  if (subcommand === "republish") {
    const profile = await getProfile(interaction.user.id);

    if (!profile) {
      return interaction.reply({
        content: "You do not have a saved profile yet. Use `/friendcode setup` first.",
        flags: MessageFlags.Ephemeral
      });
    }

    await publishOrUpdateProfile(profile, interaction.guild);

    return interaction.reply({
      content: `Your profile has been republished in <#${profile.public_channel_id}>.`,
      flags: MessageFlags.Ephemeral
    });
  }
}

async function handleCopyButton(interaction) {
  const userId = interaction.customId.split(":")[1];
  const profile = await getProfile(userId);

  if (!profile) {
    return interaction.reply({
      content: "That profile is no longer available.",
      flags: MessageFlags.Ephemeral
    });
  }

  return interaction.reply({
    content: profile.trainer_code_formatted,
    flags: MessageFlags.Ephemeral
  });
}

function normalizeTrainerCode(input) {
  const digits = input.replace(/\D/g, "");
  return digits.length === 12 ? digits : null;
}

function formatTrainerCode(digits) {
  return digits.replace(/(\d{4})(\d{4})(\d{4})/, "$1 $2 $3");
}

function prettifyPattern(value) {
  return value
    .split("_")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function getPublicChannelId(pattern) {
  return pattern === "tundra" ? TUNDRA_CHANNEL_ID : INTERNATIONAL_CHANNEL_ID;
}

function buildPublicMessage(profile) {
  const EMOJIS = {
    pokeball: "<:pokeball:426098818560557068>",
    campfire: "<:campfire:1491036898389659678>"
  };

  const isTundra = profile.vivillon_pattern === "tundra";

  const patternText = isTundra
    ? "❄️ Tundra Trainer"
    : `🌏 ${prettifyPattern(profile.vivillon_pattern)} Trainer`;

  let header = `${patternText} | ${EMOJIS.pokeball} ${profile.pokemon_username}`;

  if (profile.campfire_username) {
    header += ` | ${EMOJIS.campfire} ${profile.campfire_username}`;
  }

  const lines = [
    header,
    "",
    profile.trainer_code_formatted
  ];

  return lines.join("\n");
}

function buildProfilePreview(profile) {
  return [
    `Pattern: ${prettifyPattern(profile.vivillon_pattern)}`,
    `Pokémon GO: ${profile.pokemon_username}`,
    profile.campfire_username ? `Campfire: ${profile.campfire_username}` : null,
    `Friend code: ${profile.trainer_code_formatted}`,
    `Public channel: <#${profile.public_channel_id}>`
  ].filter(Boolean).join("\n");
}

function buildButtons(profile) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`copy_friend_code:${profile.discord_user_id}`)
        .setLabel("📋 Copy friend code")
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

async function deleteDuplicatePosts(profile, guild) {
  const channel = await guild.channels.fetch(profile.public_channel_id);
  if (!channel || !channel.isTextBased()) return;

  const messages = await channel.messages.fetch({ limit: 50 });

  const duplicates = messages.filter(msg => {
    if (msg.author.id !== client.user.id) return false;
    if (msg.id === profile.public_message_id) return false;

    return msg.components?.some(row =>
      row.components?.some(component =>
        component.customId === `copy_friend_code:${profile.discord_user_id}`
      )
    );
  });

  for (const msg of duplicates.values()) {
    await msg.delete().catch(() => {});
  }
}

async function publishOrUpdateProfile(profile, guild) {
  const targetChannel = await guild.channels.fetch(profile.public_channel_id);
  if (!targetChannel || !targetChannel.isTextBased()) {
    throw new Error("Target channel not found or not text-based.");
  }

  const content = buildPublicMessage(profile);
  const components = buildButtons(profile);

  const messageId = profile.public_message_id;

  if (messageId) {
    try {
      const existingMessage = await targetChannel.messages.fetch(messageId);
      await existingMessage.edit({
        content,
        components
      });

      await deleteDuplicatePosts(profile, guild);
      await touchProfile(profile.discord_user_id);
      return;
    } catch (error) {
      console.warn("Existing message missing, will repost:", error.message);
    }
  }

  await deleteDuplicatePosts(profile, guild);

  const sentMessage = await targetChannel.send({
    content,
    components
  });

  await setPublicMessage(profile.discord_user_id, targetChannel.id, sentMessage.id);
}

async function deletePublicPost(profile, guild) {
  if (!profile.public_message_id) return;

  try {
    const channel = await guild.channels.fetch(profile.public_channel_id);
    if (!channel || !channel.isTextBased()) return;

    const message = await channel.messages.fetch(profile.public_message_id);
    await message.delete().catch(() => {});
  } catch (_) {
    // Ignore missing messages/channels
  }
}

async function deleteDuplicatePosts(profile, guild) {
  const channel = await guild.channels.fetch(profile.public_channel_id);
  if (!channel || !channel.isTextBased()) return;

  const messages = await channel.messages.fetch({ limit: 50 });

  const duplicates = messages.filter(msg => {
    if (msg.author.id !== client.user.id) return false;
    if (msg.id === profile.public_message_id) return false;

    return msg.components?.some(row =>
      row.components?.some(component =>
        component.customId === `copy_friend_code:${profile.discord_user_id}`
      )
    );
  });

  for (const msg of duplicates.values()) {
    await msg.delete().catch(() => {});
  }
}

async function ensureDatabaseConnection() {
  const client = await pool.connect();
  try {
    await client.query("SELECT 1");

    // 🔥 Auto-create table
    await client.query(`
      CREATE TABLE IF NOT EXISTS friendcode_profiles (
        discord_user_id TEXT PRIMARY KEY,
        discord_tag TEXT,
        pokemon_username TEXT NOT NULL,
        trainer_code_raw TEXT NOT NULL,
        trainer_code_formatted TEXT NOT NULL,
        campfire_username TEXT,
        vivillon_pattern TEXT NOT NULL,
        public_channel_id TEXT NOT NULL,
        public_message_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_bumped_at TIMESTAMPTZ
      );
    `);

    console.log("Database connected + table ensured.");
  } finally {
    client.release();
  }
}

async function upsertProfile(profile) {
  const query = `
    INSERT INTO friendcode_profiles (
      discord_user_id,
      discord_tag,
      pokemon_username,
      trainer_code_raw,
      trainer_code_formatted,
      campfire_username,
      vivillon_pattern,
      public_channel_id,
      updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
    ON CONFLICT (discord_user_id)
    DO UPDATE SET
      discord_tag = EXCLUDED.discord_tag,
      pokemon_username = EXCLUDED.pokemon_username,
      trainer_code_raw = EXCLUDED.trainer_code_raw,
      trainer_code_formatted = EXCLUDED.trainer_code_formatted,
      campfire_username = EXCLUDED.campfire_username,
      vivillon_pattern = EXCLUDED.vivillon_pattern,
      public_channel_id = EXCLUDED.public_channel_id,
      updated_at = NOW()
  `;

  const values = [
    profile.discordUserId,
    profile.discordTag,
    profile.pokemonUsername,
    profile.trainerCodeRaw,
    profile.trainerCodeFormatted,
    profile.campfireUsername,
    profile.vivillonPattern,
    profile.publicChannelId
  ];

  await pool.query(query, values);
}

async function getProfile(discordUserId) {
  const result = await pool.query(
    `SELECT * FROM friendcode_profiles WHERE discord_user_id = $1`,
    [discordUserId]
  );
  return result.rows[0] || null;
}

async function deleteProfile(discordUserId) {
  await pool.query(
    `DELETE FROM friendcode_profiles WHERE discord_user_id = $1`,
    [discordUserId]
  );
}

async function setPublicMessage(discordUserId, channelId, messageId) {
  await pool.query(
    `
    UPDATE friendcode_profiles
    SET public_channel_id = $2,
        public_message_id = $3,
        updated_at = NOW()
    WHERE discord_user_id = $1
    `,
    [discordUserId, channelId, messageId]
  );
}

async function touchProfile(discordUserId) {
  await pool.query(
    `
    UPDATE friendcode_profiles
    SET updated_at = NOW()
    WHERE discord_user_id = $1
    `,
    [discordUserId]
  );
}

function startBumpJob() {
  const intervalHours = Number(process.env.BUMP_INTERVAL_HOURS || 12);
  const intervalMs = intervalHours * 60 * 60 * 1000;

  console.log(`Bump job enabled. Running every ${intervalHours} hour(s).`);

  setInterval(async () => {
    try {
      await runBumpCycle();
    } catch (error) {
      console.error("Bump cycle failed:", error);
    }
  }, intervalMs);
}

async function runBumpCycle() {
  const guild = client.guilds.cache.get(process.env.DISCORD_GUILD_ID);
  if (!guild) return;

  const bumpCount = Number(process.env.BUMP_COUNT_PER_RUN || 3);
  const cooldownDays = Number(process.env.BUMP_COOLDOWN_DAYS || 7);

  const cutoff = new Date(Date.now() - cooldownDays * 24 * 60 * 60 * 1000);

  const result = await pool.query(
    `
    SELECT *
    FROM friendcode_profiles
    WHERE public_message_id IS NOT NULL
      AND (last_bumped_at IS NULL OR last_bumped_at < $1)
    ORDER BY RANDOM()
    LIMIT $2
    `,
    [cutoff.toISOString(), bumpCount]
  );

  for (const profile of result.rows) {
    await bumpProfile(profile, guild);
  }
}

async function bumpProfile(profile, guild) {
  const channel = await guild.channels.fetch(profile.public_channel_id);
  if (!channel || !channel.isTextBased()) return;

  const content = buildPublicMessage(profile);
  const components = buildButtons(profile);

  try {
    if (profile.public_message_id) {
      const oldMessage = await channel.messages.fetch(profile.public_message_id);
      await oldMessage.delete().catch(() => {});
    }
  } catch (_) {}

  const newMessage = await channel.send({ content, components });

  await pool.query(
    `
    UPDATE friendcode_profiles
    SET public_message_id = $2,
        last_bumped_at = NOW(),
        updated_at = NOW()
    WHERE discord_user_id = $1
    `,
    [profile.discord_user_id, newMessage.id]
  );
}

client.login(process.env.DISCORD_TOKEN);