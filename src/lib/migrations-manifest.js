/**
 * Migration manifest — source of truth for expected DB schema.
 * Populated from the migration files in migrations/.
 */
export const migrations = [
  {
    tableName: "player_cache",
    createSQL: `CREATE TABLE IF NOT EXISTS player_cache (
  character_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  region TEXT,
  equip_data TEXT NOT NULL,
  equip_details TEXT NOT NULL,
  item_level REAL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (character_id, server_id)
)`,
  },
  {
    tableName: "rate_limits",
    createSQL: `CREATE TABLE IF NOT EXISTS rate_limits (
  ip TEXT PRIMARY KEY,
  last_request_at INTEGER NOT NULL
)`,
  },
  {
    tableName: "meta_snapshots",
    createSQL: `CREATE TABLE IF NOT EXISTS meta_snapshots (
  class TEXT NOT NULL,
  leaderboard TEXT NOT NULL,
  total_players INTEGER NOT NULL,
  stigma_skills TEXT NOT NULL,
  active_skills TEXT NOT NULL,
  passive_skills TEXT NOT NULL,
  arcana_set_combos TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (class, leaderboard)
)`,
  },
  {
    tableName: "admin_events",
    createSQL: `CREATE TABLE IF NOT EXISTS admin_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  metadata TEXT,
  created_at INTEGER NOT NULL
)`,
  },
  {
    tableName: "login_attempts",
    createSQL: `CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  first_attempt_at INTEGER NOT NULL
)`,
  },
];

/**
 * Get the set of expected table names from the manifest.
 */
export function getExpectedTableNames() {
  return new Set(migrations.map((m) => m.tableName));
}
