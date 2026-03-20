import { getCachedPlayer, setCachedPlayer } from "@/lib/db";
import { getRequestContext } from "@cloudflare/next-on-pages";
import { createWebLogger } from "@/lib/logger";

export const runtime = "edge";

const BASE = "https://shugo.gg";

const LEADERBOARD_TYPES = {
  nightmare: { contentType: 3, label: "Nightmare" },
  abyss: { contentType: 1, label: "Abyss" },
  "arena-solo": { contentType: 5, label: "Arena Solo" },
  "arena-coop": { contentType: 6, label: "Arena Coop" },
  transcendence: { contentType: 4, label: "Transcendence" },
  ascension: { contentType: 21, label: "Ascension" },
  raid: { contentType: 20, label: "Raid" },
};

const CLASS_RANKING_IDS = {
  gladiator: 2,
  templar: 3,
  ranger: 4,
  assassin: 5,
  spiritmaster: 6,
  sorcerer: 7,
  cleric: 8,
  chanter: 9,
};

const CLASS_WEAPONS = {
  gladiator: "Greatsword",
  templar: "Longsword",
  ranger: "Bow",
  assassin: "Dagger",
  spiritmaster: "Orb",
  sorcerer: "Spellbook",
  cleric: "Mace",
  chanter: "Staff",
};

const SERVER_NAMES = {
  // Elyos (1xxx)
  1001: "Siel",
  1002: "Nezekan",
  1003: "Vaizel",
  1004: "Kaisinel",
  1005: "Yustiel",
  1006: "Ariel",
  1007: "Fregion",
  1008: "Meslamtaeda",
  1009: "Hithanya",
  1010: "Nania",
  1011: "Tahavatha",
  1012: "Luteros",
  1013: "Phernos",
  1014: "Daminu",
  1015: "Kasaka",
  1016: "Bakarma",
  1017: "Tsenka",
  1018: "Kochi",
  1019: "Ishtar",
  1020: "Tiamat",
  1021: "Poeta",
  // Asmodian (2xxx)
  2001: "Israphel",
  2002: "Zikel",
  2003: "Triniel",
  2004: "Lumiel",
  2005: "Marchutan",
  2006: "Azphel",
  2007: "Ereshkigal",
  2008: "Beritra",
  2009: "Nemon",
  2010: "Hadala",
  2011: "Ludra",
  2012: "Ulgorn",
  2013: "Munin",
  2014: "Odar",
  2015: "Zemurru",
  2016: "Kromede",
  2017: "Quai",
  2018: "Baba",
  2019: "Fafnir",
  2020: "Indnah",
  2021: "Pandemonium",
};

function makeHeaders(referer) {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: referer,
    Origin: BASE,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJSON(url, headers, method = "GET", body = null) {
  const opts = { headers, method };
  if (body) {
    opts.body = JSON.stringify(body);
    opts.headers = { ...headers, "Content-Type": "application/json" };
  }
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchWithRetry(fn, maxAttempts = 3, baseDelayMs = 500) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        let wait = baseDelayMs * Math.pow(2, attempt - 1);
        if (err.message && err.message.includes("HTTP 429")) {
          wait += 5000;
        }
        await sleep(wait);
      }
    }
  }
  throw lastErr;
}

function proxyUrl(apiPath) {
  return `${BASE}/api/proxy?url=${encodeURIComponent(apiPath)}`;
}

