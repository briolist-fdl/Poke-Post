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