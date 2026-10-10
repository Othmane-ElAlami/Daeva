import { COMBAT_POWER, CP_SOURCE } from "../discovery-config.js";
import { characterKey, matchesPlayerFilters } from "../regions.js";
import { aggregate } from "../scraper-shared.js";

export const MAX_STALE_MS = 7 * 86400000;

export function populationTarget(data) {
  const total = data?.sourceMeta?.total;
  return Number.isInteger(total) && total > 0 ? Math.min(100, total) : 100;
}

export function inspectPopulation(cached, cls, leaderboard, region) {
  const builds = cached?.builds;
  const cp = leaderboard === COMBAT_POWER;
  const valid =
    Array.isArray(builds) &&
    builds.length > 0 &&
    (!cp ||
      (cached.source === CP_SOURCE &&
        new Set(builds.map(characterKey)).size === builds.length &&
        builds.every(
          (build) =>
            build.region === region &&
            build.class === cls &&
            build.source === CP_SOURCE &&
            typeof build.characterId === "string" &&
            build.characterId &&
            Number.isInteger(Number(build.serverId)) &&
            Number(build.serverId) > 0 &&
            Number.isInteger(build.rank) &&
            build.rank > 0 &&
            Number.isFinite(build.leaderboardCombatPower) &&
            build.leaderboardCombatPower > 0 &&
            Number.isFinite(build.combatPower) &&
            build.combatPower > 0 &&
            Array.isArray(build.equipItems) &&
            build.equipItems.length > 0 &&
            [build.activeSkills, build.stigmaSkills, build.passiveSkills, build.arcanas].every(
              Array.isArray
            )
        )));
  const expectedCount = populationTarget(cached?.data);
  return {
    valid: !!valid,
    complete:
      !!valid &&
      builds.length >= expectedCount &&
      cached.data?.sourceMeta?.buildHealth !== "partial" &&
      cached.data?.population?.complete !== false,
    buildCount: Array.isArray(builds) ? builds.length : 0,
    expectedCount,
  };
}

// A healthy small interactive sample can satisfy a smaller request, but is
// explicitly a sample rather than a completed top-100 prefetch population.
export function cachedAnalysis(cached, config) {
  if (!cached || config.lbType !== COMBAT_POWER) return null;
  const population = inspectPopulation(cached, config.cls, config.lbType, config.region);
  const ageMs = Date.now() - cached.fetchedAt;
  if (!population.valid || !Number.isFinite(ageMs) || ageMs < 0 || ageMs > MAX_STALE_MS)
    return null;
  if (
    !population.complete &&
    (cached.isExpired || cached.data?.sourceMeta?.buildHealth === "partial")
  )
    return null;
  const matches = cached.builds
    .filter((build) => matchesPlayerFilters(build, config))
    .sort((a, b) => b.leaderboardCombatPower - a.leaderboardCombatPower || a.rank - b.rank);
  if (
    matches.length < config.limit &&
    !(population.complete && matches.length === cached.builds.length)
  )
    return null;
  const builds = matches.slice(0, config.limit);
  if (!builds.length) return null;
  const sourceMeta = {
    ...cached.data?.sourceMeta,
    source: "Cache",
    upstreamSource: CP_SOURCE,
    sourceType: COMBAT_POWER,
    leaderboardType: COMBAT_POWER,
    basis: "Combat Power",
    region: config.region,
    health: cached.isExpired ? "stale" : "complete",
    ageMs,
    fetchedAt: cached.fetchedAt,
    expiresAt: cached.expiresAt,
    populationComplete: population.complete,
    buildCount: population.buildCount,
    expectedCount: population.expectedCount,
    hasMore: false,
    pagesFetched: 0,
    ...(population.complete ? {} : { buildHealth: "partial" }),
    dataLabel: `${cached.isExpired ? "Stale" : "Recent"} ${population.complete ? "full-build cache" : "build sample"}`,
    refreshDue: cached.isExpired,
  };
  const stats = {
    ...(builds.length === cached.builds.length && cached.data?.total === builds.length
      ? cached.data
      : aggregate(builds)),
    sourceMeta,
    leaderboardType: COMBAT_POWER,
    region: config.region,
  };
  // Refresh coordination is internal metadata, never part of an analyzer result.
  delete stats.refresh;
  return {
    builds,
    stats,
    count: builds.length,
    playerCount: builds.length,
    errors: [],
    budgetUsed: 0,
    sourceMeta,
    leaderboardType: COMBAT_POWER,
  };
}
