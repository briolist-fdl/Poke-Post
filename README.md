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

## Moderator region correction

`/post admin region user:<member> vivillon_pattern:<region>` corrects a saved profile.
It requires **Manage Messages** at runtime. The
runtime check uses the member's effective permissions in the command channel,
including channel overrides. Administrator also grants access. Until
profiles are server-scoped, it only operates in `DISCORD_GUILD_ID` (the home server).
The profile owner does not need to be the person running the command.

The `/post` root remains available to regular users. Discord command-level default
permissions apply to the whole root, so admin subcommands rely on the runtime
permission check rather than restricting all profile commands. The admin group
may be visible to users who cannot run it.

The post is edited in place when its destination stays the same. Otherwise a new
post is saved in the correct configured channel before the old post is removed.
Missing old posts are recreated. Codes, republishing preference and bump timestamps
are retained; the correction removes the automatic `bumped` marker. No profile is deleted.

The bot needs View Channel and Read Message History in the source, and View Channel
and Send Messages in the destination. It only edits/deletes its own stored post.
No mentions are notified by this command. Posts in followed servers may not be
updated or removed when an announcement post is corrected.

Moderation events are JSON records with `event=poke_post_moderation` in the hosting
logs (Railway). They include moderator/user/server IDs, old/new region and message
references, timestamp and outcome, but no trainer codes. Access to these logs should
be restricted to staff; retention follows the hosting log settings. No separate
Discord audit channel is created by this version.

If old-post cleanup fails, the private reply links to the remaining post. If a
database commit cannot be confirmed, the command asks staff to check before retrying.
Discord and PostgreSQL do not share a transaction, so these partial failures require
manual review. Avoid concurrent profile edits while a moderator correction is running.

This feature needs a code deploy **and explicit slash-command registration** before
use. It needs no schema migration or new environment variables.

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
DEPLOY_GLOBAL_COMMANDS=
DATABASE_URL=

INTERNATIONAL_CHANNEL_ID=
TUNDRA_CHANNEL_ID=

BOT_ID=poke-post
SUPPORT_MESSAGES_ENABLED=true
```

`DEPLOY_GLOBAL_COMMANDS=true` is only needed when deploying slash commands globally for public bot usage.

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

```bash
npm install
```

Deploy slash commands to the configured development/test guild:

```bash
npm run deploy-commands
```

Deploy slash commands globally for public bot usage:

```bash
DEPLOY_GLOBAL_COMMANDS=true npm run deploy-commands
```

On Windows PowerShell:

```powershell
$env:DEPLOY_GLOBAL_COMMANDS="true"
npm run deploy-commands
Remove-Item Env:\DEPLOY_GLOBAL_COMMANDS
```

Guild deploy is useful for testing because commands update quickly. Global deploy is needed when the bot is installed in other servers.

Start the bot:

```bash
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
