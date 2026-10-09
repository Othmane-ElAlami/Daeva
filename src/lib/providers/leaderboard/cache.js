import { getPrefetchCache } from "../../prefetch/cache.js";
import { COMBAT_POWER, CP_SOURCE } from "../../discovery-config.js";
import { matchesPlayerFilters } from "../../regions.js";
import { ProviderError } from "./base.js";

const SOURCE_NAME = "Cache";
const MAX_STALE_MS = 7 * 24 * 60 * 60 * 1000;

export async function getLeaderboard(config) {
  const { db, cls, lbType, region = "GLOBAL", startPage = 1 } = config;
  if (!db)
    throw new ProviderError("Database connection not provided for cache lookup.", SOURCE_NAME);
  const cached = await getPrefetchCache(db, cls, lbType, true, region);
  if (!cached || !Array.isArray(cached.builds) || !cached.builds.length)
    throw new ProviderError("No healthy cached leaderboard data available.", SOURCE_NAME);
  const ageMs = Date.now() - cached.fetchedAt;
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > MAX_STALE_MS)
    throw new ProviderError("Cache expired (older than 7 days).", SOURCE_NAME);
  const cp = lbType === COMBAT_POWER;
  if (
    cp &&
    (cached.source !== CP_SOURCE ||
      cached.builds.some(
        (build) =>
          build.region !== region ||
          build.class !== cls ||
          !build.characterId ||
          !build.serverId ||
          build.source !== CP_SOURCE ||
          !Number.isFinite(build.leaderboardCombatPower) ||
          build.leaderboardCombatPower <= 0 ||
          !Number.isInteger(build.rank) ||
          build.rank <= 0 ||
          !Array.isArray(build.equipItems) ||
          !build.equipItems.length ||
          ![build.activeSkills, build.stigmaSkills, build.passiveSkills, build.arcanas].every(
            Array.isArray
          )
      ))
  )
    throw new ProviderError("Cached Combat Power population metadata does not match.", SOURCE_NAME);
  const builds = cached.builds.filter((build) => matchesPlayerFilters(build, config));
  if (!builds.length) throw new ProviderError("No cached builds match these filters.", SOURCE_NAME);
  if (cp)
    builds.sort((a, b) => b.leaderboardCombatPower - a.leaderboardCombatPower || a.rank - b.rank);
  return {
    rankings:
      startPage > 1
        ? []
        : builds.slice(0, config.limit || 100).map((build) => ({
            characterId: build.characterId,
            characterName: build.name,
            serverId: build.serverId,
            serverName: build.serverName,
            region: build.region,
            class: build.class,
            faction: build.faction,
            rank: build.rank,
            globalRank: build.globalRank,
            combatPower: build.leaderboardCombatPower,
            gearScore: build.leaderboardGearScore,
            source: build.source,
            _isFromCache: true,
            _build: build,
          })),
    meta: {
      ...cached.data?.sourceMeta,
      source: SOURCE_NAME,
      upstreamSource: cp ? CP_SOURCE : cached.source,
      sourceType: cp ? COMBAT_POWER : "mode-specific",
      leaderboardType: lbType,
      basis: cp ? "Combat Power" : lbType,
      region,
      health: cached.isExpired ? "stale" : "complete",
      ageMs,
      fetchedAt: cached.fetchedAt,
      season: null,
      pagesFetched: 0,
      hasMore: false,
      dataLabel: cached.isExpired ? "Stale full-build cache" : "Recent full-build cache",
    },
  };
}
