# Poké-Post

Poké-Post is a Discord bot for clean Pokémon GO friend code posting.

It lets players create and manage a structured friend code profile, then posts the profile in dedicated Discord channels without turning the channel into a chat feed.

## Features

* Create a Pokémon GO friend code profile
* Store Pokémon GO username, trainer code, Vivillon pattern, and optional Campfire username
* Add up to three additional friend codes
* Edit, view, repost, or delete your saved profile
* Change Vivillon region
* Turn follower republishing on or off
* Post to dedicated Tundra and international friend code channels
* Optional automatic bumping/reposting system
* PostgreSQL-backed profile storage
* Ephemeral command responses for user actions

## Main command

Poké-Post uses one main slash command:

```text id="bcwuxr"
/post
```

### Profile setup

```text id="aljqq7"
/post setup
```

Creates a friend code profile.

Required fields:

```text id="yck75s"
pokemon_username
trainer_code
vivillon_pattern
publish_to_followers
```

Optional field:

```text id="8p9j0d"
campfire_username
```

### Profile management

```text id="uoevyq"
/post view
/post edit
/post delete
/post repost
```

These commands let users inspect, update, delete, or repost their saved profile.

### Additional friend codes

```text id="57x4i4"
/post add-code
/post remove-code
```

Users can add or remove extra trainer codes from their profile.

### Republishing

```text id="bpi79z"
/post republishing
```

Turns follower republishing on or off.

### Vivillon region

```text id="hzluu8"
/post region
```

Changes the saved Vivillon pattern for the user profile.

## Requirements

* Node.js
* PostgreSQL database
* Discord bot application
* Discord server where slash commands can be registered
* Dedicated Discord channels for configured friend code feeds

## Environment variables

Poké-Post is configured through environment variables.

```env id="bdnyav"
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
DATABASE_URL=

INTERNATIONAL_CHANNEL_ID=
TUNDRA_CHANNEL_ID=

BOT_ID=poke-post
SUPPORT_MESSAGES_ENABLED=true
```

Optional bump/repost settings:

```env id="rblbcm"
BUMP_ENABLED=false

BUMP_TUNDRA_INTERVAL_HOURS=24
BUMP_TUNDRA_COUNT_PER_RUN=1
BUMP_TUNDRA_COOLDOWN_DAYS=5

BUMP_INTERNATIONAL_INTERVAL_HOURS=11
BUMP_INTERNATIONAL_COUNT_PER_RUN=3
BUMP_INTERNATIONAL_COOLDOWN_DAYS=3
```

Optional support-message override:

```env id="2zf7xa"
SUPPORT_MESSAGE_CHANCE=
```

`SUPPORT_MESSAGE_CHANCE` is intended for testing or temporary override only. Do not set it permanently unless you specifically want to override the bot default.

## Installation

Install dependencies:

```bash id="2zhf19"
npm install
```

Deploy slash commands:

```bash id="ww0nd5"
npm run deploy-commands
```

Start the bot:

```bash id="zc3kv4"
npm start
```

## Database

Poké-Post uses PostgreSQL.

The database connection is read from:

```env id="yqlp1b"
DATABASE_URL=
```

The bot stores user profile data needed to create and manage friend code posts.

## Permissions

Poké-Post needs the Discord permissions required to:

* use slash commands
* send messages in configured friend code channels
* edit or delete bot-created profile posts when users update/delete their profile
* send ephemeral command responses

## Privacy and data

Poké-Post stores the profile information users submit through `/post setup` and related commands.

This may include:

* Discord user ID
* Pokémon GO username
* Pokémon GO trainer code
* Vivillon pattern
* optional Campfire username
* additional trainer codes
* republishing preference
* message references needed to manage public posts

Poké-Post is not designed as a general-purpose message archive.

## Support development

Poké-Post is built as an open source community tool.

If it helps your server, you can support further development by voting for the bot when voting pages are available, contributing feedback or issues on GitHub, or supporting the developer here:

https://buymeacoffee.com/andreasviken

## Links

* GitHub: https://github.com/briolist-fdl/poke-post
* Support development: https://buymeacoffee.com/andreasviken

## License

No license has been specified yet.
