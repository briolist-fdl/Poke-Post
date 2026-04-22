require("dotenv").config();

const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const vivillonChoices = [
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
];

const setupCommand = new SlashCommandBuilder()
  .setName("friendcode")
  .setDescription("Register, update, or manage your Pokemon GO friend code profile")
  .addSubcommand(sub =>
    sub
      .setName("setup")
      .setDescription("Create or update your friend code profile")
      .addStringOption(opt =>
        opt
          .setName("pokemon_username")
          .setDescription("Your Pokemon GO in-game username")
          .setRequired(true)
      )
      .addStringOption(opt =>
        opt
          .setName("trainer_code")
          .setDescription("Your 12-digit Pokemon GO friend code")
          .setRequired(true)
      )
      .addStringOption(opt => {
        opt
          .setName("vivillon_pattern")
          .setDescription("Your Vivillon pattern")
          .setRequired(true);
        for (const choice of vivillonChoices) {
          opt.addChoices({ name: prettifyPattern(choice), value: choice });
        }
        return opt;
      })
      .addBooleanOption(opt =>
        opt
          .setName("publish_to_followers")
          .setDescription("Allow your code to be republished to follower servers")
          .setRequired(true)
      )
      .addStringOption(opt =>
        opt
          .setName("campfire_username")
          .setDescription("Your Campfire username")
          .setRequired(false)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName("view")
      .setDescription("View your current saved profile")
  )
  .addSubcommand(sub =>
    sub
      .setName("delete")
      .setDescription("Delete your saved profile and public post")
  )
  .addSubcommand(sub =>
    sub
      .setName("republish")
      .setDescription("Repost/update your public friend code post")
  );

function prettifyPattern(value) {
  return value
    .split("_")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const commands = [setupCommand.toJSON()];

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log("Deploying guild slash commands...");

    await rest.put(
      Routes.applicationGuildCommands(
        process.env.DISCORD_CLIENT_ID,
        process.env.DISCORD_GUILD_ID
      ),
      { body: commands }
    );

    console.log("Guild slash commands deployed.");
  } catch (error) {
    console.error(error);
  }
})();