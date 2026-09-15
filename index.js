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
const { maybeAddSupportMessage } = require("./src/shared/supportDevelopment");

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

const REGION_EMOJIS = {
  archipelago: "🏝️",
  continental: "🌍",
  elegant: "🌸",
  garden: "🌿",
  high_plains: "🌾",
  icy_snow: "🧊",
  jungle: "🌴",
  marine: "🌊",
  meadow: "🌼",
  modern: "🏙️",
  monsoon: "🌧️",
  ocean: "🌊",
  polar: "🐻‍❄️",
  river: "🏞️",
  sandstorm: "🏜️",
  savanna: "🦁",
  sun: "☀️",
  tundra: "❄️"
};

const INTERNATIONAL_CHANNEL_ID = process.env.INTERNATIONAL_CHANNEL_ID;
const TUNDRA_CHANNEL_ID = process.env.TUNDRA_CHANNEL_ID;

const { createProfileForm } = require('./src/profileForm');
const profileForm = createProfileForm({
  configuredGuildId: process.env.DISCORD_GUILD_ID, patterns: VIVILLON_PATTERNS,
  getProfile, normalizeCode: normalizeTrainerCode, saveAndPublish: saveFormProfile
});
const { createPostRemover } = require('./src/moderateRemove');
const handlePostRemoval = createPostRemover({ pool, client, configuredGuildId: process.env.DISCORD_GUILD_ID });
const { createRegionModerator } = require('./src/moderateRegion');
const handleRegionModeration = createRegionModerator({
  pool, client, configuredGuildId: process.env.DISCORD_GUILD_ID,
  patterns: VIVILLON_PATTERNS, getPublicChannelId, buildPublicMessage, buildButtons
});

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
    }, 22000);
  } catch (error) {
    console.error('Failed to moderate friend code channel message:', error);
  }
});

async function replySuccess(interaction, content) {
  const contentWithSupport = maybeAddSupportMessage(content);

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({
      flags: MessageFlags.Ephemeral,
      content: contentWithSupport,
    });
    return;
  }

  await interaction.reply({
    flags: MessageFlags.Ephemeral,
    content: contentWithSupport,
  });
}

