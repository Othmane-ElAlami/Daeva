import { getLeaderboard } from "./providers/leaderboard/index.js";
import { AllProvidersFailedError } from "./providers/leaderboard/base.js";
import { fetchCharacterBuild, loadCachedBuild } from "./character-builds.js";
import { COMBAT_POWER, populationKey, isHistoricalOnly } from "./discovery-config.js";
import { characterKey, matchesPlayerFilters } from "./regions.js";
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
    value.processedCount !== value.processedPlayers.length
  )
    return false;
  const players = [...value.players, ...value.processedPlayers];
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
  { db = null, onEvent = () => {}, refresh = false, liveOnly = false, budget = createBudget() } = {}
) {
  const builds = [];
  const processedPlayers = [];
  const errors = [];
  const seen = new Set();
  let sourceMeta;
  let players;
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
    players = continuation.players;
    for (const player of continuation.processedPlayers) {
      const build = await loadCachedBuild(db, player);
      if (!build) throw new Error("Continuation build cache is no longer available.");
      builds.push(build);
      processedPlayers.push(player);
      seen.add(characterKey(player));
    }
  } else {
    const result = await getLeaderboard({ ...providerConfig, limit: 100, maxPages: 1 }, budget);
    players = result.rankings;
    sourceMeta = { ...result.meta, leaderboardType: config.lbType };
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
  while (players.length && builds.length < config.limit) {
    const candidates = players.filter((player) => {
      const key = characterKey(player);
      if (seen.has(key)) return false;
      seen.add(key);
      return matchesPlayerFilters(player, { ...config, runeFilter: "all" });
    });
    // Process in ranked waves; completion order cannot promote a lower-CP
    // cached character ahead of a higher-CP character still being fetched.
    for (let offset = 0; offset < candidates.length && builds.length < config.limit; ) {
      // Complete one character before starting another on 50-subrequest plans.
      // Parallel item waves otherwise consume the cap before any build can finish.
      const playerConcurrency = budget.hardLimit <= 50 ? 1 : 3;
      const batch = candidates.slice(
        offset,
        offset + Math.min(playerConcurrency, config.limit - builds.length)
      );
      const results = await runPool(
        batch.map((player) => async () => {
          try {
            return await fetchCharacterBuild(player, db, budget, { refresh });
          } catch (error) {
            return error;
          }
        }),
        playerConcurrency,
        budget
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
        const { _build, _isFromCache, ...identity } = batch[i];
        processedPlayers.push(identity);
        onEvent({
          type: "progress",
          current: builds.length,
          total: config.limit,
          target: batch[i].characterName,
        });
        onEvent({ type: "player", build: result.build });
      }
      if (budgetStopped) {
        pending.push(...candidates.slice(offset + batch.length));
        break;
      }
      if (!builds.length && consecutiveFailures >= 6) break;
      offset += batch.length;
    }
    if (
      budgetStopped ||
      (!builds.length && consecutiveFailures >= 6) ||
      builds.length >= config.limit ||
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
      sourceMeta = {
        ...sourceMeta,
        ...next.meta,
        pagesFetched: page,
        leaderboardType: config.lbType,
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
  if (budgetStopped && !madeProgress) {
    errors.push("The request budget cannot complete another character build.");
    sourceMeta = { ...sourceMeta, buildHealth: "partial", hasMore: false };
  }
  if (budgetStopped && pending.length && madeProgress) {
    // Only complete player caches can be resumed. Incomplete details are
    // returned for review in a final partial result, never a lossy continuation.
    for (const player of processedPlayers) {
      if (!(await loadCachedBuild(db, player))) {
        errors.push("The request budget was reached; incomplete builds cannot be resumed safely.");
        return finish(
          builds,
          { ...sourceMeta, buildHealth: "partial", hasMore: false },
          errors,
          budget.used,
          config
        );
      }
    }
    return {
      builds,
      errors,
      budgetUsed: budget.used,
      sourceMeta,
      continuation: {
        identity: analysisIdentity(config),
        sourceMeta: { ...sourceMeta, page },
        players: pending,
        processedPlayers,
        processedCount: processedPlayers.length,
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
