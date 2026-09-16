# Vivillon groups and routing decisions

Final device-tested emoji set, supplied by the user 2026-09-16. This supersedes all
older lists, including Sunlands, the earlier Bloom flower and Wetlands lotus.

| Group | Patterns and post emojis |
| --- | --- |
| 🌬️ Blizzard | 🏔️ Icy Snow · 🐻‍❄️ Polar · ❄️ Tundra |
| 🏵️ Bloom | 🪴 Garden · 🌼 Meadow · 🌾 Savanna |
| 🧭 Crossroads | 🚂 Continental · 🪭 Elegant · 🚕 Modern |
| 🕊️ Horizons | 🐎 High Plains · 🐪 Sandstorm · ☀️ Sun |
| 🌊 Waves | 🏝️ Archipelago · 🐚 Marine · 🗿 Ocean |
| 🦩 Wetlands | 🦧 Jungle · 🦎 Monsoon · 🦫 River |

All 18 patterns occur once. Internal group keys: blizzard, bloom, crossroads,
horizons, waves, wetlands. There is no sunlands key in the new routing feature.
The Discord, Pokéball and Campfire custom emoji IDs are unchanged.

## Feeds and server configuration

Local region is configurable per server; a separate local feed is optional.
With a separate local channel, local profiles appear there and other regions in
the international feed. Without a local channel, all regions share the main feed.
Group routing is independent: every region is eligible for its corresponding group,
including the server's local region. Tundraheim keeps Tundra outside International,
but includes Tundra in Blizzard with Icy Snow and Polar.

Poké-Post owns routing, initially to existing threads. Automatic creation is later
work. Routing never grants activation in another server or changes follower consent.
Advanced organization may eventually be premium; no payment restriction exists.

## Current implementation and activation

The home-server adapter uses config/vivillonThreads.json keyed by the configured
DISCORD_GUILD_ID. Tundraheim has six explicitly approved destinations. Other servers
remain disabled unless configured. VIVILLON_THREADS_JSON can override the saved map
for the configured server, as a JSON object mapping
internal group keys to existing public thread IDs. Omitted groups are not routed.
Do not use placeholder IDs in production. No threads are created or renamed.
The generic router is guild-scoped, but the live legacy profile table is deliberately
restricted to DISCORD_GUILD_ID until explicit multi-server activation is integrated.
An absent env value uses the saved server map. An empty env string explicitly pauses
routing without deleting existing copies; an empty JSON object cleans up tracked
copies. Removing the override restores the saved server map. No secrets are stored
in the configuration file. Initialization failure is logged without stopping bumps.

The worker creates poke_post_thread_posts on activation and reconciles at most one
profile each minute, starting a minute after startup. Existing profiles are included
gradually from BOTH main feeds. Profile edits change the stored thread message;
region changes move it; public-post removal or profile deletion removes it. A main
feed bump alone does not generate a new thread message, a bumped marker, or a ping.
New thread messages suppress push notifications and all mentions. Changes converge
on later cycles; large backlogs take longer than a minute. Routing failures do not
roll back the primary feed. Locked/inaccessible destinations back off for 5 minutes.

Only existing public or announcement threads in the configured server are accepted, including forum
posts. Required access: View Channel, Read Message History, Send Messages in Threads.
Archived unlocked threads are reopened for an actual write; locked threads are not
unlocked. Bot authorship is checked before editing or deleting stored messages.
Sources: https://docs.discord.com/developers/topics/threads and
https://docs.discord.com/developers/topics/permissions.

Delivery identity is persisted before sending and enforced via Discord nonce.
An ambiguous send older than 2 minutes stops for manual inspection rather than
risking duplicates beyond Discord's short deduplication window. This is not an
exactly-once guarantee. Logs contain IDs/errors, not profile bodies. Unchanged copies
are not polled at Discord; manually deleted thread messages are repaired on the next
profile content change, not on an ordinary bump. Manually deleted source posts must
be removed through profile/admin commands to clear their stored reference.

The preparatory guild-settings store now accepts null localChannelId. Apply migration
004-optional-local-feed.sql after 001 when that separate multi-server foundation is
activated. It is not run automatically by the legacy thread adapter.

Read-only live access check 2026-09-16: all six Tundraheim destinations are announcement
threads (type 10) under the international announcement channel (type 5). IDs match
the supplied group names. The bot can read history and has View Channel,
Read Message History and Send Messages in Threads. All six were unlocked and active.
No test messages were sent and no server settings changed.
