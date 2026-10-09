import { getCachedPlayer, getCachedPlayers, setCachedPlayer } from "./db.js";
import { characterApiUrl, characterKey } from "./regions.js";
import {
  fetchJSON,
  makeDirectHeaders,
  makeHeaders,
  proxyUrl,
  baseUrl,
  extractItemLevelFromInfo,
  extractCombatPowerFromInfo,
  extractBuild,
  runPool,
  subrequestBudgetExhausted,
} from "./scraper-shared.js";

async function officialJSON(player, path, budget, extra = {}) {
  const url = characterApiUrl(player, path, extra);
  try {
    return await fetchJSON(url, makeDirectHeaders(), "GET", null, budget);
  } catch (error) {
    if (error instanceof subrequestBudgetExhausted) throw error;
    // The fallback transports the same first-party JSON, never Shugo build HTML.
    return await fetchJSON(
      proxyUrl(url),
      makeHeaders(`${baseUrl}/leaderboard`),
      "GET",
      null,
      budget
    );
  }
}

function buildFromData(player, equipData, equipDetails, itemLevel, combatPower, fetchedAt) {
  const itemDetails = {};
  for (const detail of equipDetails) if (detail?.id) itemDetails[detail.id] = detail;
  return {
    ...extractBuild(
      { ...player, _equip: equipData },
      itemDetails,
      equipDetails,
      itemLevel,
      combatPower
    ),
    buildFetchedAt: fetchedAt,
  };
}

export async function loadCachedBuild(db, player) {
  const cached = await getCachedPlayer(db, player.characterId, player.serverId, player.region);
  return buildFromCache(player, cached);
}

export async function loadCachedBuilds(db, players) {
  const cached = await getCachedPlayers(db, players);
  return new Map(
    players.map((player) => [
      characterKey(player),
      buildFromCache(player, cached.get(characterKey(player))),
    ])
  );
}

function buildFromCache(player, cached) {
  const equipment = cached?.equipData?.equipment?.equipmentList?.filter(Boolean);
  if (
    !equipment?.length ||
    !cached.equipData.skill?.skillList?.length ||
    !Array.isArray(cached.equipDetails) ||
    cached.equipDetails.length !== equipment.length ||
    equipment.some(
      (item) =>
        !cached.equipDetails.some(
          (detail) => detail?.id === item.id && detail.slotPos === item.slotPos
        )
    )
  )
    return null;
  return buildFromData(
    player,
    cached.equipData,
    cached.equipDetails,
    cached.itemLevel,
    cached.equipData.profile?.combatPower ?? null,
    cached.fetchedAt
  );
}

// Official item detail calls cost one subrequest each. Both interactive analysis
// and scheduled prefetch use the same budget/continuation path instead of dropping
// arcana, rune or stone data to make a top-100 job fit one invocation.
export async function fetchCharacterBuild(
  player,
  db,
  budget,
  { refresh = false, cachedBuild } = {}
) {
  if (player._build) return { build: player._build, warnings: [] };
  const cached = cachedBuild === undefined ? await loadCachedBuild(db, player) : cachedBuild;
  if (cached && !refresh && Date.now() - cached.buildFetchedAt < 6 * 60 * 60 * 1000)
    return { build: cached, warnings: [], cached: true, resumable: true };
  if (!budget.canAfford(3)) throw new subrequestBudgetExhausted(budget.used, budget.hardLimit);
  const [equipData, infoData] = await Promise.all([
    officialJSON(player, "equipment", budget),
    officialJSON(player, "info", budget),
  ]);
  if (!equipData?.equipment?.equipmentList?.length || !equipData.skill?.skillList?.length)
    throw new Error("Official character equipment/skills are unavailable.");
  if (
    !infoData?.profile ||
    String(infoData.profile.characterId) !== player.characterId ||
    Number(infoData.profile.serverId) !== Number(player.serverId)
  )
    throw new Error("Official profile identifiers do not match discovery.");
  const combatPower = extractCombatPowerFromInfo(infoData);
  const itemLevel = extractItemLevelFromInfo(infoData);
  if (combatPower == null || itemLevel == null)
    throw new Error("Official character stats are unavailable.");
  const equipment = equipData.equipment.equipmentList.filter(Boolean);
  if (!budget.canAfford(equipment.length + 1)) throw new subrequestBudgetExhausted(budget.used);
  const warnings = [];
  const results = await runPool(
    equipment.map((item) => async () => {
      try {
        const detail = await officialJSON(player, "equipment/item", budget, {
          id: String(item.id),
          enchantLevel: String(item.enchantLevel || 0),
          slotPos: String(item.slotPos),
        });
        if (!detail?.id || !detail.name || String(detail.id) !== String(item.id))
          throw new Error("Malformed official item details.");
        return { ...detail, id: item.id, slotPos: item.slotPos };
      } catch (error) {
        if (error instanceof subrequestBudgetExhausted) return error;
        warnings.push(`${item.name}: item details unavailable`);
        return null;
      }
    }),
    2,
    budget
  );
  if (
    results.filter((result) => result !== undefined).length !== equipment.length ||
    results.some((result) => result instanceof subrequestBudgetExhausted) ||
    !budget.canAfford()
  )
    throw new subrequestBudgetExhausted(budget.used);
  const equipDetails = results.filter(Boolean);
  // Preserve equipment/skill results even if individual item details fail, but
  // do not promote an incomplete build into the reusable player cache.
  equipData.profile = { ...infoData.profile };
  const fetchedAt = Date.now();
  if (!warnings.length && equipDetails.length === equipment.length) {
    await setCachedPlayer(
      db,
      player.characterId,
      player.serverId,
      player.region,
      equipData,
      equipDetails,
      itemLevel
    );
  }
  return {
    build: buildFromData(player, equipData, equipDetails, itemLevel, combatPower, fetchedAt),
    warnings,
    resumable: !!db && !warnings.length && equipDetails.length === equipment.length,
  };
}
