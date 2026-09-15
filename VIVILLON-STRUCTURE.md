# Tundraheim Vivillon structure — current decisions

Updated 2026-09-15 from **Tundraheim Server Structure**, conversation
`6a352f1d-d6ec-83eb-b554-f77c61736a13`, including the final Wetlands revision.
This table supersedes earlier emoji candidates and the older table in BOT-MASTER.

| Group | Patterns and post emojis |
| --- | --- |
| 🌬️ Blizzard | 🏔️ Icy Snow · 🐻‍❄️ Polar · ❄️ Tundra |
| 🌊 Waves | 🏝️ Archipelago · ⛵ Marine · 🗿 Ocean |
| 🏜️ Sunlands | 🌾 High Plains · 🐪 Sandstorm · ☀️ Sun |
| 🪷 Wetlands | 🌴 Jungle · 💦 Monsoon · 🛶 River |
| 🌺 Bloom | 🌳 Savanna · 🌼 Meadow · 🪴 Garden |
| 🧭 Crossroads | 🚂 Continental · 🌸 Elegant · 🚋 Modern |

All 18 patterns occur once, in six groups of three. Group emojis and individual
pattern emojis are distinct. Discord uses this set independently from the Campfire
Svalbard-specific Icy Snow/Polar choices. In particular, do not restore the earlier
Wetlands leaf, Monsoon rain cloud or River water drop/landscape. The spiral and frog
were considered but not selected.

## Implementation status

The bot's REGION_EMOJIS map follows this table. Existing messages receive updated
emojis on their next edit, repost or bump; this change does not rewrite messages in
bulk. Discord, Pokéball and Campfire custom emoji IDs are unaffected.

Group names are a reference for future thread configuration; this document does
not create or rename any Discord threads or channels, nor enable routing.

## Agreed routing direction

- Keep international-feed as the complete international feed and tundra-feed as
  Tundraheim's separate primary local feed.
- Provide six filtered group threads using the table above. Poké-Post owns the
  Vivillon routing because it knows profile identity, region, edits and removals.
  Start by configuring existing threads; automatic thread creation comes later.
- A bump is a new representation of an existing profile, not a new identity.
  Track routed posts by guild, profile owner and destination; edits, region changes
  and removals must update/move/remove the corresponding routed representation.
- Do not infer activation or extra publishing consent from a followed feed.
- Advanced routing/organization may later be premium per server, while the free
  profile feed remains useful and complete. No payment restriction is implemented.

Current work remains local until explicitly approved for deployment. Routing needs
its own implementation and live verification; the emoji change alone adds no routes.