// ── Extraction Logic ───
// itemLevel: the game's own ItemLevel stat from character/info (required — no fallback formula).
function extractBuild(
  player,
  itemDetailsMap,
  equipDetailsList,
  itemLevel = null,
) {
  const equip = player._equip;
  const serverId = player.serverId;
  const serverName =
    SERVER_NAMES[serverId] || (serverId ? `Server ${serverId}` : "Unknown");

  const build = {
    name: player.characterName || "Unknown",
    serverId: serverId || null,
    serverName: serverName,
    race: serverId >= 2000 ? "Asmo" : serverId >= 1000 ? "Elyos" : "Unknown",
    region: player.region || "Unknown",
    faction:
      player.faction ||
      equip?.profile?.factionName ||
      equip?.profile?.raceName ||
      "Unknown",
    globalRank: player.globalRank || player.rank,
    gearScore: null,
    activeSkills: [],
    stigmaSkills: [],
    passiveSkills: [],
    arcanas: [],
    arcanaSets: [],
    equipSubStats: [],
    equipItems: [],
  };

  const skillList = equip?.skill?.skillList || [];
  for (const s of skillList) {
    const isPassive = s.category === "Passive";
    const isStigma = s.category === "Dp";
    if (!isPassive && !isStigma && !s.equip) continue;
    const info = {
      name: s.name,
      level: s.skillLevel || 0,
      equipped: !!s.equip,
    };
    if (s.category === "Active") build.activeSkills.push(info);
    if (s.category === "Dp") build.stigmaSkills.push(info);
    if (isPassive) build.passiveSkills.push(info);
  }

  const equipList = equip?.equipment?.equipmentList || [];

  // Build maps from slotPos to item name/grade from the equipment list
  const slotPosToName = {};
  const slotPosToGrade = {};
  for (const item of equipList) {
    if (item.slotPos != null) {
      slotPosToName[item.slotPos] = item.name;
      slotPosToGrade[item.slotPos] = item.grade ?? null;
    }
  }

  for (const eqItem of equipDetailsList) {
    if (!eqItem) continue;
    const cat = eqItem.categoryName;
    if (!cat) continue;
    const subs = (eqItem.subStats || []).map((s) => ({
      name: s.name,
      value: s.value,
    }));
    const skills = (eqItem.subSkills || []).map((s) => ({
      name: s.name,
      value: "+" + s.level,
    }));
    const combined = [...subs, ...skills];
    if (combined.length > 0) {
      build.equipSubStats.push({ categoryName: cat, subStats: combined });
    }
    // Track item name per slot
    const itemName = slotPosToName[eqItem.slotPos];
    if (itemName) {
      const grade = slotPosToGrade[eqItem.slotPos] ?? null;
      build.equipItems.push({ categoryName: cat, itemName, grade });
    }
  }

  // Gear score: use the game's own ItemLevel stat (matches Shugo.gg iLvl exactly).
  build.gearScore = itemLevel ?? null;

  const setCounts = {};
  const seenSets = new Set();
  for (const item of equipList) {
    if (!(item.slotPosName || "").startsWith("Arcana")) continue;
    const detail = itemDetailsMap[item.id];
    const arcana = {
      name: item.name,
      slot: item.slotPosName,
      grade: item.grade,
      enchantLevel: item.enchantLevel || 0,
      mainStat: null,
      setName: null,
    };
    if (detail) {
      if (detail.mainStats?.[0]) {
        arcana.mainStat =
          detail.mainStats[0].name + ": " + detail.mainStats[0].value;
      }
      if (detail.set) {
        arcana.setName = detail.set.name;
        setCounts[detail.set.name] = (setCounts[detail.set.name] || 0) + 1;
        if (!seenSets.has(detail.set.name)) {
          seenSets.add(detail.set.name);
          build.arcanaSets.push({
            name: detail.set.name,
            bonuses: (detail.set.bonuses || []).map(
              (b) => `(${b.degree}-piece) ${b.descriptions.join(", ")}`,
            ),
          });
        }
      }
    }
    build.arcanas.push(arcana);
  }

  build.arcanaSetCombo =
    Object.entries(setCounts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, count]) => `${name}(${count})`)
      .join(" + ") || "None";

  return build;
}

