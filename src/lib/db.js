const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function getCachedPlayer(db, characterId, serverId) {
  const row = await db
    .prepare(
      "SELECT equip_data, equip_details, fetched_at FROM player_cache WHERE character_id = ? AND server_id = ?",
    )
    .bind(String(characterId), String(serverId))
    .first();

  if (!row) return null;

  const age = Date.now() - row.fetched_at;
  if (age > CACHE_MAX_AGE_MS) return null;

  return {
    equipData: JSON.parse(row.equip_data),
    equipDetails: JSON.parse(row.equip_details),
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
) {
  await db
    .prepare(
      `INSERT OR REPLACE INTO player_cache
       (character_id, server_id, region, equip_data, equip_details, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      String(characterId),
      String(serverId),
      region || null,
      JSON.stringify(equipData),
      JSON.stringify(equipDetails),
      Date.now(),
    )
    .run();
}
