// ─────────────────────────────────────────────────────────────────────────────
import { populationKey, parsePopulationKey, COMBAT_POWER } from "../discovery-config.js";
import { inspectPopulation, populationTarget } from "./population.js";
import { encodeBuilds, decodeBuilds, buildCountSQL } from "./build-codec.js";
// Prefetch System — D1-Backed Cache
// ─────────────────────────────────────────────────────────────────────────────
// Reads and writes prefetched leaderboard data in the D1 `prefetch_cache`
// table. Each row stores aggregated stats + individual builds for one
// class×leaderboard combination.
//
// All functions require a D1 `db` handle (from getRequestContext().env.DB).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Read cached prefetch data from D1.
 * Returns null on miss. Stale entries (past expiresAt) are still returned
 * when allowStale is true — stale data is always better than no data.
 */
export async function getPrefetchCache(
  db,
  cls,
  leaderboard,
  allowStale = true,
  region = "GLOBAL",
  { metadataOnly = false } = {}
) {
  try {
    const row = await db
      .prepare(
        `SELECT ${
          metadataOnly
            ? `json_object('population', json_extract(data, '$.population'),
                'sourceMeta', json_extract(data, '$.sourceMeta')) AS data,
               ${buildCountSQL("builds")} AS build_count`
            : "data, builds"
        }, fetched_at, expires_at, source FROM prefetch_cache WHERE class = ? AND leaderboard = ?`
      )
      .bind(cls, populationKey(leaderboard, region))
      .first();
    if (!row) return null;
    const now = Date.now();
    if (now > row.expires_at && !allowStale) return null;
    return {
      data: JSON.parse(row.data),
      ...(metadataOnly ? { buildCount: row.build_count } : { builds: decodeBuilds(row.builds) }),
      fetchedAt: row.fetched_at,
      expiresAt: row.expires_at,
      source: row.source,
      isExpired: now > row.expires_at,
    };
  } catch {
    return null;
  }
}

/**
 * Write prefetch results to D1 cache.
 */
export async function setPrefetchCache(
  db,
  cls,
  leaderboard,
  data,
  builds,
  ttlMs,
  source = "prefetch",
  region = "GLOBAL",
  { preparedBy = "interactive" } = {}
) {
  if (!db) return { stored: false };
  const now = Date.now();
  const cp = leaderboard === COMBAT_POWER;
  const population = inspectPopulation({ data, builds, source }, cls, leaderboard, region);
  if (cp && (!population.valid || data?.sourceMeta?.buildHealth === "partial"))
    return { stored: false, reason: "Incomplete or malformed build data" };
  const storedData = cp ? { ...data, population: { ...population, preparedBy } } : data;
  const dataJson = JSON.stringify(storedData);
  const buildsJson = cp ? encodeBuilds(builds, dataJson) : JSON.stringify(builds);
  // The SQL guard makes this safe even when two refreshes finish together.
  // Legacy rows without explicit completeness are evaluated from their count,
  // discovery total and build health. A partial sample cannot replace a full row.
  const priorComplete = `CASE WHEN json_valid(prefetch_cache.data) AND json_valid(prefetch_cache.builds)
    THEN (${buildCountSQL("prefetch_cache.builds")}) >=
      CASE WHEN json_extract(prefetch_cache.data, '$.sourceMeta.total') BETWEEN 1 AND 99
        THEN json_extract(prefetch_cache.data, '$.sourceMeta.total') ELSE 100 END
      AND COALESCE(json_extract(prefetch_cache.data, '$.sourceMeta.buildHealth'), '') != 'partial'
      AND COALESCE(json_extract(prefetch_cache.data, '$.population.complete'), 1) = 1
    ELSE 0 END`;
  const result = await db
    .prepare(
      cp
        ? `INSERT INTO prefetch_cache (class, leaderboard, data, builds, fetched_at, expires_at, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(class, leaderboard) DO UPDATE SET
         data = json_set(excluded.data, '$.refresh', json_extract(prefetch_cache.data, '$.refresh')),
         builds = excluded.builds, fetched_at = excluded.fetched_at,
         expires_at = excluded.expires_at, source = excluded.source
       WHERE ? = 1 OR (NOT (${priorComplete}) AND
         CASE WHEN json_valid(prefetch_cache.builds) THEN (${buildCountSQL("prefetch_cache.builds")})
         ELSE 0 END <= ?)`
        : `INSERT OR REPLACE INTO prefetch_cache (class, leaderboard, data, builds, fetched_at, expires_at, source)
          VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      cls,
      populationKey(leaderboard, region),
      dataJson,
      buildsJson,
      now,
      now + ttlMs,
      source,
      ...(cp ? [population.complete ? 1 : 0, population.buildCount] : [])
    )
    .run();
  return { stored: (result.meta?.changes ?? result.changes ?? 1) > 0, ...population };
}

/**
 * Get all cache entries with metadata (for status endpoint).
 */
export async function getAllPrefetchEntries(db) {
  try {
    const { results } = await db
      .prepare(
        `SELECT class, leaderboard, fetched_at, expires_at, source,
          ${buildCountSQL("builds")} AS build_count,
          json_extract(data, '$.sourceMeta') AS source_meta,
          json_extract(data, '$.population') AS population,
          json_extract(data, '$.refresh.status') AS refresh_status,
          json_extract(data, '$.refresh.origin') AS refresh_origin,
          json_extract(data, '$.refresh.startedAt') AS refresh_started,
          json_extract(data, '$.refresh.leaseExpiresAt') AS refresh_expires,
          json_extract(data, '$.refresh.updatedAt') AS refresh_updated,
          json_extract(data, '$.refresh.error') AS refresh_error,
          json_extract(data, '$.refresh.lastSuccessAt') AS last_success
         FROM prefetch_cache ORDER BY fetched_at DESC`
      )
      .all();
    const now = Date.now();
    return results.map((r) => {
      const meta = JSON.parse(r.source_meta || "{}");
      const recorded = JSON.parse(r.population || "{}");
      const expectedCount = populationTarget({ sourceMeta: meta });
      const complete =
        recorded.complete ?? (r.build_count >= expectedCount && meta.buildHealth !== "partial");
      return {
        class: r.class,
        ...parsePopulationKey(r.leaderboard),
        cacheKey: r.leaderboard,
        fetchedAt: r.fetched_at,
        expiresAt: r.expires_at,
        source: r.source,
        isExpired: now > r.expires_at,
        ageMinutes: Math.round((now - r.fetched_at) / 60_000),
        buildCount: r.build_count || 0,
        expectedCount,
        complete,
        preparedBy: recorded.preparedBy || "unknown",
        discoveryDuplicatesIgnored: meta.discoveryDuplicatesIgnored || 0,
        lastSuccessfulRun: r.last_success || (complete ? r.fetched_at : null),
        refreshStatus: r.refresh_status || null,
        refreshStartedAt: r.refresh_started || null,
        refreshLeaseExpiresAt: r.refresh_expires || null,
        lastAttemptAt: r.refresh_updated || r.refresh_started || null,
        lastError: r.refresh_error || null,
      };
    });
  } catch {
    throw new Error("Prefetch cache status is unavailable.");
  }
}

/**
 * Delete all prefetch cache entries.
 */
export async function clearPrefetchCache(db) {
  await db.prepare("DELETE FROM prefetch_cache").run();
}