function aggregate(builds) {
  const total = builds.length;
  const stats = {
    total,
    activeSkills: {},
    stigmaSkills: {},
    passiveSkills: {},
    arcanaUsage: {},
    arcanaSets: {},
    arcanaSetCombos: {},
    arcanaMainStats: {},
    equippedStigmaCombos: {},
    subStatsBySlot: {},
    itemsBySlot: {},
    scannedPlayers: [],
  };

  for (const b of builds) {
    for (const s of b.activeSkills) {
      const e = (stats.activeSkills[s.name] ||= {
        totalLv: 0,
        count: 0,
        maxLv: 0,
        equippedCount: 0,
      });
      e.totalLv += s.level;
      e.count++;
      e.maxLv = Math.max(e.maxLv, s.level);
      if (s.equipped) e.equippedCount++;
    }
    for (const s of b.stigmaSkills) {
      const e = (stats.stigmaSkills[s.name] ||= {
        totalLv: 0,
        count: 0,
        maxLv: 0,
        equippedCount: 0,
      });
      e.totalLv += s.level;
      e.count++;
      e.maxLv = Math.max(e.maxLv, s.level);
      if (s.equipped) e.equippedCount++;
    }
    const topStigmas = [...b.stigmaSkills]
      .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name))
      .slice(0, 4)
      .map((s) => s.name)
      .sort();
    if (topStigmas.length > 0) {
      const combo = topStigmas.join(" + ");
      stats.equippedStigmaCombos[combo] =
        (stats.equippedStigmaCombos[combo] || 0) + 1;
    }
    for (const s of b.passiveSkills) {
      const e = (stats.passiveSkills[s.name] ||= {
        totalLv: 0,
        count: 0,
        maxLv: 0,
      });
      e.totalLv += s.level;
      e.count++;
      e.maxLv = Math.max(e.maxLv, s.level);
    }
    for (const a of b.arcanas) {
      stats.arcanaUsage[a.name] = (stats.arcanaUsage[a.name] || 0) + 1;
      if (a.mainStat)
        stats.arcanaMainStats[a.mainStat] =
          (stats.arcanaMainStats[a.mainStat] || 0) + 1;
    }
    for (const s of b.arcanaSets) {
      if (!stats.arcanaSets[s.name])
        stats.arcanaSets[s.name] = { count: 0, bonuses: s.bonuses };
      stats.arcanaSets[s.name].count++;
    }
    if (b.arcanaSetCombo) {
      stats.arcanaSetCombos[b.arcanaSetCombo] =
        (stats.arcanaSetCombos[b.arcanaSetCombo] || 0) + 1;
    }
    for (const eq of b.equipSubStats) {
      const slotStats = (stats.subStatsBySlot[eq.categoryName] ||= {});
      for (const s of eq.subStats) {
        const entry = (slotStats[s.name] ||= { count: 0, values: [] });
        entry.count++;
        entry.values.push(s.value);
      }
    }
    for (const eq of b.equipItems) {
      const slotItems = (stats.itemsBySlot[eq.categoryName] ||= {});
      const existing = slotItems[eq.itemName];
      if (existing) {
        existing.count++;
      } else {
        slotItems[eq.itemName] = { count: 1, grade: eq.grade };
      }
    }
    stats.scannedPlayers.push({
      name: b.name,
      serverId: b.serverId,
      serverName: b.serverName,
      race: b.race,
      region: b.region,
      faction: b.faction,
      globalRank: b.globalRank,
      gearScore: b.gearScore,
    });
  }

  for (const map of [
    stats.activeSkills,
    stats.stigmaSkills,
    stats.passiveSkills,
  ]) {
    for (const d of Object.values(map)) {
      d.avgLv = +(d.totalLv / d.count).toFixed(1);
    }
  }
  return stats;
}

// ── Concurrency-limited task runner ──────────────────────────────────────────
// Runs up to `concurrency` async tasks in parallel from `tasks` iterator/array.
// Returns results in order.
async function runPool(tasks, concurrency) {
  const results = new Array(tasks.length);
  let idx = 0;

  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

// Extracts the game's own ItemLevel stat from character/info API response.
// Shugo.gg displays this value directly as iLvl — so we do the same.
// Checks both statList and statSecondList and alternate names for robustness.
function extractItemLevelFromInfo(infoData) {
  const lists = [
    infoData?.stat?.statList,
    infoData?.stat?.statSecondList,
    infoData?.stat?.statListThird, // Sometimes exists in alternate API versions
    infoData?.profile?.stat?.statList,
    infoData?.statList,
  ];

  // Possible names for the Gear Score / Item Level stat
  const statNames = ["itemlevel", "gearscore", "ilvl"];

  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const name of statNames) {
      const stat = list.find((s) => s?.type?.toLowerCase() === name);
      if (stat != null) {
        const num = Number(stat.value);
        if (!isNaN(num) && num > 0) {
          // If the value is suspicious (e.g. 1661 while others are 4k),
          // we still return it as it's the game's reported value.
          return num;
        }
      }
    }
  }
  return null;
}

