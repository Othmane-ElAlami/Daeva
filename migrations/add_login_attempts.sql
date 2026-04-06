-- Migration: Add login_attempts table for admin login rate limiting
-- Run this once against your D1 database:
--   npx wrangler d1 execute player-cache --file=migrations/add_login_attempts.sql --remote
CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  first_attempt_at INTEGER NOT NULL
);
