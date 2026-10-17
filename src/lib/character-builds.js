import {
  getCachedPlayer,
  getCachedPlayers,
  setCachedPlayer,
  setNormalizedCachedBuild,
} from "./db.js";
import { characterApiUrl, characterKey } from "./regions.js";
import { unavailableCode } from "./prefetch/unavailable.js";
import {
  fetchJSON,
  makeDirectHeaders,
  makeHeaders,
  proxyUrl,
  baseUrl,
  extractItemLevelFromInfo,
  extractCombatPowerFromInfo,
  extractBuild,
  buildPlayerMetadata,
  runPool,
  subrequestBudgetExhausted,
  sleep,
} from "./scraper-shared.js";

export const BUILD_FRESH_MS = 6 * 60 * 60 * 1000;

function unavailable(message, code, retryable = true) {
  const error = new Error(message);
  Object.assign(error, { code, retryable });
  return error;
}

async function officialJSON(
  player,
  path,
  budget,
  extra = {},
  validate = () => {},
  requestJSON = fetchJSON
) {
  const url = characterApiUrl(player, path, extra);
  async function read(target, headers) {
    const data = await requestJSON(target, headers, "GET", null, budget, null, 20000, validate);
    validate(data);
    return data;
  }
  try {
    return await read(url, makeDirectHeaders());
  } catch (error) {
    if (error instanceof subrequestBudgetExhausted || error.code === "LEASE_LOST") throw error;
    // The fallback transports the same first-party JSON, never Shugo build HTML.
    try {
      return await read(proxyUrl(url), makeHeaders(`${baseUrl}/leaderboard`));
    } catch (fallbackError) {
      if (fallbackError !== error) fallbackError.officialFailure = error;
      throw fallbackError;
    }
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

export async function loadCachedBuilds(db, players, { normalize = false, maxAgeMs } = {}) {
  const cached = await getCachedPlayers(db, players, { maxAgeMs });
  const builds = new Map();
  for (const player of players) {
    const key = characterKey(player);
    const row = cached.get(key);
    const build = buildFromCache(player, row);
    builds.set(key, build);
    if (normalize && build && !row.buildData)
      await setNormalizedCachedBuild(db, row.cacheId, player.serverId, build, row.fetchedAt);
  }
  return builds;
}

function buildFromCache(player, cached) {
  const normalized =
    cached?.buildData ||
    (cached?.equipData?._daevaBuildVersion === 1 ? cached.equipData._daevaBuild : null);
  if (normalized) {
    if (
      normalized.characterId !== player.characterId ||
      normalized.region !== player.region ||
      Number(normalized.serverId) !== Number(player.serverId) ||
      [
        "activeSkills",
        "stigmaSkills",
        "passiveSkills",
        "arcanas",
        "arcanaSets",
        "equipSubStats",
        "equipItems",
        "theostones",
        "manastones",
      ].some((key) => !Array.isArray(normalized[key])) ||
      !normalized.activeSkills?.length ||
      !normalized.equipItems?.length
    )
      return null;
    return {
      ...normalized,
      ...buildPlayerMetadata(player, { factionName: normalized.faction }),
      buildFetchedAt: cached.fetchedAt,
    };
  }
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

function validateEquipment(data) {
  if (!data?.equipment?.equipmentList?.length || !data.skill?.skillList?.length)
    throw unavailable(
      "Official character equipment/skills are unavailable.",
      "EQUIPMENT_UNAVAILABLE"
    );
}

// Official item detail calls cost one subrequest each. Both interactive analysis
// and scheduled prefetch use the same budget/continuation path instead of dropping
// arcana, rune or stone data to make a top-100 job fit one invocation.
export async function fetchCharacterBuild(
  player,
  db,
  budget,
  {
    refresh = false,
    cachedBuild,
    retryItemDetails = false,
    retryEquipmentChanges = false,
    requestJSON = fetchJSON,
  } = {}
) {
  if (player._build) return { build: player._build, warnings: [] };
  const cached = cachedBuild === undefined ? await loadCachedBuild(db, player) : cachedBuild;
  if (!refresh && isFreshBuild(cached))
    return { build: cached, warnings: [], cached: true, resumable: true };
  if (!budget.canAfford(3)) throw new subrequestBudgetExhausted(budget.used, budget.hardLimit);
  const characterData = await Promise.allSettled([
    officialJSON(player, "equipment", budget, {}, validateEquipment, requestJSON),
    officialJSON(
      player,
      "info",
      budget,
      {},
      (data) => {
        if (!data?.profile)
          throw unavailable("Official character profile is unavailable.", "PROFILE_UNAVAILABLE");
        if (
          String(data.profile.characterId) !== player.characterId ||
          Number(data.profile.serverId) !== Number(player.serverId)
        )
          throw unavailable(
            "Official profile identifiers do not match discovery.",
            "PROFILE_IDENTITY_MISMATCH",
            false
          );
        const combatPower = extractCombatPowerFromInfo(data);
        const itemLevel = extractItemLevelFromInfo(data);
        if (!Number.isFinite(combatPower) || combatPower <= 0 || !Number.isFinite(itemLevel))
          throw unavailable("Official character stats are unavailable.", "STATS_UNAVAILABLE");
      },
      requestJSON
    ),
  ]);
  // Settle both requests before omitting a character or advancing its lease.
  // A fast profile failure must not leave equipment retries running after this
  // build returns, nor hide a simultaneous rate limit/authentication failure.
  const failures = characterData
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason);
  if (failures.length)
    throw (
      failures.find(
        (error) =>
          error instanceof subrequestBudgetExhausted ||
          ["LEASE_LOST", "PREFETCH_DEADLINE"].includes(error.code)
      ) ||
      failures.find((error) => !unavailableCode(error)) ||
      failures[0]
    );
  const [equipData, infoData] = characterData.map((result) => result.value);
  const combatPower = extractCombatPowerFromInfo(infoData);
  const itemLevel = extractItemLevelFromInfo(infoData);
  const equipment = equipData.equipment.equipmentList.filter(Boolean);
  if (!budget.canAfford(equipment.length + 1)) throw new subrequestBudgetExhausted(budget.used);
  const warnings = [];
  const failedItems = [];
  const itemFailures = [];
  const results = await runPool(
    equipment.map((item) => async () => {
      try {
        // A bad HTTP-200 item payload also gets the first-party proxy fallback.
        // Scheduled Node jobs retry only this item once, retaining other details.
        const attempts = retryItemDetails ? 2 : 1;
        for (let attempt = 0; attempt < attempts; attempt++) {
          try {
            const detail = await officialJSON(
              player,
              "equipment/item",
              budget,
              {
                id: String(item.id),
                enchantLevel: String(item.enchantLevel || 0),
                slotPos: String(item.slotPos),
              },
              (data) => {
                if (!data?.id || !data.name || String(data.id) !== String(item.id))
                  throw unavailable("Malformed official item details.", "ITEM_UNAVAILABLE");
              },
              requestJSON
            );
            return { ...detail, id: item.id, slotPos: item.slotPos };
          } catch (error) {
            if (
              error instanceof subrequestBudgetExhausted ||
              error.retryExhausted ||
              attempt === attempts - 1
            )
              throw error;
            await sleep(500);
          }
        }
      } catch (error) {
        if (error instanceof subrequestBudgetExhausted) return error;
        if (error.code === "LEASE_LOST") return error;
        failedItems.push(item);
        itemFailures.push(error);
        warnings.push(`${item.name} (id ${item.id}, slot ${item.slotPos}): ${error.message}`);
        return null;
      }
    }),
    2,
    budget
  );
  const leaseLost = results.find((result) => result?.code === "LEASE_LOST");
  if (leaseLost) throw leaseLost;
  if (
    results.filter((result) => result !== undefined).length !== equipment.length ||
    results.some((result) => result instanceof subrequestBudgetExhausted) ||
    !budget.canAfford()
  )
    throw new subrequestBudgetExhausted(budget.used);
  if (failedItems.length && retryEquipmentChanges) {
    let latest;
    try {
      latest = await officialJSON(player, "equipment", budget, {}, validateEquipment, requestJSON);
    } catch (error) {
      if (error instanceof subrequestBudgetExhausted || error.code === "LEASE_LOST") throw error;
      // The original incomplete result still fails scheduled publication.
    }
    const changed =
      latest &&
      failedItems.some((item) => {
        const current = latest.equipment.equipmentList.find(
          (candidate) => candidate && String(candidate.slotPos) === String(item.slotPos)
        );
        return (
          !current ||
          ["id", "enchantLevel", "exceedLevel"].some(
            (field) => String(current[field] ?? 0) !== String(item[field] ?? 0)
          )
        );
      });
    if (changed) {
      // Rebuild the whole character from fresh official responses once. Mixing
      // the original skills/gear with a replacement item's details is unsafe.
      try {
        const result = await fetchCharacterBuild(player, db, budget, {
          refresh: true,
          cachedBuild: null,
          retryItemDetails,
          retryEquipmentChanges: false,
          requestJSON,
        });
        return { ...result, equipmentRefreshed: true };
      } catch (error) {
        if (error instanceof subrequestBudgetExhausted || error.code === "LEASE_LOST") throw error;
        const problem = new Error(`Changed equipment refresh failed: ${error.message}`);
        problem.code = "EQUIPMENT_REFRESH_FAILED";
        throw problem;
      }
    }
  }
  const equipDetails = results.filter(Boolean);
  // Preserve equipment/skill results even if individual item details fail, but
  // do not promote an incomplete build into the reusable player cache.
  equipData.profile = { ...infoData.profile };
  const fetchedAt = Date.now();
  const build = buildFromData(player, equipData, equipDetails, itemLevel, combatPower, fetchedAt);
  if (!warnings.length && equipDetails.length === equipment.length) {
    await setCachedPlayer(
      db,
      player.characterId,
      player.serverId,
      player.region,
      equipData,
      equipDetails,
      itemLevel,
      build
    );
  }
  return {
    build,
    warnings,
    itemFailures,
    resumable: !!db && !warnings.length && equipDetails.length === equipment.length,
  };
}

export function isFreshBuild(build) {
  const age = Date.now() - build?.buildFetchedAt;
  return !!build && Number.isFinite(age) && age >= 0 && age < BUILD_FRESH_MS;
}
