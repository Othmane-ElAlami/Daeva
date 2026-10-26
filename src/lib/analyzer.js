import { getLeaderboard } from "./providers/leaderboard/index.js";
import { AllProvidersFailedError } from "./providers/leaderboard/base.js";
import {
  fetchCharacterBuild,
  loadCachedBuilds,
  isFreshBuild,
  BUILD_FRESH_MS,
} from "./character-builds.js";
import { COMBAT_POWER, populationKey, isHistoricalOnly } from "./discovery-config.js";
import { characterKey, matchesPlayerFilters } from "./regions.js";
import { getPrefetchCache } from "./prefetch/cache.js";
import { cachedAnalysis } from "./prefetch/population.js";
import { MAX_UNAVAILABLE_PROFILES } from "./prefetch/unavailable.js";
import {
  leaderboardTypes,
  classRankingIds,
  baseUrl,
  createBudget,
  aggregate,
  runPool,
  subrequestBudgetExhausted,
} from "./scraper-shared.js";

export function analysisIdentity(config) {
  return JSON.stringify([
    populationKey(config.lbType, config.region),
    config.cls,
    config.limit,
    config.serverId || "all",
    config.race || "all",
    config.runeFilter || "all",
  ]);
}

export function validateContinuation(value, config) {
  if (
    !value ||
    value.identity !== analysisIdentity(config) ||
    !value.sourceMeta ||
    value.sourceMeta.leaderboardType !== config.lbType ||
    !Array.isArray(value.players) ||
    !Array.isArray(value.processedPlayers)
  )
    return false;
  if (
    value.players.length > 300 ||
    value.processedPlayers.length > config.limit ||
    value.processedCount !== value.processedPlayers.length ||
    (value.phase !== undefined && value.phase !== "publish") ||
    (value.phase === "publish" && (value.players.length !== 0 || value.processedCount === 0))
  )
    return false;
  const unavailable = value.sourceMeta.unavailablePlayers || [];
  if (!Array.isArray(unavailable) || unavailable.length > MAX_UNAVAILABLE_PROFILES) return false;
  const players = [...value.players, ...value.processedPlayers, ...unavailable];
  return (
    players.every(
      (p) =>
        typeof p.characterId === "string" &&
        p.characterId &&
        Number.isInteger(p.serverId) &&
        p.serverId > 0 &&
        p.region &&
        (config.lbType !== COMBAT_POWER ||
          (p.region === config.region &&
            p.class === config.cls &&
            p.source === "Shugo Combat Power"))
    ) && new Set(players.map(characterKey)).size === players.length
  );
}

