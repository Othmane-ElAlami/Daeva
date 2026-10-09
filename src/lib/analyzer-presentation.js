import { leaderboardTypes } from "./scraper-shared.js";
import { COMBAT_POWER } from "./discovery-config.js";

export function resultLabel(type, historical = false) {
  const label = leaderboardTypes[type]?.label || type;
  return historical
    ? `Historical ${label} Snapshot`
    : type === COMBAT_POWER
      ? "Top Combat Power Builds"
      : `Top ${label} Builds`;
}

export function canQuickBuild(stats, builds) {
  return (
    !!stats && !stats.isHistorical && stats.total > 0 && Array.isArray(builds) && builds.length > 0
  );
}

export function leaderboardLabel(type) {
  return leaderboardTypes[type]?.label || type;
}

export function stigmaUsagePercent(stat, total, historical = false) {
  // Older aggregates store usage count/pct, not equippedCount. Preserve those
  // recorded values without inventing player-level equipment information.
  if (historical && stat.equippedCount == null) {
    if (Number.isFinite(stat.pct)) return stat.pct;
    return total > 0 && Number.isFinite(stat.count) ? (stat.count / total) * 100 : null;
  }
  return total > 0 && Number.isFinite(stat.equippedCount)
    ? (stat.equippedCount / total) * 100
    : null;
}

// Pick a real player's template that best represents the observed skill/item
// usage. This preserves a playable combination instead of inventing a build.
export function quickBuild(stats, builds) {
  if (!canQuickBuild(stats, builds)) return null;
  const score = (build) =>
    [...build.activeSkills, ...build.stigmaSkills].reduce(
      (sum, skill) =>
        sum + (stats.activeSkills[skill.name]?.count || stats.stigmaSkills[skill.name]?.count || 0),
      0
    ) +
    build.equipItems.reduce(
      (sum, item) => sum + (stats.itemsBySlot[item.categoryName]?.[item.itemName]?.count || 0),
      0
    );
  return [...builds].sort(
    (a, b) =>
      score(b) - score(a) || (b.leaderboardCombatPower || 0) - (a.leaderboardCombatPower || 0)
  )[0];
}

export function sourceHealthText(meta) {
  if (meta.health === "unavailable") return "Unavailable";
  if (meta.health === "historical") return "Historical aggregate snapshot";
  if (meta.source === "Cache")
    return `${meta.health === "stale" ? "Stale" : "Recent"} full-build cache · fetched ${new Date(meta.fetchedAt).toISOString()}`;
  if (meta.leaderboardType === COMBAT_POWER)
    return "Live/Recent Character Data · Shugo CP leaderboard · periodically refreshed";
  return meta.health === "partial" ? "Partial Data" : "Recent Character Data";
}