// Fetches the ItemLevel from the game's character/info endpoint.
// Returns null on failure (caller should fall back to manual calc).
async function fetchItemLevel(p, headers) {
  try {
    const apiBase =
      p.region === "TW"
        ? "https://tw.ncsoft.com/aion2/api"
        : "https://aion2.plaync.com/api";
    const infoData = await fetchJSON(
      proxyUrl(
        `${apiBase}/character/info?lang=en&characterId=${p.characterId}&serverId=${p.serverId}`,
      ),
      headers,
    );
    return extractItemLevelFromInfo(infoData);
  } catch {
    return null;
  }
}

export async function POST(req) {
  const { lbType, cls, limit, region, serverId } = await req.json();
  const lbInfo = LEADERBOARD_TYPES[lbType];
  const rankingType = CLASS_RANKING_IDS[cls] || 0;
  const headers = makeHeaders(`${BASE}/leaderboard/${lbType}?class=${cls}`);
  const { env } = getRequestContext();
  const db = env.DB;

  // Tuning: max concurrent API requests for player data
  const CONCURRENCY = 15;
  const MAX_RETRIES = 3;
  const RETRY_BASE_MS = 400;

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

      try {
        const log = createWebLogger(sendEvent);

        // ═══════════════════════════════════════════════════════════════════
        // PHASE 1: Fetch all leaderboard pages in parallel
        // ═══════════════════════════════════════════════════════════════════
        log.info("leaderboard", `Fetching ${lbInfo.label} leaderboard...`);

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
            const url = `${BASE}/api/leaderboard?contentType=${lbInfo.contentType}&rankingType=${rankingType}&page=${pg}&limit=100`;
            try {
              const data = await fetchWithRetry(
                () => fetchJSON(url, headers),
                MAX_RETRIES,
                RETRY_BASE_MS,
              );
              return data?.rankings || [];
            } catch {
              return [];
            }
          };
        });

        const lbResults = await runPool(lbPageTasks, 5);
        const rawPlayers = lbResults.flat();

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

        log.info("leaderboard", `Found ${allPlayers.length} unique candidates (${rawPlayers.length} raw).`);

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
        const allArcanaIds = [];

        for (const p of candidates) {
          if (cachedResults.length + uncachedPlayers.length >= limit * 2) break;
          const cached = await getCachedPlayer(db, p.characterId, p.serverId);
          if (cached) {
            const result = {
              ...p,
              _equip: cached.equipData,
              _equipDetails: cached.equipDetails,
              _itemLevel: cached.itemLevel ?? null,
            };
            cachedResults.push(result);
            for (const item of result._equip?.equipment?.equipmentList || []) {
              if ((item.slotPosName || "").startsWith("Arcana"))
                allArcanaIds.push(item.id);
            }
          } else {
            uncachedPlayers.push(p);
          }
        }

        // Report cached hits
        const enriched = [];
        for (const r of cachedResults) {
          if (enriched.length >= limit) break;
          enriched.push(r);
          const cachedGs = r._itemLevel;
          log.success(r.characterName, `[CACHED]${cachedGs ? ` (GS: ${cachedGs})` : ""} (${enriched.length}/${limit})`);
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
        log.info("cache", `${cachedResults.length} cached, ${Math.min(uncachedPlayers.length, stillNeeded)} need fetching.`);

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
            if (!isActive || reservedCount >= limit) return null;

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
              // 1. Fetch equipment
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
                      fetchJSON(proxyUrl(`${apiBase}${targetPath}`), headers),
                    MAX_RETRIES,
                    RETRY_BASE_MS,
                  );
                } catch (proxyErr) {
                  // Fallback: Try direct fetch without proxy
                  log.warn(p.characterName, `Proxy failed, trying direct fallback: ${proxyErr.message}`);
                  equipData = await fetchWithRetry(
                    () => fetchJSON(`${apiBase}${targetPath}`, headers),
                    MAX_RETRIES,
                    RETRY_BASE_MS,
                  );
                }

                if (equipData?.equipment?.equipmentList?.length) {
                  result._equip = equipData;
                } else {
                  throw new Error("Empty equipmentList");
                }
              } catch (err) {
                warnings.push(`Gear Failed: ${err.message}`);
                result._equip = null;
              }

              // 2. Fetch equipment details (substats) if we have gear
              if (result._equip) {
                try {
                  const eqList = result._equip.equipment.equipmentList;
                  const items = eqList.map((e) => ({
                    itemId: e.id,
                    enchantLevel: e.enchantLevel || 0,
                    slotPos: e.slotPos,
                  }));
                  const data = await fetchWithRetry(
                    () =>
                      fetchJSON(
                        `${BASE}/api/items/batch-equipment`,
                        headers,
                        "POST",
                        {
                          items,
                          characterId: p.characterId,
                          serverId: p.serverId,
                          region: p.region || "KR",
                        },
                      ),
                    MAX_RETRIES,
                    RETRY_BASE_MS,
                  );
                  equipDetails = Array.isArray(data?.items || data)
                    ? data?.items || data
                    : [];
                } catch (err) {
                  warnings.push(`Substats Failed: ${err.message}`);
                }
              }

              result._equipDetails = equipDetails;

              // ... 3. Class validation ...
              const clsLower = (cls || "").toLowerCase();
              const primaryWeapon = CLASS_WEAPONS[clsLower];

              if (primaryWeapon && result._equip && equipDetails.length > 0) {
                const validLabels = [primaryWeapon];
                if (primaryWeapon === "Staff") validLabels.push("法杖"); // TW localized

                let hasValidWeapon = false;
                for (const eqItem of equipDetails) {
                  if (eqItem.slotPos === 1 || eqItem.slotPos === 2) {
                    const cat = eqItem.categoryName || "";
                    if (validLabels.some((label) => cat.startsWith(label))) {
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
              warnings.push(`Error: ${err.message}`);
            }

            // 4. Always fetch ItemLevel (authoritative for GS)
            const itemLevel = await fetchItemLevel(p, headers);
            result._itemLevel = itemLevel;

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
            if (warnings.length > 0) {
              log.warn(p.characterName, `Scanned${itemLevel ? ` (GS: ${itemLevel})` : ""} (${playerNum}/${limit})${warningStr}`);
            } else {
              log.success(p.characterName, `Scanned${itemLevel ? ` (GS: ${itemLevel})` : ""} (${playerNum}/${limit})`);
            }

            return result;
          });

          // Run all player tasks with concurrency pool
          const results = await runPool(playerTasks, CONCURRENCY);

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
        if (enriched.length < limit) {
          let extraPage = pagesNeeded + 1;
          while (enriched.length < limit && extraPage <= 50) {
            if (!isActive) break;
            log.info("leaderboard", `Need more candidates, fetching page ${extraPage}...`);
            const url = `${BASE}/api/leaderboard?contentType=${lbInfo.contentType}&rankingType=${rankingType}&page=${extraPage}&limit=100`;
            let moreRankings;
            try {
              const data = await fetchWithRetry(
                () => fetchJSON(url, headers),
                MAX_RETRIES,
                RETRY_BASE_MS,
              );
              moreRankings = data?.rankings || [];
            } catch {
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
                if (enriched.length >= limit) break;
                const result = {
                  ...p,
                  _equip: cached.equipData,
                  _equipDetails: cached.equipDetails,
                  _itemLevel: cached.itemLevel ?? null,
                };
                enriched.push(result);
                for (const item of result._equip?.equipment?.equipmentList ||
                  []) {
                  if ((item.slotPosName || "").startsWith("Arcana"))
                    allArcanaIds.push(item.id);
                }
                const cachedGs2 = result._itemLevel;
                log.success(p.characterName, `[CACHED]${cachedGs2 ? ` (GS: ${cachedGs2})` : ""} (${enriched.length}/${limit})`);
              } else {
                moreUncached.push(p);
              }
            }

            if (enriched.length < limit && moreUncached.length > 0) {
              let mc = enriched.length;
              const moreTasks = moreUncached
                .slice(0, limit - enriched.length + 5)
                .map((p) => async () => {
                  if (!isActive || mc >= limit) return null;
                  let result;
                  try {
                    result = await fetchWithRetry(
                      async () => {
                        const apiBase =
                          p.region === "TW"
                            ? "https://tw.ncsoft.com/aion2/api"
                            : "https://aion2.plaync.com/api";
                        const equipData = await fetchJSON(
                          proxyUrl(
                            `${apiBase}/character/equipment?lang=en&characterId=${p.characterId}&serverId=${p.serverId}`,
                          ),
                          headers,
                        );
                        if (!equipData?.equipment?.equipmentList?.length)
                          throw new Error("Empty equipmentList");
                        return { ...p, _equip: equipData };
                      },
                      MAX_RETRIES,
                      RETRY_BASE_MS,
                    );
                  } catch {
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
                          `${BASE}/api/items/batch-equipment`,
                          headers,
                          "POST",
                          {
                            items,
                            characterId: p.characterId,
                            serverId: p.serverId,
                            region: p.region,
                          },
                        );
                        const arr = Array.isArray(data?.items || data)
                          ? data?.items || data
                          : [];
                        if (!arr.length) throw new Error("Empty equip details");
                        return arr;
                      },
                      MAX_RETRIES,
                      RETRY_BASE_MS,
                    );
                  } catch {
                    return null;
                  }

                  result._equipDetails = equipDetails;
                  const primaryWeapon = CLASS_WEAPONS[cls];
                  if (primaryWeapon) {
                    let valid = false;
                    for (const eqItem of equipDetails) {
                      if (!eqItem) continue;
                      if (eqItem.slotPos === 1 || eqItem.slotPos === 2) {
                        if (
                          (eqItem.categoryName || "").startsWith(primaryWeapon)
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
                  // Fetch the game's own ItemLevel stat (matches Shugo.gg iLvl)
                  const itemLevel2 = await fetchItemLevel(p, headers);
                  result._itemLevel = itemLevel2;
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
                  log.success(p.characterName, `Scanned${gs2 ? ` (GS: ${gs2})` : ""} (${mc}/${limit})`);
                  return result;
                });
              const moreResults = await runPool(moreTasks, CONCURRENCY);
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
        log.success("aggregate", `Finished scanning ${enriched.length} valid players. Fetching Arcana dictionary...`);

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
                `${BASE}/api/items/batch-details`,
                headers,
                "POST",
                { itemIds: chunk },
              );
              return data?.items || data || [];
            } catch {
              return [];
            }
          });

          const arcanaResults = await runPool(arcanaChunkTasks, 5);
          for (const items of arcanaResults) {
            for (const item of items) {
              if (item?.id) itemDetailsMap[item.id] = item;
            }
          }
        }

        log.info("aggregate", `Aggregating final results...`);

        const builds = enriched.map((p) =>
          extractBuild(
            p,
            itemDetailsMap,
            p._equipDetails || [],
            p._itemLevel ?? null,
          ),
        );
        const stats = aggregate(builds);

        sendEvent({ type: "done", stats, count: enriched.length });
        if (isActive) {
          try {
            controller.close();
          } catch (e) {}
          isActive = false;
        }
      } catch (error) {
        log.error("POST", error.message);
        sendEvent({ type: "error", message: error.message });
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
