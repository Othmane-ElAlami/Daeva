-- Migration: Add rate_limits table for per-IP rate limiting
-- Run this once against your D1 database:
--   npx wrangler d1 execute player-cache --file=migrations/add_rate_limits.sql --remote
CREATE TABLE IF NOT EXISTS rate_limits (
  ip TEXT PRIMARY KEY,
  last_request_at INTEGER NOT NULL
);