export async function analyze(
  config,
  {
    db = null,
    onEvent = () => {},
    refresh = false,
    liveOnly = false,
    checkpointOnly = false,
    enrichExternally = false,
    budget = createBudget(),
  } = {}
) {
  if (!refresh && !liveOnly && !config.continuation && config.lbType === COMBAT_POWER) {
    const cached = cachedAnalysis(
      await getPrefetchCache(db, config.cls, config.lbType, true, config.region),
      config
    );
    if (cached) return cached;
  }
  const builds = [];
  const processedPlayers = [];
  const errors = [];
  const seen = new Set();
  let sourceMeta;
  let players;
  let cachedBuilds;
  let resumable = true;
  const providerConfig = {
    ...config,
    db,
    liveOnly,
    lbInfo: leaderboardTypes[config.lbType],
    rankingType: classRankingIds[config.cls],
    baseUrl,
  };
  const continuation = config.continuation;
  if (isHistoricalOnly(config.lbType, config.sourceMode))
    throw new AllProvidersFailedError("Live mode-specific rankings are unavailable.");
  if (continuation) {
    if (!validateContinuation(continuation, config))
      throw new Error("Invalid continuation population.");
    sourceMeta = continuation.sourceMeta;
    for (const player of sourceMeta.unavailablePlayers || []) seen.add(characterKey(player));
    players = continuation.players;
    // Scheduled batches retain identities only. Re-reading and parsing the
    // entire completed prefix on every invocation grows CPU work quadratically.
    const restoreBuilds = !checkpointOnly || continuation.phase === "publish";
    cachedBuilds = restoreBuilds
      ? await loadCachedBuilds(db, continuation.processedPlayers)
      : new Map();
    for (const player of continuation.processedPlayers) {
      if (restoreBuilds) {
        const build = cachedBuilds.get(characterKey(player));
        if (!build) throw new Error("Continuation build cache is no longer available.");
        builds.push(build);
      }
      processedPlayers.push(player);
      seen.add(characterKey(player));
    }
  } else {
    const result = await getLeaderboard({ ...providerConfig, limit: 100, maxPages: 1 }, budget);
    players = result.rankings;
    sourceMeta = { ...result.meta, leaderboardType: config.lbType };
    cachedBuilds = new Map();
  }
  onEvent({ type: "source_health", meta: sourceMeta });
  const initialProcessedCount = processedPlayers.length;
  const initialPlayerCount = players.length;
  // Source stickiness: later pages and continuation batches stay with the
  // successful discovery provider, never another leaderboard population.
  let page = sourceMeta.page || sourceMeta.pagesFetched || 1;
  const maxPages = config.lbType === COMBAT_POWER ? 3 : 20;
  let pending = [];
  let budgetStopped = false;
  let consecutiveFailures = 0;
  let visitedThisRequest = 0;
  let enrichPlayer = null;
  // Cached builds cost CPU even when they need no outbound fetches. Bound raw
  // cache upgrades/processing on low-limit Workers and resume the same pool.
  // Scheduled preparation shares the Free-plan CPU cap with its API wrapper.
  // Read/normalize at most one character; publication has its own invocation.
  const workLimit = enrichExternally
    ? 1
    : budget.hardLimit <= 50 && sourceMeta.source !== "Cache"
      ? 5
      : Infinity;
  const cacheGroupSize = enrichExternally ? 1 : budget.hardLimit <= 50 ? 5 : 40;
  while (processedPlayers.length < config.limit && (players.length || sourceMeta.hasMore)) {
    const candidates = players.filter((player) => {
      const key = characterKey(player);
      if (seen.has(key)) return false;
      seen.add(key);
      return matchesPlayerFilters(player, { ...config, runeFilter: "all" });
    });
    // Process in ranked waves; completion order cannot promote a lower-CP
    // cached character ahead of a higher-CP character still being fetched.
    for (let offset = 0; offset < candidates.length && processedPlayers.length < config.limit; ) {
      // Complete one character before starting another on 50-subrequest plans.
      // Parallel item waves otherwise consume the cap before any build can finish.
      const playerConcurrency = enrichExternally || budget.hardLimit <= 50 ? 1 : 3;
      const batch = candidates.slice(
        offset,
        offset + Math.min(playerConcurrency, config.limit - processedPlayers.length)
      );
      if (
        !refresh &&
        sourceMeta.source !== "Cache" &&
        batch.some((player) => !cachedBuilds.has(characterKey(player)))
      ) {
        const group = await loadCachedBuilds(
          db,
          candidates.slice(offset, offset + cacheGroupSize),
          { normalize: true, ...(enrichExternally ? { maxAgeMs: BUILD_FRESH_MS } : {}) }
        );
        for (const [key, build] of group) cachedBuilds.set(key, build);
      }
      // The authenticated scheduled runner performs official enrichment outside
      // the Worker. Keep the ranked pool and all cache/publication rules here.
      if (enrichExternally && !isFreshBuild(cachedBuilds.get(characterKey(batch[0])))) {
        enrichPlayer = batch[0];
        pending.push(...candidates.slice(offset));
        budgetStopped = true;
        break;
      }
      const results = await runPool(
        batch.map((player) => async () => {
          try {
            return await fetchCharacterBuild(player, db, budget, {
              refresh,
              cachedBuild: cachedBuilds.get(characterKey(player)) || null,
            });
          } catch (error) {
            return error;
          }
        }),
        playerConcurrency
      );
      for (let i = 0; i < batch.length; i++) {
        const result = results[i];
        if (!result || result instanceof subrequestBudgetExhausted) {
          pending.push(batch[i]);
          budgetStopped = true;
          continue;
        }
        if (result instanceof Error) {
          errors.push(`${batch[i].characterName}: ${result.message}`);
          consecutiveFailures++;
          continue;
        }
        consecutiveFailures = 0;
        errors.push(...result.warnings);
        if (!matchesPlayerFilters(result.build, config)) continue;
        builds.push(result.build);
        resumable &&= result.resumable === true;
        const { _build, _isFromCache, ...identity } = batch[i];
        processedPlayers.push(identity);
        onEvent({
          type: "progress",
          current: processedPlayers.length,
          total: config.limit,
          target: batch[i].characterName,
        });
        onEvent({ type: "player", build: result.build });
      }
      if (budgetStopped) {
        pending.push(...candidates.slice(offset + batch.length));
        break;
      }
      visitedThisRequest += batch.length;
      if (
        visitedThisRequest >= workLimit &&
        offset + batch.length < candidates.length &&
        processedPlayers.length < config.limit
      ) {
        pending.push(...candidates.slice(offset + batch.length));
        budgetStopped = true;
        break;
      }
      if (!processedPlayers.length && consecutiveFailures >= 6) break;
      offset += batch.length;
    }
    if (
      budgetStopped ||
      (!processedPlayers.length && consecutiveFailures >= 6) ||
      processedPlayers.length >= config.limit ||
      !sourceMeta.hasMore ||
      page >= maxPages ||
      sourceMeta.source === "Cache"
    )
      break;
    page++;
    try {
      const next = await getLeaderboard(
        {
          ...providerConfig,
          startPage: page,
          maxPages: 1,
          limit: 100,
          forceProvider: sourceMeta.source,
        },
        budget
      );
      players = next.rankings;
      cachedBuilds = new Map();
      sourceMeta = {
        ...sourceMeta,
        ...next.meta,
        pagesFetched: page,
        leaderboardType: config.lbType,
        ...(config.lbType === COMBAT_POWER
          ? {
              discoveryDuplicatesIgnored:
                (sourceMeta.discoveryDuplicatesIgnored || 0) +
                (next.meta.discoveryDuplicatesIgnored || 0),
            }
          : {}),
      };
    } catch (error) {
      if (error instanceof subrequestBudgetExhausted) throw error;
      errors.push(`Additional discovery page unavailable: ${error.message}`);
      sourceMeta = { ...sourceMeta, hasMore: false, buildHealth: "partial" };
      break;
    }
  }
  const madeProgress =
    processedPlayers.length > initialProcessedCount || pending.length < initialPlayerCount;
  if (errors.length)
    sourceMeta = {
      ...sourceMeta,
      buildHealth: "partial",
      errorCount: (sourceMeta.errorCount || 0) + errors.length,
    };
  if (budgetStopped && !madeProgress && !enrichPlayer) {
    errors.push("The request budget cannot complete another character build.");
    sourceMeta = { ...sourceMeta, buildHealth: "partial", hasMore: false };
  }
  if (budgetStopped && pending.length && (madeProgress || enrichPlayer)) {
    // Only complete player caches can be resumed. Incomplete details are
    // returned for review in a final partial result, never a lossy continuation.
    if (!resumable) {
      errors.push("The request budget was reached; incomplete builds cannot be resumed safely.");
      return finish(
        builds,
        { ...sourceMeta, buildHealth: "partial", hasMore: false },
        errors,
        budget.used,
        config
      );
    }
    return {
      builds,
      playerCount: processedPlayers.length,
      errors,
      budgetUsed: budget.used,
      sourceMeta,
      ...(enrichPlayer ? { enrichPlayer } : {}),
      continuation: {
        identity: analysisIdentity(config),
        sourceMeta: { ...sourceMeta, page },
        players: pending,
        processedPlayers,
        processedCount: processedPlayers.length,
      },
    };
  }
  if (checkpointOnly && processedPlayers.length && continuation?.phase !== "publish") {
    // Publication gets a separate invocation with no character enrichment.
    // Only that final phase loads and aggregates the full completed population.
    return {
      builds,
      playerCount: processedPlayers.length,
      errors,
      budgetUsed: budget.used,
      sourceMeta,
      continuation: {
        identity: analysisIdentity(config),
        sourceMeta: { ...sourceMeta, page },
        players: [],
        processedPlayers,
        processedCount: processedPlayers.length,
        phase: "publish",
      },
    };
  }
  if (!builds.length) {
    // Discovery can be healthy while character APIs fail. Use the same CP
    // full-build snapshot in that case; prefetch never re-stamps old cache.
    if (!liveOnly && sourceMeta.source !== "Cache") {
      try {
        const cached = await getLeaderboard({ ...providerConfig, forceProvider: "Cache" }, budget);
        const cachedBuilds = cached.rankings.map((player) => player._build);
        return finish(cachedBuilds, cached.meta, errors, budget.used, config);
      } catch (error) {
        if (error instanceof subrequestBudgetExhausted) throw error;
      }
    }
    throw new AllProvidersFailedError(
      "No usable character builds or matching full-build cache are available."
    );
  }
  if (errors.length) sourceMeta = { ...sourceMeta, buildHealth: "partial" };
  return finish(builds, sourceMeta, errors, budget.used, config);
}

function finish(builds, sourceMeta, errors, budgetUsed, config) {
  if (config.lbType === COMBAT_POWER)
    builds.sort((a, b) => b.leaderboardCombatPower - a.leaderboardCombatPower || a.rank - b.rank);
  const stats = {
    ...aggregate(builds),
    leaderboardType: config.lbType,
    region: config.region,
    sourceMeta,
  };
  return {
    builds,
    stats,
    count: builds.length,
    playerCount: builds.length,
    errors,
    budgetUsed,
    sourceMeta,
    leaderboardType: config.lbType,
  };
}
