import { getCachedPlayer, setCachedPlayer } from "@/lib/db";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { createWebLogger } from "@/lib/logger";
import {
  baseUrl,
  leaderboardTypes,
  classRankingIds,
  classWeapons,
  makeHeaders,
  makeDirectHeaders,
  proxyUrl,
  fetchJSON,
  fetchWithRetry,
  runPool,
  subrequestBudgetExhausted,
  createBudget,
  fetchItemLevelAndCP,
  extractItemLevelFromInfo,
  extractCombatPowerFromInfo,
  extractBuild,
  aggregate,
} from "@/lib/scraper-shared";

export const runtime = "edge";

// Sanitize error messages so internal/infrastructure details are never shown to users.
function sanitizeErrorMessage(msg) {
  if (!msg) return "An unexpected error occurred. Please try again.";
  const internalPatterns = [
    /subrequest/i,
    /worker invocation/i,
    /cloudflare/i,
    /wrangler/i,
    /D1_ERROR/i,
    /SQLITE/i,
    /too many/i,
    /developers\.cloudflare/i,
    /binding/i,
    /UnsafeEval/i,
  ];
  for (const pattern of internalPatterns) {
    if (pattern.test(msg)) {
      return "The server is temporarily busy. Please try again with a smaller limit or wait a moment.";
    }
  }
  if (msg.startsWith("HTTP ")) {
    return "A network error occurred while fetching data. Please try again.";
  }
  return "An unexpected error occurred. Please try again.";
}

const MAX_LIMIT = 100;
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

// Extract top skills by usage count for the landing page meta snapshot widget.
function topSkills(skillMap, total, limit = 6) {
  return Object.entries(skillMap)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, limit)
    .map(([name, data]) => ({
      name,
      count: data.count,
      pct: +((data.count / total) * 100).toFixed(1),
      avgLv: data.avgLv,
    }));
}

