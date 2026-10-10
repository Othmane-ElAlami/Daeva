import { populationKey, COMBAT_POWER, CP_SOURCE } from "../discovery-config.js";

// Coordinate cold population work in the existing cache row. Leases do not
// change the last usable builds, their timestamp or their expiry. No new table.
const LEASE_MS = 10 * 60000;

export async function claimRefresh(db, config, token = null, origin = "interactive") {
  if (!db || config.lbType !== COMBAT_POWER) return { acquired: true, token: null };
  const owner = token || crypto.randomUUID();
  const now = Date.now();
  const refresh = {
    owner,
    origin,
    status: "running",
    startedAt: now,
    leaseExpiresAt: now + LEASE_MS,
  };
  const row = await db
    .prepare(
      `
    INSERT INTO prefetch_cache (class, leaderboard, data, builds, fetched_at, expires_at, source)
    VALUES (?, ?, ?, '[]', 0, 0, ?)
    ON CONFLICT(class, leaderboard) DO UPDATE SET data =
      CASE WHEN json_extract(prefetch_cache.data, '$.refresh.owner') = ?
      THEN json_set(prefetch_cache.data, '$.refresh.leaseExpiresAt', ?)
      ELSE json_set(prefetch_cache.data, '$.refresh', json(?)) END
    WHERE COALESCE(json_extract(prefetch_cache.data, '$.refresh.leaseExpiresAt'), 0) <= ?
      OR json_extract(prefetch_cache.data, '$.refresh.owner') = ?
    RETURNING json_extract(data, '$.refresh') AS refresh
  `
    )
    .bind(
      config.cls,
      populationKey(config.lbType, config.region),
      JSON.stringify({ refresh }),
      CP_SOURCE,
      owner,
      now + LEASE_MS,
      JSON.stringify(refresh),
      now,
      owner
    )
    .first();
  return { acquired: !!row, token: row ? owner : null };
}

export async function updateRefresh(db, config, token, status, details = {}) {
  if (!db || !token) return;
  const now = Date.now();
  await db
    .prepare(
      `UPDATE prefetch_cache SET data = json_set(data,
    '$.refresh.status', ?, '$.refresh.updatedAt', ?, '$.refresh.leaseExpiresAt', ?,
    '$.refresh.buildCount', ?, '$.refresh.error', ?, '$.refresh.lastSuccessAt',
      CASE WHEN ? = 'complete' THEN ? ELSE json_extract(data, '$.refresh.lastSuccessAt') END)
    WHERE class = ? AND leaderboard = ? AND json_extract(data, '$.refresh.owner') = ?
  `
    )
    .bind(
      status,
      now,
      status === "running" ? now + LEASE_MS : 0,
      details.buildCount || 0,
      details.error || null,
      status,
      now,
      config.cls,
      populationKey(config.lbType, config.region),
      token
    )
    .run();
}
