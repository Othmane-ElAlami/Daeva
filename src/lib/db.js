const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
import { normalizeRegion } from "./regions.js";

export function playerCacheId(characterId, region) {
  return `${normalizeRegion(region) || "UNKNOWN"}:${characterId}`;
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

  if (!row) return null;

  const age = Date.now() - row.fetched_at;
  if (age > CACHE_MAX_AGE_MS) return null;

  return {
    equipData: JSON.parse(row.equip_data),
    equipDetails: JSON.parse(row.equip_details),
    itemLevel: row.item_level != null ? Number(row.item_level) : null,
    fetchedAt: row.fetched_at,
  };
}

export async function setCachedPlayer(
  db,
  characterId,
  serverId,
  region,
  equipData,
  equipDetails,
  itemLevel = null
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
      JSON.stringify(equipData),
      JSON.stringify(equipDetails),
      itemLevel != null ? itemLevel : null,
      Date.now()
    )
    .run();
}
