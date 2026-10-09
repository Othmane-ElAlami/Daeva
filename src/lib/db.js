const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
import { normalizeRegion, characterKey } from "./regions.js";

export function playerCacheId(characterId, region) {
  return `${normalizeRegion(region) || "UNKNOWN"}:${characterId}`;
}

function cachedPlayer(row) {
  if (!row || Date.now() - row.fetched_at > CACHE_MAX_AGE_MS) return null;
  return {
    equipData: row.equip_data ? JSON.parse(row.equip_data) : null,
    equipDetails: row.equip_details ? JSON.parse(row.equip_details) : null,
    buildData: row.build_data ? JSON.parse(row.build_data) : null,
    cacheId: row.character_id,
    itemLevel: row.item_level != null ? Number(row.item_level) : null,
    fetchedAt: row.fetched_at,
  };
}

// Store a compact, versioned projection alongside the original official JSON.
// Selecting only this projection avoids repeatedly parsing item-detail payloads.
// Raw data and its timestamp stay intact; no schema migration is needed.
const cachedBuildColumns = `
  CASE WHEN json_extract(equip_data, '$._daevaBuildVersion') = 1
    THEN json_extract(equip_data, '$._daevaBuild') END AS build_data,
  CASE WHEN json_extract(equip_data, '$._daevaBuildVersion') = 1
    THEN NULL ELSE equip_data END AS equip_data,
  CASE WHEN json_extract(equip_data, '$._daevaBuildVersion') = 1
    THEN NULL ELSE equip_details END AS equip_details,
  item_level, fetched_at`;

export async function setNormalizedCachedBuild(db, cacheId, serverId, build, fetchedAt) {
  if (!db || !cacheId) return;
  await db
    .prepare(
      `UPDATE player_cache
     SET equip_data = json_set(equip_data, '$._daevaBuildVersion', 1, '$._daevaBuild', json(?))
     WHERE character_id = ? AND server_id = ? AND fetched_at = ?`
    )
    .bind(JSON.stringify(build), cacheId, String(serverId), fetchedAt)
    .run();
}

// D1 Free permits 50 queries per invocation, independently of the fetch budget.
// Read a population in bounded SQL queries rather than one query per character.
// Each statement stays below D1's 100-bound-parameter limit.
export async function getCachedPlayers(db, players) {
  const cached = new Map();
  if (!db || !players.length) return cached;
  const missing = [];
  for (let offset = 0; offset < players.length; offset += 40) {
    const group = players.slice(offset, offset + 40);
    const { results } = await db
      .prepare(
        `SELECT character_id, server_id, ${cachedBuildColumns}
         FROM player_cache WHERE (character_id, server_id) IN (${group.map(() => "(?, ?)").join(", ")})`
      )
      .bind(...group.flatMap((p) => [playerCacheId(p.characterId, p.region), String(p.serverId)]))
      .all();
    const rows = new Map(results.map((row) => [`${row.character_id}/${row.server_id}`, row]));
    for (const player of group) {
      const row = rows.get(
        `${playerCacheId(player.characterId, player.region)}/${player.serverId}`
      );
      if (row) cached.set(characterKey(player), cachedPlayer(row));
      else if (normalizeRegion(player.region)) missing.push(player);
    }
  }
  // Legacy unprefixed rows are reusable only for their recorded region.
  for (let offset = 0; offset < missing.length; offset += 30) {
    const group = missing.slice(offset, offset + 30);
    const { results } = await db
      .prepare(
        `SELECT character_id, server_id, region, ${cachedBuildColumns}
         FROM player_cache WHERE (character_id, server_id, region) IN (${group.map(() => "(?, ?, ?)").join(", ")})`
      )
      .bind(
        ...group.flatMap((p) => [
          String(p.characterId),
          String(p.serverId),
          normalizeRegion(p.region),
        ])
      )
      .all();
    const rows = new Map(
      results.map((row) => [
        characterKey({
          characterId: row.character_id,
          serverId: row.server_id,
          region: row.region,
        }),
        row,
      ])
    );
    for (const player of group)
      cached.set(characterKey(player), cachedPlayer(rows.get(characterKey(player))));
  }
  return cached;
}

export async function getCachedPlayer(db, characterId, serverId, region = "KR") {
  if (!db) return null;
  let row = await db
    .prepare(
      "SELECT equip_data, equip_details, item_level, fetched_at FROM player_cache WHERE character_id = ? AND server_id = ?"
    )
    .bind(playerCacheId(characterId, region), String(serverId))
    .first();

  // Reuse old rows only when their stored region matches. New rows coexist
  // using the existing TEXT key; no destructive table migration is needed.
  if (!row && normalizeRegion(region)) {
    row = await db
      .prepare(
        "SELECT equip_data, equip_details, item_level, fetched_at FROM player_cache WHERE character_id = ? AND server_id = ? AND region = ?"
      )
      .bind(String(characterId), String(serverId), normalizeRegion(region))
      .first();
  }

  return cachedPlayer(row);
}

export async function setCachedPlayer(
  db,
  characterId,
  serverId,
  region,
  equipData,
  equipDetails,
  itemLevel = null,
  normalizedBuild = null
) {
  if (!db) return;
  await db
    .prepare(
      `INSERT OR REPLACE INTO player_cache
       (character_id, server_id, region, equip_data, equip_details, item_level, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      playerCacheId(characterId, region),
      String(serverId),
      normalizeRegion(region),
      JSON.stringify(
        normalizedBuild
          ? { ...equipData, _daevaBuildVersion: 1, _daevaBuild: normalizedBuild }
          : equipData
      ),
      JSON.stringify(equipDetails),
      itemLevel != null ? itemLevel : null,
      Date.now()
    )
    .run();
}
