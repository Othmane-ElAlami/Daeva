-- Migration: Add admin_events table for tracking admin actions
-- Run this once against your D1 database:
--   npx wrangler d1 execute player-cache --file=migrations/add_admin_events.sql --remote
CREATE TABLE IF NOT EXISTS admin_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  metadata TEXT,
  created_at INTEGER NOT NULL
);
