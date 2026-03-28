CREATE TABLE IF NOT EXISTS meta_snapshots (
  class TEXT NOT NULL,
  leaderboard TEXT NOT NULL,
  total_players INTEGER NOT NULL,
  stigma_skills TEXT NOT NULL,
  active_skills TEXT NOT NULL,
  passive_skills TEXT NOT NULL,
  arcana_set_combos TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (class, leaderboard)
);
