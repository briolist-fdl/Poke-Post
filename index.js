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
      content: `<@${message.author.id}> Please use \`/post setup\` to share your friend code. Regular messages are removed, but may remain visible on your screen until refreshed.`
    });

    setTimeout(async () => {
      try {
        await warning.delete();
      } catch (err) {
        console.error('Failed to delete warning message:', err);
      }
    }, 11000);
  } catch (error) {
    console.error('Failed to moderate friend code channel message:', error);
  }
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "post") {
        await handleFriendcodeCommand(interaction);
      }
      return;
    }

    if (interaction.isModalSubmit()) {
  if (interaction.customId === "edit_profile_modal") {
    await handleEditProfileModal(interaction);
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
    const publishToFollowers =
  interaction.options.getBoolean("publish_to_followers") ?? true;

  await interaction.deferReply({
  flags: MessageFlags.Ephemeral
});

    if (!VIVILLON_PATTERNS.has(vivillonPattern)) {
      return interaction.editReply({
  content: "Invalid Vivillon pattern."
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
  additionalCodes: [],
  campfireUsername,
  vivillonPattern,
  publicChannelId,
  publishToFollowers
});

    const profile = await getProfile(interaction.user.id);
    await publishOrUpdateProfile(profile, interaction.guild);

    await interaction.editreply({
      content: `Saved your profile and published it in <#${publicChannelId}>.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

 if (subcommand === "edit") {
  const profile = await getProfile(interaction.user.id);

  if (!profile) {
    return interaction.reply({
      content: "You do not have a saved profile yet. Use `/post setup` first.",
      flags: MessageFlags.Ephemeral
    });
  }

  const modal = buildEditModal(profile);
  await interaction.showModal(modal);
  return;
}

if (subcommand === "republishing") {
  const profile = await getProfile(interaction.user.id);

  if (!profile) {
    return interaction.reply({
      content: "You do not have a saved profile yet. Use `/post setup` first.",
      flags: MessageFlags.Ephemeral
    });
  }

  const enabled = interaction.options.getBoolean("enabled", true);

  await updateRepublishingPreference(interaction.user.id, enabled);

  const updatedProfile = await getProfile(interaction.user.id);
  await publishOrUpdateProfile(updatedProfile, interaction.guild);

  return interaction.reply({
    content: enabled
      ? "Republishing is now turned on."
      : "Republishing is now turned off.",
    flags: MessageFlags.Ephemeral
  });
}

if (subcommand === "region") {
  const profile = await getProfile(interaction.user.id);

  if (!profile) {
    return interaction.reply({
      content: "You do not have a saved profile yet. Use `/post setup` first.",
      flags: MessageFlags.Ephemeral
    });
  }

  const vivillonPattern = interaction.options.getString("vivillon_pattern", true);

  if (!VIVILLON_PATTERNS.has(vivillonPattern)) {
    return interaction.reply({
      content: "Invalid Vivillon pattern.",
      flags: MessageFlags.Ephemeral
    });
  }

  const oldChannelId = profile.public_channel_id;
  const newChannelId = getPublicChannelId(vivillonPattern);

  await updateRegion(interaction.user.id, vivillonPattern, newChannelId);

  const updatedProfile = await getProfile(interaction.user.id);

  if (oldChannelId !== newChannelId) {
    await deletePublicPost(profile, interaction.guild);
    await setPublicMessage(interaction.user.id, newChannelId, null);
    updatedProfile.public_message_id = null;
  }

  await repostProfile(updatedProfile, interaction.guild);

  return interaction.reply({
    content:
      oldChannelId === newChannelId
        ? `Your region has been updated to **${prettifyPattern(vivillonPattern)}**.`
        : `Your region has been updated to **${prettifyPattern(vivillonPattern)}** and your post was moved to <#${newChannelId}>.`,
    flags: MessageFlags.Ephemeral
  });
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

  if (subcommand === "repost") {
    const profile = await getProfile(interaction.user.id);

    if (!profile) {
      return interaction.reply({
        content: "You do not have a saved profile yet. Use `/post setup` first.",
        flags: MessageFlags.Ephemeral
      });
    }

    await repostProfile(profile, interaction.guild);

    return interaction.reply({
      content: `Your profile has been reposted in <#${profile.public_channel_id}>.`,
      flags: MessageFlags.Ephemeral
    });
  }

  if (subcommand === "add-code") {
  const profile = await getProfile(interaction.user.id);

  if (!profile) {
    return interaction.reply({
      content: "You do not have a saved profile yet. Use `/post setup` first.",
      flags: MessageFlags.Ephemeral
    });
  }

  const trainerCodeInput = interaction.options.getString("trainer_code", true).trim();
  const normalizedCode = normalizeTrainerCode(trainerCodeInput);

  if (!normalizedCode) {
    return interaction.reply({
      content: "Trainer code must contain exactly 12 digits.",
      flags: MessageFlags.Ephemeral
    });
  }

  if (normalizedCode === profile.trainer_code_raw) {
    return interaction.reply({
      content: "That code is already your main friend code.",
      flags: MessageFlags.Ephemeral
    });
  }

  const existingAdditionalCodes = profile.additional_codes || [];

  if (existingAdditionalCodes.includes(normalizedCode)) {
    return interaction.reply({
      content: "That additional code is already on your profile.",
      flags: MessageFlags.Ephemeral
    });
  }

  if (existingAdditionalCodes.length >= 3) {
    return interaction.reply({
      content: "You already have the maximum of 3 additional codes.",
      flags: MessageFlags.Ephemeral
    });
  }

  const updatedAdditionalCodes = [...existingAdditionalCodes, normalizedCode];

  await updateAdditionalCodes(interaction.user.id, updatedAdditionalCodes);

  const updatedProfile = await getProfile(interaction.user.id);
  await publishOrUpdateProfile(updatedProfile, interaction.guild);

  return interaction.reply({
    content: `Added extra code: ${formatTrainerCode(normalizedCode)}`,
    flags: MessageFlags.Ephemeral
  });
}

if (subcommand === "remove-code") {
  const profile = await getProfile(interaction.user.id);

  if (!profile) {
    return interaction.reply({
      content: "You do not have a saved profile yet. Use `/post setup` first.",
      flags: MessageFlags.Ephemeral
    });
  }

  const additionalCodes = profile.additional_codes || [];

  if (additionalCodes.length === 0) {
    return interaction.reply({
      content: "You do not have any additional codes to remove.",
      flags: MessageFlags.Ephemeral
    });
  }

  const codeNumber = interaction.options.getInteger("code_number", true);
  const indexToRemove = codeNumber - 1;

  if (!additionalCodes[indexToRemove]) {
    return interaction.reply({
      content: `You do not have an additional code in slot ${codeNumber}.`,
      flags: MessageFlags.Ephemeral
    });
  }

  const removedCode = additionalCodes[indexToRemove];
  const updatedAdditionalCodes = additionalCodes.filter((_, index) => index !== indexToRemove);

  await updateAdditionalCodes(interaction.user.id, updatedAdditionalCodes);

  const updatedProfile = await getProfile(interaction.user.id);
  await publishOrUpdateProfile(updatedProfile, interaction.guild);

  return interaction.reply({
    content: `Removed extra code: ${formatTrainerCode(removedCode)}`,
    flags: MessageFlags.Ephemeral
  });
}
}

async function handleCopyButton(interaction) {
  const [, userId, codeIndexRaw] = interaction.customId.split(":");
  const codeIndex = codeIndexRaw === undefined ? 0 : Number(codeIndexRaw);

  const profile = await getProfile(userId);

  if (!profile) {
    return interaction.reply({
      content: "That profile is no longer available.",
      flags: MessageFlags.Ephemeral
    });
  }

  const allCodes = [
    profile.trainer_code_formatted,
    ...((profile.additional_codes || []).map(formatTrainerCode))
  ];

  const selectedCode = allCodes[codeIndex];

  if (!selectedCode) {
    return interaction.reply({
      content: "That friend code is no longer available.",
      flags: MessageFlags.Ephemeral
    });
  }

  return interaction.reply({
    content: selectedCode,
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

  let header = `${patternText} | ${EMOJIS.pokeball} ${profile.pokemon_username} | Discord: <@${profile.discord_user_id}>`;

  if (profile.campfire_username) {
    header += ` | ${EMOJIS.campfire} ${profile.campfire_username}`;
  }

  const allCodes = [
    profile.trainer_code_formatted,
    ...((profile.additional_codes || []).map(formatTrainerCode))
  ];

  let codeLine = allCodes.join(" | ");

  if (profile.publish_to_followers === false) {
    codeLine += " | 🔇 republishing off";
  }

  return [
    header,
    "",
    codeLine
  ].join("\n");
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
  const additionalCodes = profile.additional_codes || [];
  const allCodes = [
    profile.trainer_code_raw,
    ...additionalCodes
  ];

  return [
    new ActionRowBuilder().addComponents(
      ...allCodes.map((_, index) =>
        new ButtonBuilder()
          .setCustomId(`copy_friend_code:${profile.discord_user_id}:${index}`)
          .setLabel(index === 0 ? "📋 Copy friend code" : `📋 Copy code ${index + 1}`)
          .setStyle(ButtonStyle.Secondary)
      )
    )
  ];
}

const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

function buildEditModal(profile) {
  return new ModalBuilder()
    .setCustomId("edit_profile_modal")
    .setTitle("Edit your friend code profile")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("pokemon_username")
          .setLabel("Pokémon GO Username")
          .setStyle(TextInputStyle.Short)
          .setValue(profile.pokemon_username)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("trainer_code")
          .setLabel("Trainer Code (12 digits)")
          .setStyle(TextInputStyle.Short)
          .setValue(profile.trainer_code_formatted)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("campfire_username")
          .setLabel("Campfire Username")
          .setStyle(TextInputStyle.Short)
          .setValue(profile.campfire_username || "")
          .setRequired(false)
      )
    );
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

async function updateAdditionalCodes(discordUserId, additionalCodes) {
  await pool.query(
    `
    UPDATE friendcode_profiles
    SET additional_codes = $2,
        updated_at = NOW()
    WHERE discord_user_id = $1
    `,
    [discordUserId, additionalCodes]
  );
}

async function repostProfile(profile, guild) {
  const targetChannel = await guild.channels.fetch(profile.public_channel_id);
  if (!targetChannel || !targetChannel.isTextBased()) {
    throw new Error("Target channel not found or not text-based.");
  }

  const content = buildPublicMessage(profile);
  const components = buildButtons(profile);

  if (profile.public_message_id) {
    try {
      const oldMessage = await targetChannel.messages.fetch(profile.public_message_id);
      await oldMessage.delete().catch(() => {});
    } catch (error) {
      console.warn("Old message missing, continuing with fresh repost:", error.message);
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

async function updateRegion(discordUserId, vivillonPattern, publicChannelId) {
  await pool.query(
    `
    UPDATE friendcode_profiles
    SET vivillon_pattern = $2,
        public_channel_id = $3,
        updated_at = NOW()
    WHERE discord_user_id = $1
    `,
    [discordUserId, vivillonPattern, publicChannelId]
  );
}

async function updateRepublishingPreference(discordUserId, enabled) {
  await pool.query(
    `
    UPDATE friendcode_profiles
    SET publish_to_followers = $2,
        updated_at = NOW()
    WHERE discord_user_id = $1
    `,
    [discordUserId, enabled]
  );

  async function handleEditProfileModal(interaction) {
  const profile = await getProfile(interaction.user.id);

  if (!profile) {
    return interaction.reply({
      content: "You do not have a saved profile yet. Use `/post setup` first.",
      flags: MessageFlags.Ephemeral
    });
  }

  const pokemonUsername = interaction.fields
    .getTextInputValue("pokemon_username")
    .trim();

  const trainerCodeInput = interaction.fields
    .getTextInputValue("trainer_code")
    .trim();

  const campfireRaw = interaction.fields
    .getTextInputValue("campfire_username")
    .trim();

  const campfireUsername = campfireRaw || null;

  const normalizedCode = normalizeTrainerCode(trainerCodeInput);
  if (!normalizedCode) {
    return interaction.reply({
      content: "Trainer code must contain exactly 12 digits.",
      flags: MessageFlags.Ephemeral
    });
  }

  const formattedCode = formatTrainerCode(normalizedCode);

  await upsertProfile({
    discordUserId: interaction.user.id,
    discordTag: interaction.user.tag,
    pokemonUsername,
    trainerCodeRaw: normalizedCode,
    trainerCodeFormatted: formattedCode,
    additionalCodes: profile.additional_codes || [],
    campfireUsername,
    vivillonPattern: profile.vivillon_pattern,
    publicChannelId: profile.public_channel_id,
    publishToFollowers: profile.publish_to_followers
  });

  const updatedProfile = await getProfile(interaction.user.id);
  await publishOrUpdateProfile(updatedProfile, interaction.guild);

  return interaction.reply({
    content: "Your profile has been updated.",
    flags: MessageFlags.Ephemeral
  });
}
}

async function ensureDatabaseConnection() {
  const client = await pool.connect();
  try {
    await client.query("SELECT 1");

    await client.query(`
      CREATE TABLE IF NOT EXISTS friendcode_profiles (
        discord_user_id TEXT PRIMARY KEY,
        discord_tag TEXT,
        pokemon_username TEXT NOT NULL,
        trainer_code_raw TEXT NOT NULL,
        trainer_code_formatted TEXT NOT NULL,
        additional_codes TEXT[],
        campfire_username TEXT,
        vivillon_pattern TEXT NOT NULL,
        public_channel_id TEXT NOT NULL,
        public_message_id TEXT,
        publish_to_followers BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_bumped_at TIMESTAMPTZ
      );
    `);

    await client.query(`
      ALTER TABLE friendcode_profiles
      ADD COLUMN IF NOT EXISTS publish_to_followers BOOLEAN NOT NULL DEFAULT TRUE;
    `);

    await client.query(`
  ALTER TABLE friendcode_profiles
  ADD COLUMN IF NOT EXISTS additional_codes TEXT[];
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
      additional_codes,
      campfire_username,
      vivillon_pattern,
      public_channel_id,
      publish_to_followers,
      updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
    ON CONFLICT (discord_user_id)
    DO UPDATE SET
      discord_tag = EXCLUDED.discord_tag,
      pokemon_username = EXCLUDED.pokemon_username,
      trainer_code_raw = EXCLUDED.trainer_code_raw,
      trainer_code_formatted = EXCLUDED.trainer_code_formatted,
      additional_codes = EXCLUDED.additional_codes,
      campfire_username = EXCLUDED.campfire_username,
      vivillon_pattern = EXCLUDED.vivillon_pattern,
      public_channel_id = EXCLUDED.public_channel_id,
      publish_to_followers = EXCLUDED.publish_to_followers,
      updated_at = NOW()
  `;

  const values = [
    profile.discordUserId,
    profile.discordTag,
    profile.pokemonUsername,
    profile.trainerCodeRaw,
    profile.trainerCodeFormatted,
    profile.additionalCodes || [],
    profile.campfireUsername,
    profile.vivillonPattern,
    profile.publicChannelId,
    profile.publishToFollowers
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