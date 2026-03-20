-- Migration: Add item_level column to player_cache
-- Run this once against your D1 database:
--   npx wrangler d1 execute player-cache --file=migrations/add_item_level.sql --remote
ALTER TABLE player_cache ADD COLUMN item_level REAL;
