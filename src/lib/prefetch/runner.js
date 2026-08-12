// ─────────────────────────────────────────────────────────────────────────────
// Prefetch System — Job Runner (Edge Runtime)
// ─────────────────────────────────────────────────────────────────────────────
// Executes a single prefetch job for one class×leaderboard combination.
// Fetches top 100 players from shugo.gg, then concurrently fetches
// equipment/stats for each player using runPool. Produces enriched build
// data and aggregated stats.
//
// Designed to run within a Cloudflare Pages Function invocation. Uses the
// same subrequest budget system as the scrape route to stay within limits.
// ─────────────────────────────────────────────────────────────────────────────

import {
  baseUrl,
  leaderboardTypes,
  classRankingIds,
  makeHeaders,
  makeDirectHeaders,
  proxyUrl,
  fetchJSON,
  fetchWithRetry,
  runPool,
  createBudget,
  subrequestBudgetExhausted,
  extractItemLevelFromInfo,
  extractCombatPowerFromInfo,
  extractBuild,
  aggregate,
} from "@/lib/scraper-shared";
import { getLeaderboard as fetchLeaderboardProviders } from "@/lib/providers/leaderboard";

const PLAYER_CONCURRENCY = 5;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 500;

function extractCharKey(player) {
  const match = (player.profileImage || "").match(/[?&]charKey=(\d+)/);
  return match ? match[1] : player.characterId;
}

/**
 * Run a prefetch job for one class×leaderboard combination.
 * Fetches the top 100 players and their equipment data concurrently.
 *
 * @param {string} cls - Class name (e.g. "gladiator")
 * @param {string} lbType - Leaderboard type (e.g. "nightmare")
 * @returns {{ builds: Array, stats: object, playerCount: number, errors: string[], budgetUsed: number }}
 */