async function editReplySuccess(interaction, content) {
  const contentWithSupport = maybeAddSupportMessage(content);

  await interaction.editReply({
    content: contentWithSupport
  });
}

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "post") {
        if (interaction.options.getSubcommandGroup(false) === "admin") {
          if (interaction.options.getSubcommand() === "remove") await handlePostRemoval(interaction); else await handleRegionModeration(interaction);
        } else {
          await handleFriendcodeCommand(interaction);
        }
      }
      return;
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith("profile_form:")) { await profileForm.submit(interaction); return; }
      if (interaction.customId === "edit_profile_modal") {
        await interaction.reply({ content: "This form has been updated. Please reopen `/post edit`.", flags: MessageFlags.Ephemeral });
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

  if (subcommand === "setup" || subcommand === "edit") {
    return profileForm.open(interaction, subcommand);
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

    return replySuccess(interaction,
      enabled
        ? "Republishing is now turned on."
        : "Republishing is now turned off."
    );
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

    return replySuccess(interaction,
      oldChannelId === newChannelId
        ? `Your region has been updated to **${prettifyPattern(vivillonPattern)}**.`
        : `Your region has been updated to **${prettifyPattern(vivillonPattern)}** and your post was moved to <#${newChannelId}>.`
    );
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

    return replySuccess(interaction, "Your saved profile and public post have been deleted.");
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

    return replySuccess(interaction, `Your profile has been reposted in <#${profile.public_channel_id}>.`);
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

    return replySuccess(interaction, `Added extra code: ${formatTrainerCode(normalizedCode)}`);
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

    return replySuccess(interaction, `Removed extra code: ${formatTrainerCode(removedCode)}`);
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

async function buildPublicMessage(profile, { bumped = false } = {}) {
  const EMOJIS = {
    pokeball: "<:pokeball:426098818560557068>",
    discord: "<:discord:1491037322701963375>",
    campfire: "<:campfire:1491036898389659678>"
  };

  const regionEmoji = REGION_EMOJIS[profile.vivillon_pattern] || "";

  const patternText = `${regionEmoji} ${prettifyPattern(profile.vivillon_pattern)} Trainer`.trim();

  const lineOne = bumped ? `${patternText} · *bumped*` : patternText;

  let discordName = 'Discord profile';
  try {
    const user = await client.users.fetch(profile.discord_user_id, { force: true });
    if (user?.username) discordName = user.username;
  } catch (_) {
    // A failed lookup must not break posting or mislabel a deleted account.
    // Keep the stable profile link with a neutral label; retry on the next update.
  }
  const label = discordName.replace(/([\\`*_{}\[\]()<>~|])/g, '\\$1');
  const discordLink = `[${label}](<https://discord.com/users/${profile.discord_user_id}>)`;
  let lineTwo = `${EMOJIS.discord} ${discordLink} | ${EMOJIS.pokeball} ${profile.pokemon_username}`;

  if (profile.campfire_username) {
    lineTwo += ` | ${EMOJIS.campfire} ${profile.campfire_username}`;
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
    lineOne,
    "",
    lineTwo,
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

  const content = await buildPublicMessage(profile);
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

  const content = await buildPublicMessage(profile);
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
}

async function saveFormProfile({ user, guild, current, pokemonUsername, trainerCodeRaw,
  campfireUsername, vivillonPattern, publishToFollowers }) {
  const publicChannelId = getPublicChannelId(vivillonPattern);
  const target = publicChannelId && await guild.channels.fetch(publicChannelId);
  if (!target || target.guildId !== guild.id || !target.isTextBased()) {
    throw new Error('The destination friend-code channel is unavailable.');
  }
  await upsertProfile({ discordUserId: user.id, discordTag: user.tag, pokemonUsername,
    trainerCodeRaw, trainerCodeFormatted: formatTrainerCode(trainerCodeRaw),
    additionalCodes: current?.additional_codes || [], campfireUsername,
    vivillonPattern, publicChannelId, publishToFollowers });
  const updated = await getProfile(user.id);
  try {
    await publishOrUpdateProfile(updated, guild);
  } catch (error) {
    console.warn('Profile form saved but publication failed:', error.code || 'unknown');
    return 'Your profile was saved, but the public post could not be updated. Please try `/post repost`. If you changed region, the previous post may also need moderator cleanup.';
  }
  let cleanupWarning = '';
  if (current?.public_message_id && current.public_channel_id !== publicChannelId) {
    try {
      const source = await guild.channels.fetch(current.public_channel_id);
      if (!source || source.guildId !== guild.id) throw Error('Invalid old profile channel');
      const oldPost = await source.messages.fetch(current.public_message_id);
      if (oldPost.author.id !== client.user.id) throw Error('Old post is not authored by this bot');
      await oldPost.delete();
    } catch (error) {
      if (error.code !== 10008) cleanupWarning = '\nThe new post is ready, but the previous post needs moderator cleanup.';
    }
  }
  return `Saved your profile in <#${publicChannelId}>.\n\n${buildProfilePreview(updated)}${cleanupWarning}`;
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
  console.log("Bump job enabled.");

  startBumpSchedule("tundra", {
    channelId: TUNDRA_CHANNEL_ID,
    intervalHours: Number(process.env.BUMP_TUNDRA_INTERVAL_HOURS || 24),
    countPerRun: Number(process.env.BUMP_TUNDRA_COUNT_PER_RUN || 1),
    cooldownDays: Number(process.env.BUMP_TUNDRA_COOLDOWN_DAYS || 5)
  });

  startBumpSchedule("international", {
    channelId: INTERNATIONAL_CHANNEL_ID,
    intervalHours: Number(process.env.BUMP_INTERNATIONAL_INTERVAL_HOURS || 11),
    countPerRun: Number(process.env.BUMP_INTERNATIONAL_COUNT_PER_RUN || 3),
    cooldownDays: Number(process.env.BUMP_INTERNATIONAL_COOLDOWN_DAYS || 3)
  });
}

function startBumpSchedule(name, config) {
  const intervalMs = config.intervalHours * 60 * 60 * 1000;

  console.log(
    `Bump schedule "${name}" enabled. Running every ${config.intervalHours} hour(s), count ${config.countPerRun}, cooldown ${config.cooldownDays} day(s).`
  );

  runBumpCycle(config).catch(error => {
    console.error(`Initial bump cycle failed for "${name}":`, error);
  });

  setInterval(async () => {
    try {
      await runBumpCycle(config);
    } catch (error) {
      console.error(`Bump cycle failed for "${name}":`, error);
    }
  }, intervalMs);
}

async function runBumpCycle(config) {
  const guild = client.guilds.cache.get(process.env.DISCORD_GUILD_ID);
  if (!guild) return;

  const cutoff = new Date(
    Date.now() - config.cooldownDays * 24 * 60 * 60 * 1000
  );

  const result = await pool.query(
    `
    SELECT *
    FROM friendcode_profiles
    WHERE public_message_id IS NOT NULL
      AND public_channel_id = $1
      AND (last_bumped_at IS NULL OR last_bumped_at < $2)
    ORDER BY RANDOM()
    LIMIT $3
    `,
    [config.channelId, cutoff.toISOString(), config.countPerRun]
  );

  for (const profile of result.rows) {
    await bumpProfile(profile, guild);
  }
}

async function bumpProfile(profile, guild) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    // Recheck under the same row lock used by moderation: a queued bump must
    // never recreate a removed post or use references from before a correction.
    const { rows } = await db.query('SELECT * FROM friendcode_profiles WHERE discord_user_id = $1 FOR UPDATE', [profile.discord_user_id]);
    const current = rows[0];
    if (current?.public_message_id && current.public_message_id === profile.public_message_id &&
        current.public_channel_id === profile.public_channel_id) {
      await bumpLocked(current, guild, db);
    }
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    db.release();
  }
}

async function bumpLocked(profile, guild, db) {
  const channel = await guild.channels.fetch(profile.public_channel_id);
  if (!channel || !channel.isTextBased()) return;

  const content = await buildPublicMessage(profile, { bumped: true });
  const components = buildButtons(profile);

  try {
    if (profile.public_message_id) {
      const oldMessage = await channel.messages.fetch(profile.public_message_id);
      await oldMessage.delete().catch(() => {});
    }
  } catch (_) {}

  const newMessage = await channel.send({ content, components, allowedMentions: { parse: [] } });

  await db.query(
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
