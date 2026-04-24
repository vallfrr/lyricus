CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    google_id TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    name TEXT,
    avatar TEXT,
    username_set BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS username_set BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS game_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    artist TEXT NOT NULL,
    title TEXT NOT NULL,
    album TEXT DEFAULT '',
    difficulty TEXT NOT NULL,
    mode TEXT NOT NULL,
    score_correct INT NOT NULL DEFAULT 0,
    score_total INT NOT NULL DEFAULT 0,
    duration_seconds INT,
    played_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS game_sessions_user_id_idx ON game_sessions(user_id);
CREATE INDEX IF NOT EXISTS game_sessions_played_at_idx ON game_sessions(played_at DESC);

ALTER TABLE users ADD COLUMN IF NOT EXISTS public_history BOOLEAN DEFAULT TRUE;

-- Email/password auth support
ALTER TABLE users ALTER COLUMN google_id DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Set all users public_history to TRUE
UPDATE users SET public_history = TRUE WHERE public_history IS NULL OR public_history = FALSE;

-- Remove duplicate email accounts before adding unique constraint (keep oldest)
DELETE FROM users
WHERE id NOT IN (
    SELECT DISTINCT ON (email) id FROM users ORDER BY email, created_at
);

-- Nullify duplicate names before adding unique constraint (keep oldest)
UPDATE users SET name = NULL, username_set = FALSE
WHERE name IS NOT NULL
  AND id NOT IN (
    SELECT DISTINCT ON (name) id FROM users WHERE name IS NOT NULL ORDER BY name, created_at
  );

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email);
CREATE UNIQUE INDEX IF NOT EXISTS users_name_unique ON users(name) WHERE name IS NOT NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS apple_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS facebook_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_discord_id_unique ON users(discord_id) WHERE discord_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_apple_id_unique ON users(apple_id) WHERE apple_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_facebook_id_unique ON users(facebook_id) WHERE facebook_id IS NOT NULL;

DROP TABLE IF EXISTS user_integrations;

CREATE TABLE IF NOT EXISTS user_playlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    url TEXT NOT NULL,
    name TEXT NOT NULL,
    cover TEXT DEFAULT '',
    track_count INT DEFAULT 0,
    added_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, url)
);
ALTER TABLE user_playlists ADD COLUMN IF NOT EXISTS cover TEXT DEFAULT '';
ALTER TABLE user_playlists ADD COLUMN IF NOT EXISTS track_count INT DEFAULT 0;
ALTER TABLE user_playlists ADD COLUMN IF NOT EXISTS added_at TIMESTAMPTZ DEFAULT NOW();


ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS cover TEXT DEFAULT '';
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS details TEXT;

-- Force public history for all existing users (default is now always public)
UPDATE users SET public_history = TRUE WHERE public_history IS DISTINCT FROM TRUE;

ALTER TABLE game_sessions DROP COLUMN IF EXISTS game_tokens;
ALTER TABLE game_sessions DROP COLUMN IF EXISTS game_answer_token;
ALTER TABLE game_sessions DROP COLUMN IF EXISTS game_answers;
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS seed BIGINT;
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'finished';

CREATE TABLE IF NOT EXISTS daily_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    artist TEXT NOT NULL,
    title TEXT NOT NULL,
    album TEXT DEFAULT '',
    cover TEXT DEFAULT '',
    rerolls_used INT NOT NULL DEFAULT 0,
    reroll_history JSONB NOT NULL DEFAULT '[]',
    completed_at TIMESTAMPTZ,
    UNIQUE(user_id, date)
);
CREATE INDEX IF NOT EXISTS daily_challenges_user_date_idx ON daily_challenges(user_id, date);

-- Streaks
ALTER TABLE users ADD COLUMN IF NOT EXISTS current_streak INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS longest_streak INT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_daily_date DATE;

DROP TABLE IF EXISTS user_daily;

-- Badges
CREATE TABLE IF NOT EXISTS user_badges (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    badge_id   TEXT NOT NULL,
    earned_at  TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, badge_id)
);
CREATE INDEX IF NOT EXISTS user_badges_user_id_idx ON user_badges(user_id);
