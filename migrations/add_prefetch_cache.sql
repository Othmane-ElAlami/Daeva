-- Migration: Add prefetch_cache table for background prefetching system
-- Stores pre-fetched leaderboard data per class×leaderboard combination.
-- Run this once against your D1 database:
--   npx wrangler d1 execute player-cache --file=migrations/add_prefetch_cache.sql --remote
CREATE TABLE IF NOT EXISTS prefetch_cache (
  class TEXT NOT NULL,
  leaderboard TEXT NOT NULL,
  data TEXT NOT NULL,
  builds TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'prefetch',
  PRIMARY KEY (class, leaderboard)
);
