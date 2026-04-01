// ─────────────────────────────────────────────────────────────────────────────
// Shared constants, utilities, and business logic for the Aion 2 scraper.
// Used by both the CLI (scraper.mjs) and the web API (app/api/scrape/route.js).
// ─────────────────────────────────────────────────────────────────────────────

// ── Constants ────────────────────────────────────────────────────────────────
export const baseUrl = "https://shugo.gg";

export const leaderboardTypes = {
  nightmare: { contentType: 3, label: "Nightmare" },
  abyss: { contentType: 1, label: "Abyss" },
  "arena-solo": { contentType: 5, label: "Arena Solo" },
  "arena-coop": { contentType: 6, label: "Arena Coop" },
  transcendence: { contentType: 4, label: "Transcendence" },
  ascension: { contentType: 21, label: "Ascension" },
  raid: { contentType: 20, label: "Raid" },
};

export const classRankingIds = {
  gladiator: 2,
  templar: 3,
  ranger: 4,
  assassin: 5,
  spiritmaster: 6,
  sorcerer: 7,
  cleric: 8,
  chanter: 9,
};

export const classes = Object.keys(classRankingIds);

export const serverNames = {
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

// ── Utility Functions ────────────────────────────────────────────────────────
export function makeHeaders(referer) {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: referer,
    Origin: baseUrl,
  };
}

// Headers for direct calls to aion2.plaync.com / tw.ncsoft.com.
// Omits Origin and Referer so the upstream doesn't reject with "Invalid CORS request" (403).
export function makeDirectHeaders() {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function proxyUrl(apiPath) {
  return `${baseUrl}/api/proxy?url=${encodeURIComponent(apiPath)}`;
}

// ── Subrequest Budget (Cloudflare Workers) ───────────────────────────────────
// Cloudflare Workers limit: 1000 subrequests per invocation (paid plan).
// We reserve a safety margin for arcana batches & cleanup fetches.
export const subrequestHardLimit = 1000;
export const subrequestSafetyMargin = 30;

export class subrequestBudgetExhausted extends Error {
  constructor(used) {
    super(`Subrequest budget exhausted (${used}/${subrequestHardLimit})`);
    this.name = "SubrequestBudgetExhausted";
  }
}

export function createBudget() {
  let used = 0;
  let forceExhausted = false;
  return {
    get used() {
      return used;
    },
    get remaining() {
      return forceExhausted
        ? 0
        : subrequestHardLimit - subrequestSafetyMargin - used;
    },
    consume(n = 1) {
      if (forceExhausted) throw new subrequestBudgetExhausted(used);
      used += n;
      if (used >= subrequestHardLimit - subrequestSafetyMargin) {
        throw new subrequestBudgetExhausted(used);
      }
    },
    canAfford(n = 1) {
      return (
        !forceExhausted &&
        used + n < subrequestHardLimit - subrequestSafetyMargin
      );
    },
    exhaust() {
      forceExhausted = true;
    },
  };
}

// ── Fetch Helpers ────────────────────────────────────────────────────────────

// Map raw API URLs to user-friendly descriptions for logs.
function friendlyFetchLabel(url) {
  // Unwrap proxy URLs to inspect the inner path
  if (url.includes("/api/proxy?url=")) {
    const inner = decodeURIComponent(url.split("url=")[1] || "");
    if (inner) return friendlyFetchLabel(inner);
  }
  if (url.includes("/api/leaderboard")) {
    const page = url.match(/page=(\d+)/)?.[1];
    return `Scanning rankings${page ? ` (page ${page})` : ""}`;
  }
  if (url.includes("/character/equipment")) return "Reading gear";
  if (url.includes("/character/info")) return "Reading player stats";
  if (url.includes("/items/batch-equipment")) return "Resolving substats";
  if (url.includes("/items/batch-details")) return "Resolving arcana";
  return "Loading";
}

export async function fetchJSON(
  url,
  headers,
  method = "GET",
  body = null,
  budget = null,
  logger = null,
  timeoutMs = 20000,
) {
  if (budget) budget.consume();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const opts = { headers, method, signal: controller.signal };
  if (body) {
    opts.body = JSON.stringify(body);
    opts.headers = { ...headers, "Content-Type": "application/json" };
  }
  const label = friendlyFetchLabel(url);
  let res;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    // Detect Cloudflare Workers subrequest limit — stop immediately
    if (err.message && /too many subrequests/i.test(err.message)) {
      if (budget) budget.exhaust();
      throw new subrequestBudgetExhausted(budget ? budget.used : 0);
    }
    throw err;
  }
  clearTimeout(timer);
  if (!res.ok) {
    if (logger) logger.error("fetch", `${label} — failed (HTTP ${res.status})`);
    throw new Error(`HTTP ${res.status}`);
  }
  if (logger) logger.success("fetch", `${label} ✓`);
  return res.json();
}