// Save aggregated stats as a meta snapshot for the landing page widget.
async function saveMetaSnapshot(db, cls, lbType, stats) {
  if (!stats || stats.total < 5) return; // don't save tiny samples

  const stigmas = topSkills(stats.stigmaSkills, stats.total);
  const actives = topSkills(stats.activeSkills, stats.total);
  const passives = topSkills(stats.passiveSkills, stats.total);

  // Top arcana set combos with usage pct
  const combos = Object.entries(stats.arcanaSetCombos || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([combo, count]) => ({
      combo,
      count,
      pct: +((count / stats.total) * 100).toFixed(1),
    }));

  await db
    .prepare(
      `INSERT OR REPLACE INTO meta_snapshots
       (class, leaderboard, total_players, stigma_skills, active_skills, passive_skills, arcana_set_combos, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      cls,
      lbType,
      stats.total,
      JSON.stringify(stigmas),
      JSON.stringify(actives),
      JSON.stringify(passives),
      JSON.stringify(combos),
      Date.now(),
    )
    .run();
}

export async function POST(req) {
  const { env } = getRequestContext();
  const db = env.DB;

  // --- Rate limiting: 1 analysis per minute per IP ---
  // Only trust cf-connecting-ip (set by Cloudflare) — x-forwarded-for is trivially spoofable.
  const ip = req.headers.get("cf-connecting-ip") || "unknown";
  const now = Date.now();

  try {
    const row = await db
      .prepare("SELECT last_request_at FROM rate_limits WHERE ip = ?")
      .bind(ip)
      .first();

    if (row && now - row.last_request_at < RATE_LIMIT_WINDOW_MS) {
      const retryAfter = Math.ceil(
        (RATE_LIMIT_WINDOW_MS - (now - row.last_request_at)) / 1000,
      );
      return new Response(
        JSON.stringify({
          error: `Rate limit exceeded. Please wait ${retryAfter}s before starting another analysis.`,
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(retryAfter),
          },
        },
      );
    }

    await db
      .prepare(
        "INSERT INTO rate_limits (ip, last_request_at) VALUES (?, ?) ON CONFLICT(ip) DO UPDATE SET last_request_at = excluded.last_request_at",
      )
      .bind(ip, now)
      .run();
  } catch (err) {
    // Only skip rate limiting if the table hasn't been created yet.
    // Re-throw all other DB errors to avoid silently disabling rate limits.
    if (err?.message && /no such table/i.test(err.message)) {
      // Table not yet migrated — proceed without rate limiting
    } else {
      console.error("[rate-limit] DB error:", err?.message || err);
    }
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { lbType, cls, region, serverId } = body;

  // --- Input validation: whitelist all user-provided values ---
  if (!lbType || !leaderboardTypes[lbType]) {
    return new Response(
      JSON.stringify({ error: "Invalid leaderboard type." }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  if (!cls || !classRankingIds[cls]) {
    return new Response(JSON.stringify({ error: "Invalid class." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const limit = Math.max(1, Math.min(parseInt(body.limit) || 10, MAX_LIMIT));

  const lbInfo = leaderboardTypes[lbType];
  const rankingType = classRankingIds[cls];
  const headers = makeHeaders(`${baseUrl}/leaderboard/${lbType}?class=${cls}`);

  // Tuning: max concurrent API requests for player data
  const concurrency = 15;
  const maxRetries = 2;
  const retryBaseMs = 400;
  const budget = createBudget();

  const encoder = new TextEncoder();
  let isActive = true;
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (data) => {
        if (!isActive) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`),
          );
        } catch (e) {
          isActive = false;
        }
      };

      const log = createWebLogger(sendEvent);
      const enriched = [];
      const allArcanaIds = [];

      try {
        // ═══════════════════════════════════════════════════════════════════
        // PHASE 1: Fetch all leaderboard pages in parallel
        // ═══════════════════════════════════════════════════════════════════
        log.info("leaderboard", `Searching ${lbInfo.label} rankings...`);

        // Estimate how many pages we need (100 per page), fetch them concurrently
        // When filtering by server/region, we need many more pages since most
        // entries will be discarded by the client-side filter.
        const isFiltered =
          (region && region !== "all") || (serverId && serverId !== "all");
        const pagesNeeded = Math.min(
          Math.ceil((limit * (isFiltered ? 8 : 1.5)) / 100),
          20,
        );
        const lbPageTasks = Array.from({ length: pagesNeeded }, (_, i) => {
          const pg = i + 1;
          return async () => {
            const url = `${baseUrl}/api/leaderboard?contentType=${lbInfo.contentType}&rankingType=${rankingType}&page=${pg}&limit=100`;
            try {
              const data = await fetchWithRetry(
                () => fetchJSON(url, headers, "GET", null, budget, log),
                maxRetries,
                retryBaseMs,
                budget,
              );
              return data?.rankings || [];
            } catch (err) {
              if (err instanceof subrequestBudgetExhausted) throw err;
              return [];
            }
          };
        });

        const lbResults = await runPool(lbPageTasks, 5, budget);
        const rawPlayers = lbResults.flat().filter(Boolean);

        // Deduplicate by characterId + serverId
        const seen = new Set();
        let allPlayers = [];
        for (const p of rawPlayers) {
          const key = `${p.characterId}_${p.serverId}`;
          if (!seen.has(key)) {
            seen.add(key);
            allPlayers.push(p);
          }
        }

        log.info(
          "leaderboard",
          `Found ${allPlayers.length} players to analyze.`,
        );

        // ═══════════════════════════════════════════════════════════════════
        // PHASE 2: Filter by region/server, then split cached vs uncached
        // ═══════════════════════════════════════════════════════════════════
        let candidates = allPlayers;
        if (region && region !== "all") {
          candidates = candidates.filter((p) => p.region === region);
        }
        if (serverId && serverId !== "all") {
          candidates = candidates.filter(
            (p) => String(p.serverId) === String(serverId),
          );
        }

        // Batch cache lookup: separate cached from uncached up-front
        const cachedResults = [];
        const uncachedPlayers = [];

        for (const p of candidates) {
          if (cachedResults.length + uncachedPlayers.length >= limit * 2) break;
          const cached = await getCachedPlayer(db, p.characterId, p.serverId);
          if (cached) {
            const hasEquip = !!cached.equipData;
            const equipCount =
              cached.equipData?.equipment?.equipmentList?.length || 0;
            const detailCount = Array.isArray(cached.equipDetails)
              ? cached.equipDetails.length
              : 0;
            const isComplete = hasEquip && detailCount > 0;

            if (isComplete) {
              const result = {
                ...p,
                _equip: cached.equipData,
                _equipDetails: cached.equipDetails,
                _itemLevel: cached.itemLevel ?? null,
                _combatPower: cached.equipData?.profile?.combatPower ?? null,
              };
              cachedResults.push(result);
              for (const item of result._equip?.equipment?.equipmentList ||
                []) {
                if ((item.slotPosName || "").startsWith("Arcana"))
                  allArcanaIds.push(item.id);
              }
            } else {
              // Incomplete cache — schedule for re-fetch
              log.warn(
                p.characterName,
                `Cached data incomplete, re-fetching...`,
              );
              uncachedPlayers.push(p);
            }
          } else {
            uncachedPlayers.push(p);
          }
        }

        // Report valid cached hits
        for (const r of cachedResults) {
          if (enriched.length >= limit) break;
          enriched.push(r);
          const equipCount = r._equip?.equipment?.equipmentList?.length || 0;
          const detailCount = Array.isArray(r._equipDetails)
            ? r._equipDetails.length
            : 0;
          const cachedGs = r._itemLevel;
          log.success(
            r.characterName,
            `Loaded from cache${cachedGs ? ` (GS: ${cachedGs})` : ""} (${enriched.length}/${limit})`,
          );
        }

        if (enriched.length >= limit) {
          // All from cache — skip network phase entirely
          sendEvent({
            type: "progress",
            current: enriched.length,
            total: limit,
            target: "",
          });
        }

        const stillNeeded = limit - enriched.length;
        log.info(
          "cache",
          `${cachedResults.length} players loaded from cache, ${Math.min(uncachedPlayers.length, stillNeeded)} remaining.`,
        );

        // ═══════════════════════════════════════════════════════════════════
        // PHASE 3: Fetch uncached players concurrently in batches
        // ═══════════════════════════════════════════════════════════════════
        const remaining = limit - enriched.length;
        const toFetch = uncachedPlayers.slice(
          0,
          remaining + Math.ceil(remaining * 0.3),
        );

        if (toFetch.length > 0 && remaining > 0) {
          // reservedCount: incremented synchronously at task start to prevent over-fetching
          // doneCount: incremented at task completion for sequential display numbers
          let reservedCount = enriched.length;
          let doneCount = enriched.length;

          // Build task list: each task fetches equip + details for one player
          const playerTasks = toFetch.map((p) => async () => {
            if (!isActive || reservedCount >= limit || !budget.canAfford(3))
              return null;

            // Reserve the slot synchronously (before any await)
            reservedCount++;

            sendEvent({
              type: "progress",
              current: reservedCount,
              total: limit,
              target: p.characterName,
            });

            let result = { ...p };
            let equipDetails = [];

            let warnings = [];
            try {
              // 1. Fetch equipment — try direct first (avoids proxy HTTP 500)
              try {
                const apiBase =
                  p.region === "TW"
                    ? "https://tw.ncsoft.com/aion2/api"
                    : "https://aion2.plaync.com/api";
                const targetPath = `/character/equipment?lang=en&characterId=${encodeURIComponent(p.characterId)}&serverId=${p.serverId}`;
                let equipData;
                try {
                  equipData = await fetchWithRetry(
                    () =>
                      fetchJSON(
                        `${apiBase}${targetPath}`,
                        makeDirectHeaders(),
                        "GET",
                        null,
                        budget,
                        log,
                      ),
                    maxRetries,
                    retryBaseMs,
                    budget,
                  );
                } catch (directErr) {
                  if (directErr instanceof subrequestBudgetExhausted)
                    throw directErr;
                  // Fallback: Try proxy only if we have budget
                  if (budget.canAfford()) {
                    log.warn(
                      p.characterName,
                      `Retrying with alternate method...`,
                    );
                    equipData = await fetchWithRetry(
                      () =>
                        fetchJSON(
                          proxyUrl(`${apiBase}${targetPath}`),
                          headers,
                          "GET",
                          null,
                          budget,
                          log,
                        ),
                      maxRetries,
                      retryBaseMs,
                      budget,
                    );
                  } else {
                    throw directErr;
                  }
                }

                if (equipData?.equipment?.equipmentList?.length) {
                  result._equip = equipData;
                } else {
                  throw new Error("Empty equipmentList");
                }
              } catch (err) {
                if (err instanceof subrequestBudgetExhausted) throw err;
                warnings.push(`Gear Failed: ${err.message}`);
                result._equip = null;
              }

              // 2. Fetch equipment details (substats) if we have gear
              if (result._equip) {
                try {
                  const eqList = result._equip.equipment.equipmentList || [];
                  const items = eqList
                    .filter((e) => e)
                    .map((e) => ({
                      itemId: e.id,
                      enchantLevel: e.enchantLevel || 0,
                      slotPos: e.slotPos,
                    }));
                  const data = await fetchWithRetry(
                    () =>
                      fetchJSON(
                        `${baseUrl}/api/items/batch-equipment`,
                        headers,
                        "POST",
                        {
                          items,
                          characterId: p.characterId,
                          serverId: p.serverId,
                          region: p.region || "KR",
                        },
                        budget,
                        log,
                      ),
                    maxRetries,
                    retryBaseMs,
                    budget,
                  );
                  equipDetails = Array.isArray(data?.items || data)
                    ? data?.items || data
                    : [];
                } catch (err) {
                  if (err instanceof subrequestBudgetExhausted) throw err;
                  warnings.push(`Substats Failed: ${err.message}`);
                }
              }

              result._equipDetails = equipDetails;

              // ... 3. Class validation — use item names from direct API,
              // NOT categoryName from batch-equipment (which returns null items).
              const clsLower = (cls || "").toLowerCase();
              const primaryWeapon = classWeapons[clsLower];

              if (primaryWeapon && result._equip) {
                const validLabels = Array.isArray(primaryWeapon)
                  ? [...primaryWeapon]
                  : [primaryWeapon];
                if (validLabels.includes("Staff")) validLabels.push("法杖"); // TW localized

                let hasValidWeapon = false;
                const eqList = result._equip.equipment?.equipmentList || [];
                for (const item of eqList) {
                  if (!item) continue;
                  if (item.slotPos === 1 || item.slotPos === 2) {
                    const itemName = item.name || "";
                    const cat = item.categoryName || "";
                    if (
                      validLabels.some(
                        (label) =>
                          itemName.includes(label) || cat.startsWith(label),
                      )
                    ) {
                      hasValidWeapon = true;
                      break;
                    }
                  }
                }

                if (!hasValidWeapon) {
                  warnings.push("Mismatched Weapon");
                  result._equip = null;
                  result._equipDetails = [];
                  equipDetails = [];
                }
              }
            } catch (err) {
              if (err instanceof subrequestBudgetExhausted) throw err;
              warnings.push(`Error: ${err.message}`);
            }

            // 4. Always fetch ItemLevel and CP — try direct first, proxy fallback
            let itemLevel = null;
            let cp = null;
            try {
              const gsApiBase =
                p.region === "TW"
                  ? "https://tw.ncsoft.com/aion2/api"
                  : "https://aion2.plaync.com/api";
              const infoData = await fetchJSON(
                `${gsApiBase}/character/info?lang=en&characterId=${p.characterId}&serverId=${p.serverId}`,
                makeDirectHeaders(),
                "GET",
                null,
                budget,
                log,
              );
              itemLevel = extractItemLevelFromInfo(infoData);
              cp = extractCombatPowerFromInfo(infoData);
            } catch {
              const stats = await fetchItemLevelAndCP(p, headers, budget, log);
              if (stats) {
                itemLevel = stats.itemLevel;
                cp = stats.combatPower;
              }
            }
            result._itemLevel = itemLevel;
            result._combatPower = cp;

            // Inject CP into equipData before caching
            if (result._equip && cp != null) {
              if (!result._equip.profile) result._equip.profile = {};
              result._equip.profile.combatPower = cp;
            }

            // 5. Cache the result
            await setCachedPlayer(
              db,
              p.characterId,
              p.serverId,
              p.region,
              result._equip,
              equipDetails,
              itemLevel,
            );

            const playerNum = ++doneCount;
            const warningStr =
              warnings.length > 0 ? ` [${warnings.join(", ")}]` : "";
            const statsStr = [
              itemLevel ? `GS: ${itemLevel}` : "",
              cp ? `CP: ${cp}` : "",
            ]
              .filter(Boolean)
              .join(" | ");
            if (warnings.length > 0) {
              log.warn(
                p.characterName,
                `Scanned${statsStr ? ` (${statsStr})` : ""} (${playerNum}/${limit})${warningStr}`,
              );
            } else {
              log.success(
                p.characterName,
                `Scanned${statsStr ? ` (${statsStr})` : ""} (${playerNum}/${limit})`,
              );
            }

            return result;
          });

          // Run all player tasks with concurrency pool
          const results = await runPool(playerTasks, concurrency, budget);

          // Collect successful results
          for (const r of results) {
            if (!r || enriched.length >= limit) continue;
            enriched.push(r);
            for (const item of r._equip?.equipment?.equipmentList || []) {
              if ((item.slotPosName || "").startsWith("Arcana"))
                allArcanaIds.push(item.id);
            }
          }
        }

        // ═══════════════════════════════════════════════════════════════════
        // PHASE 3b: Fetch additional leaderboard pages if still short
        // ═══════════════════════════════════════════════════════════════════
        if (enriched.length < limit && budget.canAfford(5)) {
          let extraPage = pagesNeeded + 1;
          while (enriched.length < limit && extraPage <= 50) {
            if (!isActive || !budget.canAfford(5)) break;
            log.info(
              "leaderboard",
              `Searching for more players (page ${extraPage})...`,
            );
            const url = `${baseUrl}/api/leaderboard?contentType=${lbInfo.contentType}&rankingType=${rankingType}&page=${extraPage}&limit=100`;
            let moreRankings;
            try {
              const data = await fetchWithRetry(
                () => fetchJSON(url, headers, "GET", null, budget, log),
                maxRetries,
                retryBaseMs,
                budget,
              );
              moreRankings = data?.rankings || [];
            } catch (err) {
              if (err instanceof subrequestBudgetExhausted) break;
              break;
            }
            if (!moreRankings.length) break;

            // Deduplicate against already-seen players
            let moreCandidates = [];
            for (const p of moreRankings) {
              const key = `${p.characterId}_${p.serverId}`;
              if (!seen.has(key)) {
                seen.add(key);
                moreCandidates.push(p);
              }
            }
            if (region && region !== "all")
              moreCandidates = moreCandidates.filter(
                (p) => p.region === region,
              );
            if (serverId && serverId !== "all")
              moreCandidates = moreCandidates.filter(
                (p) => String(p.serverId) === String(serverId),
              );

            const moreUncached = [];
            for (const p of moreCandidates) {
              const cached = await getCachedPlayer(
                db,
                p.characterId,
                p.serverId,
              );
              if (cached) {
                const hasEquip2 = !!cached.equipData;
                const equipCount2 =
                  cached.equipData?.equipment?.equipmentList?.length || 0;
                const detailCount2 = Array.isArray(cached.equipDetails)
                  ? cached.equipDetails.length
                  : 0;
                const isComplete2 = hasEquip2 && detailCount2 > 0;

                if (isComplete2) {
                  if (enriched.length >= limit) break;
                  const result = {
                    ...p,
                    _equip: cached.equipData,
                    _equipDetails: cached.equipDetails,
                    _itemLevel: cached.itemLevel ?? null,
                    _combatPower:
                      cached.equipData?.profile?.combatPower ?? null,
                  };
                  enriched.push(result);
                  for (const item of result._equip?.equipment?.equipmentList ||
                    []) {
                    if ((item.slotPosName || "").startsWith("Arcana"))
                      allArcanaIds.push(item.id);
                  }
                  log.success(
                    p.characterName,
                    `Loaded from cache${cached.itemLevel ? ` (GS: ${cached.itemLevel})` : ""} (${enriched.length}/${limit})`,
                  );
                } else {
                  log.warn(
                    p.characterName,
                    `Cached data incomplete, re-fetching...`,
                  );
                  moreUncached.push(p);
                }
              } else {
                moreUncached.push(p);
              }
            }

            if (enriched.length < limit && moreUncached.length > 0) {
              let mc = enriched.length;
              const moreTasks = moreUncached
                .slice(0, limit - enriched.length + 5)
                .map((p) => async () => {
                  if (!isActive || mc >= limit || !budget.canAfford(3))
                    return null;
                  let result;
                  try {
                    result = await fetchWithRetry(
                      async () => {
                        const apiBase =
                          p.region === "TW"
                            ? "https://tw.ncsoft.com/aion2/api"
                            : "https://aion2.plaync.com/api";
                        let equipData;
                        try {
                          equipData = await fetchJSON(
                            `${apiBase}/character/equipment?lang=en&characterId=${p.characterId}&serverId=${p.serverId}`,
                            makeDirectHeaders(),
                            "GET",
                            null,
                            budget,
                            log,
                          );
                        } catch {
                          equipData = await fetchJSON(
                            proxyUrl(
                              `${apiBase}/character/equipment?lang=en&characterId=${p.characterId}&serverId=${p.serverId}`,
                            ),
                            headers,
                            "GET",
                            null,
                            budget,
                            log,
                          );
                        }
                        if (!equipData?.equipment?.equipmentList?.length)
                          throw new Error("Empty equipmentList");
                        return { ...p, _equip: equipData };
                      },
                      maxRetries,
                      retryBaseMs,
                      budget,
                    );
                  } catch (err) {
                    if (err instanceof subrequestBudgetExhausted) return null;
                    return null;
                  }

                  let equipDetails;
                  try {
                    equipDetails = await fetchWithRetry(
                      async () => {
                        const eqList =
                          result._equip?.equipment?.equipmentList || [];
                        if (!eqList.length) return [];
                        const items = eqList.map((e) => ({
                          itemId: e.id,
                          enchantLevel: e.enchantLevel || 0,
                          slotPos: e.slotPos,
                        }));
                        const data = await fetchJSON(
                          `${baseUrl}/api/items/batch-equipment`,
                          headers,
                          "POST",
                          {
                            items,
                            characterId: p.characterId,
                            serverId: p.serverId,
                            region: p.region,
                          },
                          budget,
                          log,
                        );
                        const arr = Array.isArray(data?.items || data)
                          ? data?.items || data
                          : [];
                        if (!arr.length) throw new Error("Empty equip details");
                        return arr;
                      },
                      maxRetries,
                      retryBaseMs,
                      budget,
                    );
                  } catch (err) {
                    if (err instanceof subrequestBudgetExhausted) return null;
                    return null;
                  }

                  result._equipDetails = equipDetails;
                  // Validate weapon from direct API item names
                  const primaryWeapon = classWeapons[cls];
                  if (primaryWeapon && result._equip) {
                    const validLabels = Array.isArray(primaryWeapon)
                      ? [...primaryWeapon]
                      : [primaryWeapon];
                    if (validLabels.includes("Staff")) validLabels.push("法杖");
                    let valid = false;
                    const eqList2 =
                      result._equip.equipment?.equipmentList || [];
                    for (const item of eqList2) {
                      if (!item) continue;
                      if (item.slotPos === 1 || item.slotPos === 2) {
                        const itemName = item.name || "";
                        const cat = item.categoryName || "";
                        if (
                          validLabels.some(
                            (label) =>
                              itemName.includes(label) || cat.startsWith(label),
                          )
                        ) {
                          valid = true;
                          break;
                        }
                      }
                    }
                    if (!valid) {
                      result._equip = null;
                      result._equipDetails = [];
                    }
                  }
                  // Fetch the game's own ItemLevel and CP stat — direct first
                  let itemLevel2 = null;
                  let cp2 = null;
                  try {
                    const gsApiBase2 =
                      p.region === "TW"
                        ? "https://tw.ncsoft.com/aion2/api"
                        : "https://aion2.plaync.com/api";
                    const infoD = await fetchJSON(
                      `${gsApiBase2}/character/info?lang=en&characterId=${p.characterId}&serverId=${p.serverId}`,
                      makeDirectHeaders(),
                      "GET",
                      null,
                      budget,
                      log,
                    );
                    itemLevel2 = extractItemLevelFromInfo(infoD);
                    cp2 = extractCombatPowerFromInfo(infoD);
                  } catch {
                    const stats = await fetchItemLevelAndCP(
                      p,
                      headers,
                      budget,
                      log,
                    );
                    if (stats) {
                      itemLevel2 = stats.itemLevel;
                      cp2 = stats.combatPower;
                    }
                  }
                  result._itemLevel = itemLevel2;
                  result._combatPower = cp2;

                  if (result._equip && cp2 != null) {
                    if (!result._equip.profile) result._equip.profile = {};
                    result._equip.profile.combatPower = cp2;
                  }
                  await setCachedPlayer(
                    db,
                    p.characterId,
                    p.serverId,
                    p.region,
                    result._equip,
                    equipDetails,
                    itemLevel2,
                  );
                  mc++;
                  const gs2 = itemLevel2;
                  const cp2Log = cp2;
                  const statsStr2 = [
                    gs2 ? `GS: ${gs2}` : "",
                    cp2Log ? `CP: ${cp2Log}` : "",
                  ]
                    .filter(Boolean)
                    .join(" | ");
                  log.success(
                    p.characterName,
                    `Scanned${statsStr2 ? ` (${statsStr2})` : ""} (${mc}/${limit})`,
                  );
                  return result;
                });
              const moreResults = await runPool(moreTasks, concurrency, budget);
              for (const r of moreResults) {
                if (!r || enriched.length >= limit) continue;
                enriched.push(r);
                for (const item of r._equip?.equipment?.equipmentList || []) {
                  if ((item.slotPosName || "").startsWith("Arcana"))
                    allArcanaIds.push(item.id);
                }
              }
            }
            extraPage++;
          }
        }

        sendEvent({ type: "progress", current: limit, total: limit });
        log.success(
          "aggregate",
          `Finished scanning ${enriched.length} players. Loading arcana data...`,
        );

        // ═══════════════════════════════════════════════════════════════════
        // PHASE 4: Fetch arcana item details in parallel batches
        // ═══════════════════════════════════════════════════════════════════
        const uniqueItemIds = [...new Set(allArcanaIds)];
        const itemDetailsMap = {};

        if (uniqueItemIds.length > 0) {
          const chunks = [];
          for (let i = 0; i < uniqueItemIds.length; i += 50) {
            chunks.push(uniqueItemIds.slice(i, i + 50));
          }
          const arcanaChunkTasks = chunks.map((chunk) => async () => {
            try {
              const data = await fetchJSON(
                `${baseUrl}/api/items/batch-details`,
                headers,
                "POST",
                { itemIds: chunk },
                budget,
                log,
              );
              return data?.items || data || [];
            } catch (err) {
              log.warn(
                "arcana",
                `Failed to load some arcana details, skipping batch`,
              );
              return [];
            }
          });

          const arcanaResults = await runPool(arcanaChunkTasks, 5, budget);
          for (const items of arcanaResults) {
            if (!Array.isArray(items)) continue;
            for (const item of items) {
              if (item?.id) itemDetailsMap[item.id] = item;
            }
          }
        }

        log.info("aggregate", `Building analysis results...`);

        const builds = enriched.map((p) =>
          extractBuild(
            p,
            itemDetailsMap,
            p._equipDetails || [],
            p._itemLevel ?? null,
            p._combatPower ?? null,
          ),
        );
        const stats = aggregate(builds);

        // Save meta snapshot for the landing page widget
        try {
          await saveMetaSnapshot(db, cls, lbType, stats);
        } catch (snapshotErr) {
          // Non-critical — don't fail the analysis
          console.error(
            "[meta-snapshot] Save failed:",
            snapshotErr?.message || snapshotErr,
          );
        }

        sendEvent({ type: "done", stats, count: enriched.length });
        if (isActive) {
          try {
            controller.close();
          } catch (e) {}
          isActive = false;
        }
      } catch (error) {
        // Budget exhausted — return partial results gracefully
        if (
          error instanceof subrequestBudgetExhausted ||
          (error.message && error.message.includes("subrequest"))
        ) {
          log.warn(
            "system",
            `Request limit reached. Returning ${enriched.length} players scanned so far.`,
          );

          // Still try to aggregate what we have
          if (enriched.length > 0) {
            const itemDetailsMap = {};
            const builds = enriched.map((p) =>
              extractBuild(
                p,
                itemDetailsMap,
                p._equipDetails || [],
                p._itemLevel ?? null,
                p._combatPower ?? null,
              ),
            );
            const stats = aggregate(builds);
            try {
              await saveMetaSnapshot(db, cls, lbType, stats);
            } catch (_) {}
            sendEvent({ type: "done", stats, count: enriched.length });
          } else {
            sendEvent({
              type: "error",
              message:
                "Unable to scan players at this time. Please try again with a smaller limit.",
            });
          }
        } else {
          // Sanitize: never expose internal/infrastructure errors to the user
          const rawMsg = String(error?.message || error || "");
          const safeMessage = sanitizeErrorMessage(rawMsg);
          log.error("POST", rawMsg);
          sendEvent({ type: "error", message: safeMessage });
        }
        if (isActive) {
          try {
            controller.close();
          } catch (e) {}
          isActive = false;
        }
      }
    },
    cancel() {
      isActive = false;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
