// ─────────────────────────────────────────────────────────────────────────────
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
export async function getPrefetchCache(db, cls, leaderboard, allowStale = true) {
  try {
    const row = await db
      .prepare(
        "SELECT data, builds, fetched_at, expires_at, source FROM prefetch_cache WHERE class = ? AND leaderboard = ?"
      )
      .bind(cls, leaderboard)
      .first();
    if (!row) return null;
    const now = Date.now();
    if (now > row.expires_at && !allowStale) return null;
    return {
      data: JSON.parse(row.data),
      builds: JSON.parse(row.builds),
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
  source = "prefetch"
) {
  const now = Date.now();
  await db
    .prepare(
      `INSERT OR REPLACE INTO prefetch_cache (class, leaderboard, data, builds, fetched_at, expires_at, source)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(cls, leaderboard, JSON.stringify(data), JSON.stringify(builds), now, now + ttlMs, source)
    .run();
}

/**
 * Get all cache entries with metadata (for status endpoint).
 */
export async function getAllPrefetchEntries(db) {
  try {
    const { results } = await db
      .prepare(
        "SELECT class, leaderboard, fetched_at, expires_at, source FROM prefetch_cache ORDER BY fetched_at DESC"
      )
      .all();
    const now = Date.now();
    return results.map((r) => ({
      class: r.class,
      leaderboard: r.leaderboard,
      fetchedAt: r.fetched_at,
      expiresAt: r.expires_at,
      source: r.source,
      isExpired: now > r.expires_at,
      ageMinutes: Math.round((now - r.fetched_at) / 60_000),
    }));
  } catch {
    return [];
  }
}

/**
 * Delete all prefetch cache entries.
 */
export async function clearPrefetchCache(db) {
  await db.prepare("DELETE FROM prefetch_cache").run();
}