export async function fetchWithRetry(
  fn,
  maxAttempts = 3,
  baseDelayMs = 500,
  budget = null,
) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Don't retry if budget is exhausted
    if (budget && !budget.canAfford())
      throw new subrequestBudgetExhausted(budget.used);
    try {
      return await fn();
    } catch (err) {
      // Never retry budget exhaustion
      if (err instanceof subrequestBudgetExhausted) throw err;
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

// ── Concurrency Pool ─────────────────────────────────────────────────────────
// Runs up to `concurrency` async tasks in parallel from `tasks` array.
// Returns results in order. Stops early if budget is exhausted.
export async function runPool(tasks, concurrency, budget = null) {
  const results = new Array(tasks.length);
  let idx = 0;
  let budgetExhausted = false;

  async function worker() {
    while (idx < tasks.length && !budgetExhausted) {
      if (budget && !budget.canAfford(3)) {
        budgetExhausted = true;
        break;
      }
      const i = idx++;
      try {
        results[i] = await tasks[i]();
      } catch (err) {
        if (err instanceof subrequestBudgetExhausted) {
          budgetExhausted = true;
          break;
        }
        results[i] = null;
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

// ── Item Level Helpers ───────────────────────────────────────────────────────
// Shugo.gg reads ItemLevel directly from character/info stat.statList.
// Checks both statList and statSecondList and alternate names for robustness.
export function extractItemLevelFromInfo(infoData) {
  const lists = [
    infoData?.stat?.statList,
    infoData?.stat?.statSecondList,
    infoData?.stat?.statListThird,
    infoData?.profile?.stat?.statList,
    infoData?.statList,
  ];

  const statNames = ["itemlevel", "gearscore", "ilvl"];

  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const name of statNames) {
      const stat = list.find((s) => s?.type?.toLowerCase() === name);
      if (stat != null) {
        const num = Number(stat.value);
        if (!isNaN(num) && num > 0) return num;
      }
    }
  }
  return null;
}

// Extract Combat Power from character/info endpoint.
export function extractCombatPowerFromInfo(infoData) {
  return infoData?.profile?.combatPower ?? null;
}

// Fetches the ItemLevel and CP from the game's character/info endpoint.
// Returns { itemLevel, combatPower } or null on failure.
export async function fetchItemLevelAndCP(
  player,
  headers,
  budget = null,
  logger = null,
) {
  try {
    if (budget && !budget.canAfford()) return null;
    const apiBase =
      player.region === "TW"
        ? "https://tw.ncsoft.com/aion2/api"
        : "https://aion2.plaync.com/api";
    const infoData = await fetchJSON(
      proxyUrl(
        `${apiBase}/character/info?lang=en&characterId=${player.characterId}&serverId=${player.serverId}`,
      ),
      headers,
      "GET",
      null,
      budget,
      logger,
    );
    return {
      itemLevel: extractItemLevelFromInfo(infoData),
      combatPower: extractCombatPowerFromInfo(infoData),
    };
  } catch {
    return null;
  }
}

// ── Build Extraction ─────────────────────────────────────────────────────────
// itemLevel: the game's own ItemLevel stat from character/info (no fallback formula).
export function extractBuild(
  player,
  itemDetailsMap,
  equipDetailsList,
  itemLevel = null,
  cp = null,
) {
  const equip = player._equip;
  const serverId = player.serverId;
  const serverName =
    serverNames[serverId] || (serverId ? `Server ${serverId}` : "Unknown");

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
    combatPower: null,
    activeSkills: [],
    stigmaSkills: [],
    passiveSkills: [],
    arcanas: [],
    arcanaSets: [],
    equipSubStats: [],
    equipItems: [],
  };

  // Skills — Active skills are included if equipped OR leveled (API may not flag `equip` on all active skills).
  // Stigma (Dp) skills are all included (the API may not flag `equip` consistently for them).
  // Passive skills are always active (no equip slot), so include all of them.
  const skillList = equip?.skill?.skillList || [];
  for (const s of skillList) {
    const isPassive = s.category === "Passive";
    const isStigma = s.category === "Dp";
    if (!isPassive && !isStigma && !s.equip && !s.skillLevel) continue;
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

  // Build map of equipment using our own categorization fallback
  const mapSlotToCategory = (slotName, itemName = "") => {
    if (!slotName) return "Unknown";
    if (slotName.startsWith("MainHand")) return "Main Hand";
    if (slotName.startsWith("SubHand")) return "Guard";
    const map = {
      Torso: "Top",
      Pants: "Legs",
      Helmet: "Helm",
      Shoulder: "Pauldrons",
      Gloves: "Gloves",
      Boots: "Shoes",
      Cape: "Cloak",
      Belt: "Belt",
      Necklace: "Necklace",
      Amulet: "Amulet",
    };
    if (map[slotName]) return map[slotName];
    if (slotName.startsWith("Earring")) return "Earrings";
    if (slotName.startsWith("Ring")) return "Ring";
    if (slotName.startsWith("Bracelet")) return "Bracelet";
    if (slotName.startsWith("Rune")) return "Rune";
    if (slotName.startsWith("Arcana")) {
      const arcanaNames = {
        1: "Grail",
        2: "Parchment",
        3: "Compass",
        4: "Bell",
        5: "Mirror",
        6: "Scales",
      };
      const num = slotName.replace(/\D/g, "");
      return arcanaNames[num] || "Arcana";
    }
    return slotName;
  };

  const slotPosToName = {};
  const slotPosToGrade = {};
  const slotPosToCategory = {};

  for (const item of equipList) {
    if (!item) continue;
    if (item.slotPos != null) {
      slotPosToName[item.slotPos] = item.name;
      slotPosToGrade[item.slotPos] = item.grade ?? null;
      const cat = mapSlotToCategory(item.slotPosName, item.name);
      slotPosToCategory[item.slotPos] = cat;

      build.equipItems.push({
        categoryName: cat,
        itemName: item.name,
        grade: item.grade,
      });
    }
  }

  // Equipment substats (from batch-equipment)
  for (const eqItem of equipDetailsList) {
    if (!eqItem) continue;
    // Always use our mapped category for weapon slots so new weapon types from the API
    // are normalised to "Main Hand" / "Guard" regardless of what categoryName says.
    const mapped = slotPosToCategory[eqItem.slotPos];
    const cat =
      mapped === "Main Hand" || mapped === "Guard"
        ? mapped
        : eqItem.categoryName || mapped || "Unknown";
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
  }

  // Gear score: use the game's own ItemLevel stat (matches Shugo.gg iLvl exactly).
  build.gearScore = itemLevel ?? null;
  build.combatPower = cp ?? null;

  const setCounts = {};
  const seenSets = new Set();
  for (const item of equipList) {
    if (!item || !(item.slotPosName || "").startsWith("Arcana")) continue;
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

  // Build combo string, e.g. "Primal Vigor(4) + Pure Blood(2)"
  build.arcanaSetCombo =
    Object.entries(setCounts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, count]) => `${name}(${count})`)
      .join(" + ") || "None";

  return build;
}

// ── Aggregate Stats ──────────────────────────────────────────────────────────
export function aggregate(builds) {
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
      .slice(0, 5)
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
    for (const eq of b.equipItems || []) {
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
      combatPower: b.combatPower,
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