export async function runPrefetchJob(cls, lbType) {
  const errors = [];
  const lbInfo = leaderboardTypes[lbType];
  const rankingType = classRankingIds[cls];
  const headers = makeHeaders(`${baseUrl}/leaderboard/${lbType}?class=${cls}`);
  const budget = createBudget();

  // Phase 1: Fetch leaderboard page (top 100)
  let allPlayers;
  let lbSourceMeta;
  try {
    const result = await fetchLeaderboardProviders(
      {
        db,
        cls,
        lbType,
        lbInfo,
        rankingType,
        limit: 100,
        isFiltered: false,
        baseUrl,
        startPage: 1,
        maxPages: 1,
      },
      budget
    );
    allPlayers = result.rankings || [];
    lbSourceMeta = result.meta;

    if (lbSourceMeta.health === "partial" || lbSourceMeta.health === "unavailable") {
      throw new Error(`Leaderboard fetch health was ${lbSourceMeta.health}`);
    }
  } catch (err) {
    if (err instanceof subrequestBudgetExhausted) throw err;
    throw new Error(`Leaderboard fetch failed for ${cls}/${lbType}: ${err.message}`);
  }

  if (allPlayers.length === 0) {
    return {
      builds: [],
      stats: null,
      playerCount: 0,
      errors: ["Empty leaderboard"],
      budgetUsed: budget.used,
    };
  }

  // Phase 2: Deduplicate players
  const seen = new Set();
  const players = [];
  for (const p of allPlayers) {
    const key = `${p.characterId}_${p.serverId}`;
    if (!seen.has(key)) {
      seen.add(key);
      players.push(p);
    }
  }

  // Phase 3: Concurrent per-player fetch using runPool
  const allArcanaIds = [];

  const tasks = players.slice(0, 100).map((p) => async () => {
    const apiBase =
      p.region === "TW" ? "https://tw.ncsoft.com/aion2/api" : "https://aion2.plaync.com/api";

    // Fetch equipment (direct API with proxy fallback)
    let equipData;
    try {
      equipData = await fetchWithRetry(
        () =>
          fetchJSON(
            `${apiBase}/character/equipment?lang=en&characterId=${encodeURIComponent(p.characterId)}&serverId=${p.serverId}`,
            makeDirectHeaders(),
            budget
          ),
        MAX_RETRIES,
        RETRY_BASE_MS,
        budget
      );
    } catch {
      try {
        equipData = await fetchWithRetry(
          () =>
            fetchJSON(
              proxyUrl(
                `${apiBase}/character/equipment?lang=en&characterId=${encodeURIComponent(p.characterId)}&serverId=${p.serverId}`
              ),
              headers,
              budget
            ),
          MAX_RETRIES,
          RETRY_BASE_MS,
          budget
        );
      } catch {
        errors.push(`${p.characterName}: equipment fetch failed`);
        return null;
      }
    }

    if (!equipData?.equipment?.equipmentList?.length) {
      errors.push(`${p.characterName}: empty equipment list`);
      return null;
    }

    // Fetch equipment details (substats)
    let equipDetails = [];
    try {
      const eqList = equipData.equipment.equipmentList || [];
      const items = eqList
        .filter((e) => e)
        .map((e) => ({
          itemId: e.id,
          enchantLevel: e.enchantLevel || 0,
          slotPos: e.slotPos,
        }));
      const data = await fetchWithRetry(
        () =>
          fetchJSON(`${baseUrl}/api/items/batch-equipment`, headers, budget, "POST", {
            items,
            characterId: extractCharKey(p),
            serverId: p.serverId,
            region: p.region || "KR",
          }),
        MAX_RETRIES,
        RETRY_BASE_MS,
        budget
      );
      equipDetails = Array.isArray(data?.items || data) ? data?.items || data : [];
    } catch {
      errors.push(`${p.characterName}: substats failed`);
    }

    // Fetch item level and combat power
    let itemLevel = null;
    let cp = null;
    try {
      const infoData = await fetchWithRetry(
        () =>
          fetchJSON(
            `${apiBase}/character/info?lang=en&characterId=${p.characterId}&serverId=${p.serverId}`,
            makeDirectHeaders(),
            budget
          ),
        MAX_RETRIES,
        RETRY_BASE_MS,
        budget
      );
      itemLevel = extractItemLevelFromInfo(infoData);
      cp = extractCombatPowerFromInfo(infoData);
    } catch {
      try {
        const infoData = await fetchWithRetry(
          () =>
            fetchJSON(
              proxyUrl(
                `${apiBase}/character/info?lang=en&characterId=${p.characterId}&serverId=${p.serverId}`
              ),
              headers,
              budget
            ),
          MAX_RETRIES,
          RETRY_BASE_MS,
          budget
        );
        itemLevel = extractItemLevelFromInfo(infoData);
        cp = extractCombatPowerFromInfo(infoData);
      } catch {
        // Non-critical — continue without item level
      }
    }

    if (cp != null) {
      if (!equipData.profile) equipData.profile = {};
      equipData.profile.combatPower = cp;
    }

    for (const item of equipData.equipment.equipmentList || []) {
      if ((item.slotPosName || "").startsWith("Arcana")) allArcanaIds.push(item.id);
    }

    return {
      ...p,
      _equip: equipData,
      _equipDetails: equipDetails,
      _itemLevel: itemLevel,
      _combatPower: cp,
    };
  });

  const results = await runPool(tasks, PLAYER_CONCURRENCY, budget);
  const enriched = results.filter(Boolean);

  if (enriched.length === 0) {
    return { builds: [], stats: null, playerCount: 0, errors, budgetUsed: budget.used };
  }

  // Phase 4: Batch fetch arcana details
  const itemDetailsMap = {};
  if (allArcanaIds.length > 0) {
    try {
      const uniqueIds = [...new Set(allArcanaIds)];
      const data = await fetchWithRetry(
        () =>
          fetchJSON(`${baseUrl}/api/items/batch-details`, headers, budget, "POST", {
            itemIds: uniqueIds,
          }),
        MAX_RETRIES,
        RETRY_BASE_MS,
        budget
      );
      const items = Array.isArray(data?.items || data) ? data?.items || data : [];
      for (const item of items) {
        if (item?.itemId) itemDetailsMap[item.itemId] = item;
      }
    } catch {
      errors.push("Arcana batch fetch failed");
    }
  }

  // Phase 5: Extract builds and aggregate
  const builds = [];
  for (const p of enriched) {
    try {
      const build = extractBuild(
        p,
        itemDetailsMap,
        p._equipDetails || [],
        p._itemLevel,
        p._combatPower
      );
      builds.push(build);
    } catch {
      errors.push(`${p.characterName}: build extraction failed`);
    }
  }

  const stats = builds.length > 0 ? aggregate(builds) : null;

  return { builds, stats, playerCount: builds.length, errors, budgetUsed: budget.used };
}
