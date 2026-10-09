import { populationKey, COMBAT_POWER } from "./discovery-config.js";
import { leaderboardTypes } from "./scraper-shared.js";

function topSkills(map, total) {
  return Object.entries(map)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 6)
    .map(([name, item]) => ({
      name,
      count: item.count,
      pct: +((item.count / total) * 100).toFixed(1),
      avgLv: item.avgLv,
    }));
}

export async function saveMetaSnapshot(db, config, stats) {
  if (!db || !stats || stats.total < 5) return;
  const combos = Object.entries(stats.arcanaSetCombos || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([combo, count]) => ({ combo, count, pct: +((count / stats.total) * 100).toFixed(1) }));
  await db
    .prepare(
      `INSERT OR REPLACE INTO meta_snapshots
    (class, leaderboard, total_players, stigma_skills, active_skills, passive_skills, arcana_set_combos, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      config.cls,
      populationKey(config.lbType, config.region),
      stats.total,
      JSON.stringify(topSkills(stats.stigmaSkills, stats.total)),
      JSON.stringify(topSkills(stats.activeSkills, stats.total)),
      JSON.stringify(topSkills(stats.passiveSkills, stats.total)),
      JSON.stringify(combos),
      Date.now()
    )
    .run();
}

export async function historicalSnapshot(db, config) {
  if (!db) return null;
  if (
    (config.serverId && config.serverId !== "all") ||
    (config.race && config.race !== "all") ||
    (config.runeFilter && config.runeFilter !== "all")
  )
    return null;
  const row = await db
    .prepare("SELECT * FROM meta_snapshots WHERE class = ? AND leaderboard = ?")
    .bind(config.cls, populationKey(config.lbType, config.region))
    .first();
  if (!row || !row.total_players) return null;
  const skillMap = (json) =>
    Object.fromEntries(JSON.parse(json || "[]").map(({ name, ...value }) => [name, value]));
  const stats = {
    total: row.total_players,
    stigmaSkills: skillMap(row.stigma_skills),
    activeSkills: skillMap(row.active_skills),
    passiveSkills: skillMap(row.passive_skills),
    arcanaSetCombos: Object.fromEntries(
      JSON.parse(row.arcana_set_combos || "[]").map((item) => [item.combo, item.count])
    ),
    isHistorical: true,
    updatedAt: row.updated_at,
    leaderboardType: config.lbType,
    region: config.lbType === COMBAT_POWER ? config.region : "all",
  };
  return {
    stats,
    count: stats.total,
    builds: [],
    leaderboardType: config.lbType,
    sourceMeta: {
      source: "Historical Snapshot",
      leaderboardType: config.lbType,
      basis: leaderboardTypes[config.lbType].label,
      region: stats.region,
      health: "historical",
      dataLabel: "Historical aggregate snapshot",
      updatedAt: row.updated_at,
      ageMs: Date.now() - row.updated_at,
    },
  };
}
