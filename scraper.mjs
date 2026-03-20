#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Shugo.gg Leaderboard Scraper & Build Analyzer
// Fetches top players and analyzes Active, Stigma, Passive skills + Arcanas
// Usage: node scraper.mjs [--class chanter] [--type nightmare] [--limit 100]
// ─────────────────────────────────────────────────────────────────────────────

import { writeFileSync } from "fs";
import { argv } from "process";
import { createInterface } from "readline";
import { createCliLogger } from "./src/lib/logger.js";

const log = createCliLogger();

// ── CLI Args ─────────────────────────────────────────────────────────────────
const args = argv.slice(2);
function getArg(name) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}

// ── Interactive prompt ───────────────────────────────────────────────────────
function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim());
    }),
  );
}

// ── Leaderboard types ────────────────────────────────────────────────────────
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

// ── Primary weapon per class (verified from shugo.gg API) ───────────────────────
// categoryName from batch-equipment. "(Extend)" suffix = stat stick in secondary slot.
// We use startsWith so both "Staff" and "Staff(Extend)" pass for a Chanter.
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

const CLASSES = Object.keys(CLASS_RANKING_IDS);

// ── Resolve config ───────────────────────────────────────────────────────────
async function resolveConfig() {
  let lbType = getArg("type");
  let cls = getArg("class");
  let limit = getArg("limit");

  if (!lbType) {
    console.log("\n  Available leaderboard types:");
    Object.entries(LEADERBOARD_TYPES).forEach(([key, v], i) =>
      console.log(`    ${i + 1}. ${v.label} (${key})`),
    );
    const ans = await ask("\n  Choose leaderboard type (name or number): ");
    const keys = Object.keys(LEADERBOARD_TYPES);
    const num = parseInt(ans, 10);
    if (num >= 1 && num <= keys.length) {
      lbType = keys[num - 1];
    } else if (LEADERBOARD_TYPES[ans.toLowerCase()]) {
      lbType = ans.toLowerCase();
    } else {
      log.error("resolveConfig", "Invalid leaderboard type.");
      process.exit(1);
    }
  }

  if (!cls) {
    console.log("\n  Available classes:");
    CLASSES.forEach((c, i) =>
      console.log(`    ${i + 1}. ${c.charAt(0).toUpperCase() + c.slice(1)}`),
    );
    const ans = await ask("\n  Choose class (name or number): ");
    const num = parseInt(ans, 10);
    if (num >= 1 && num <= CLASSES.length) {
      cls = CLASSES[num - 1];
    } else if (CLASSES.includes(ans.toLowerCase())) {
      cls = ans.toLowerCase();
    } else {
      log.error("resolveConfig", "Invalid class.");
      process.exit(1);
    }
  }

  if (!limit) {
    const ans = await ask(
      "\n  How many top players to analyze? (default: 100): ",
    );
    limit = parseInt(ans, 10) || 100;
  } else {
    limit = parseInt(limit, 10);
  }

  return {
    lbType: lbType.toLowerCase(),
    lbInfo: LEADERBOARD_TYPES[lbType.toLowerCase()],
    cls: cls.toLowerCase(),
    limit,
  };
}

// ── Constants ────────────────────────────────────────────────────────────────
const BASE = "https://shugo.gg";
const DELAY_MS = 250;

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

// ── Helpers ──────────────────────────────────────────────────────────────────
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

// Retry wrapper: attempts up to `maxAttempts` times with exponential back-off.
async function fetchWithRetry(fn, maxAttempts = 3, baseDelayMs = 500) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        let wait = baseDelayMs * Math.pow(2, attempt - 1);

        // If we hit a rate limit, add an extra 5s penalty
        if (err.message && err.message.includes("HTTP 429")) {
          log.warn("fetchWithRetry", `Rate limited (HTTP 429). Waiting ${((wait + 5000) / 1000).toFixed(1)}s before retry ${attempt}/${maxAttempts}...`);
          wait += 5000;
        }

        await sleep(wait);
      }
    }
  }
  throw lastErr;
}

function percent(count, total) {
  return total === 0 ? "0.0" : ((count / total) * 100).toFixed(1);
}

function bar(count, total, width = 20) {
  const ratio = total > 0 ? Math.min(count / total, 1) : 0;
  const filled = Math.round(ratio * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function printHeader(title) {
  console.log(`\n${"═".repeat(64)}`);
  console.log(`  ${title}`);
  console.log("═".repeat(64));
}

function proxyUrl(apiPath) {
  return `${BASE}/api/proxy?url=${encodeURIComponent(apiPath)}`;
}

// ── Fetch Leaderboard ────────────────────────────────────────────────────────
async function fetchLeaderboard(config, headers) {
  printHeader("📋 FETCHING LEADERBOARD");

  const { lbInfo, limit, cls } = config;
  const rankingType = CLASS_RANKING_IDS[cls] || 0;
  const players = [];
  let page = 1;

  while (players.length < limit && page <= 10) {
    const url = `${BASE}/api/leaderboard?contentType=${lbInfo.contentType}&rankingType=${rankingType}&page=${page}&limit=100`;
    log.info("fetchLeaderboard", `Fetching page ${page}...`);
    try {
      const data = await fetchJSON(url, headers);
      const rankings = data?.rankings || [];
      if (rankings.length === 0) break;
      players.push(...rankings);
      page++;
      await sleep(DELAY_MS);
    } catch (err) {
      log.warn("fetchLeaderboard", `Page ${page} error: ${err.message}`);
      break;
    }
  }

  const result = players.slice(0, limit);
  log.success("fetchLeaderboard", `${result.length} player(s) found`);
  return result;
}

// ── Fetch Character Equipment + Skills ───────────────────────────────────────
async function fetchCharacterBuild(player, headers, config) {
  const { characterId: charId, serverId } = player;
  if (!charId || !serverId) return null;

  try {
    // 1. Fetch equipment directly
    const getRegionalApiBase = (region) => {
      if (region === "TW") return "https://tw.ncsoft.com/aion2/api";
      return "https://aion2.plaync.com/api";
    };
    const apiBase = getRegionalApiBase(player.region);

    const targetPath = `/character/equipment?lang=en&characterId=${encodeURIComponent(charId)}&serverId=${serverId}`;
    let equipData;
    try {
      equipData = await fetchJSON(proxyUrl(`${apiBase}${targetPath}`), headers);
    } catch (proxyErr) {
      log.warn(player.characterName, `Proxy failed, trying direct fallback: ${proxyErr.message}`);
      equipData = await fetchJSON(`${apiBase}${targetPath}`, headers);
    }

    // 2. Validate class by checking equipped weapons
    // Some leaderboard entries are stale/switched classes, so we check if their
    // MainHand or SubHand matches the expected weapon types for the requested class.
    const eqList = equipData?.equipment?.equipmentList || [];

    // If the API returns a successful response but with no equipment, this is
    // often a transient rate limit or data sync issue. Throw so we retry.
    if (eqList.length === 0) {
      throw new Error("character/equipment returned empty equipmentList");
    }

    const expectedWeapons = CLASS_WEAPONS[config.cls.toLowerCase()] || [];

    let hasValidWeapon = false;
    for (const eq of eqList) {
      if (eq.slotPosName === "MainHand" || eq.slotPosName === "SubHand") {
        // We defer actual parsing to the main loop since we need categoryName
      }
    }

    return { ...player, _equip: equipData };
  } catch {
    return null;
  }
}

// ── Fetch Item Details (batch) ── for arcana set info ──────────────────────────────
async function fetchItemDetails(itemIds, headers) {
  if (itemIds.length === 0) return {};
  const unique = [...new Set(itemIds)];
  const map = {};
  for (let i = 0; i < unique.length; i += 50) {
    const chunk = unique.slice(i, i + 50);
    try {
      const data = await fetchJSON(
        `${BASE}/api/items/batch-details`,
        headers,
        "POST",
        { itemIds: chunk },
      );
      const items = data?.items || data || [];
      for (const item of Array.isArray(items) ? items : []) {
        map[item.id] = item;
      }
    } catch {
      // ignore chunk errors
    }
  }
  return map;
}

// ── Item Level helpers (matches Shugo.gg's exact iLvl source) ────────────────
// Shugo.gg reads ItemLevel directly from character/info stat.statList.
// Checks both statList and statSecondList and alternate names for robustness.
function extractItemLevelFromInfo(infoData) {
  const lists = [
    infoData?.stat?.statList,
    infoData?.stat?.statSecondList,
    infoData?.stat?.statListThird,
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
        if (!isNaN(num) && num > 0) return num;
      }
    }
  }
  return null;
}

async function fetchItemLevel(player, headers) {
  try {
    const apiBase =
      player.region === "TW"
        ? "https://tw.ncsoft.com/aion2/api"
        : "https://aion2.plaync.com/api";
    const infoData = await fetchJSON(
      proxyUrl(
        `${apiBase}/character/info?lang=en&characterId=${player.characterId}&serverId=${player.serverId}`,
      ),
      headers,
    );
    return extractItemLevelFromInfo(infoData);
  } catch {
    return null;
  }
}

// ── Fetch Equipment Details (actual substats) ────────────────────────────────
async function fetchEquipmentDetails(player, headers) {
  const equip = player._equip;
  const eqList = equip?.equipment?.equipmentList || [];
  if (eqList.length === 0) return [];

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
      characterId: player.characterId,
      serverId: player.serverId,
      region: player.region,
    },
  );
  const result = data?.items || data || [];
  const arr = Array.isArray(result) ? result : [];
  // Treat an empty response as a retriable failure — the player has gear, so
  // the API simply hasn't responded yet. This lets fetchWithRetry do its job.
  if (arr.length === 0) throw new Error("batch-equipment returned empty");
  return arr;
}

// ── Extract Build ────────────────────────────────────────────────────────────
// itemLevel: game's own ItemLevel stat from character/info (no fallback formula).
function extractBuild(
  player,
  itemDetailsMap,
  equipDetailsList,
  itemLevel = null,
) {
  const equip = player._equip;
  const build = {
    name: player.characterName || "Unknown",
    rank: player.rank,
    gearScore: null,
    activeSkills: [],
    stigmaSkills: [], // Dp category in API = Stigma in-game
    passiveSkills: [],
    arcanas: [],
    arcanaSets: [],
    equipSubStats: [], // { categoryName, subStats: [{ name, value }] }
  };

  // Skills — Active and Stigma (Dp) skills must be equipped (equip === true) to count.
  // The API returns all skills a character has ever leveled across all classes;
  // filtering by equip keeps only the actively slotted class skills.
  // Passive skills are always active (no equip slot), so include all of them.
  const skillList = equip?.skill?.skillList || [];
  for (const s of skillList) {
    const isPassive = s.category === "Passive";
    if (!isPassive && !s.equip) continue; // Active/Stigma: skip unequipped / other-class skills
    const info = {
      name: s.name,
      level: s.skillLevel || 0,
      equipped: !!s.equip,
    };
    if (s.category === "Active") build.activeSkills.push(info);
    if (s.category === "Dp") build.stigmaSkills.push(info);
    if (isPassive) build.passiveSkills.push(info);
  }

  // Equipment substats (from batch-equipment)
  for (const eqItem of equipDetailsList) {
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
  }

  // Arcanas
  const equipList = equip?.equipment?.equipmentList || [];

  // Gear score: the game's own ItemLevel stat from character/info (exact match with Shugo.gg iLvl).
  build.gearScore = itemLevel ?? null;

  const setCounts = {}; // setName -> piece count
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

  // Build combo string, e.g. "Primal Vigor(4) + Pure Blood(2)"
  build.arcanaSetCombo =
    Object.entries(setCounts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, count]) => `${name}(${count})`)
      .join(" + ") || "None";

  return build;
}

// ── Aggregate Stats ──────────────────────────────────────────────────────────
function aggregate(builds) {
  const total = builds.length;
  const stats = {
    total,
    activeSkills: {}, // name -> { totalLv, count, maxLv, equippedCount }
    stigmaSkills: {},
    passiveSkills: {},
    arcanaUsage: {}, // name -> count
    arcanaSets: {}, // setName -> { count, bonuses }
    arcanaSetCombos: {}, // comboString -> count
    arcanaMainStats: {}, // statName -> count
    equippedStigmaCombos: {},
    subStatsBySlot: {}, // categoryName -> { statName -> { count, totalValue (numeric ones), values: [] } }
  };

  for (const b of builds) {
    // Active
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
    // Stigma (Dp)
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
    // Equipped stigma combo
    // Players can only equip up to 4 stigmas at a time.
    // If the API shows more, it's a merged list from multiple loadouts.
    // We only count valid single-loadout combinations (<= 4 stigmas).
    const equipped = b.stigmaSkills
      .filter((s) => s.equipped)
      .map((s) => s.name)
      .sort();

    if (equipped.length > 0 && equipped.length <= 4) {
      const combo = equipped.join(" + ");
      stats.equippedStigmaCombos[combo] =
        (stats.equippedStigmaCombos[combo] || 0) + 1;
    }

    // Passive
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
    // Arcanas
    for (const a of b.arcanas) {
      stats.arcanaUsage[a.name] = (stats.arcanaUsage[a.name] || 0) + 1;
      if (a.mainStat)
        stats.arcanaMainStats[a.mainStat] =
          (stats.arcanaMainStats[a.mainStat] || 0) + 1;
    }
    // Arcana sets
    for (const s of b.arcanaSets) {
      if (!stats.arcanaSets[s.name]) {
        stats.arcanaSets[s.name] = { count: 0, bonuses: s.bonuses };
      }
      stats.arcanaSets[s.name].count++;
    }
    // Arcana set combos
    if (b.arcanaSetCombo) {
      stats.arcanaSetCombos[b.arcanaSetCombo] =
        (stats.arcanaSetCombos[b.arcanaSetCombo] || 0) + 1;
    }
    // Equipment substats by slot type
    for (const eq of b.equipSubStats) {
      const slotStats = (stats.subStatsBySlot[eq.categoryName] ||= {});
      for (const s of eq.subStats) {
        const entry = (slotStats[s.name] ||= { count: 0, values: [] });
        entry.count++;
        entry.values.push(s.value);
      }
    }
  }

  // Compute averages
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

// ── Format Report ────────────────────────────────────────────────────────────
function formatReport(stats, config) {
  const t = stats.total;
  const lines = [];
  const ln = (...a) => lines.push(a.join(""));
  const sep = () => ln("═".repeat(64));
  const hdr = (title) => {
    ln();
    sep();
    ln(`  ${title}`);
    sep();
  };

  ln();
  ln("╔══════════════════════════════════════════════════════════════╗");
  ln(
    `║  🎮  AION 2 — TOP ${t} ${config.cls.toUpperCase()} BUILD ANALYSIS`.padEnd(
      63,
    ) + "║",
  );
  ln(`║  📊  ${config.lbInfo.label} Leaderboard — shugo.gg`.padEnd(63) + "║");
  ln(`║  📅  ${new Date().toISOString().split("T")[0]}`.padEnd(63) + "║");
  ln("╚══════════════════════════════════════════════════════════════╝");

  // ─── Active Skills ─────────────────────────────────────────────
  hdr("⚔️  ACTIVE SKILLS (ranked by avg level)");
  ln();
  const active = Object.entries(stats.activeSkills).sort(
    (a, b) => b[1].avgLv - a[1].avgLv,
  );
  if (active.length > 0) {
    const mLen = Math.max(...active.map(([n]) => n.length));
    for (const [name, d] of active) {
      ln(
        `  ${name.padEnd(mLen)}  Avg: ${String(d.avgLv).padStart(5)}  Max: ${String(d.maxLv).padStart(2)}`,
      );
    }
  }

  // ─── Passive Skills ───────────────────────────────────────────
  hdr("🛡️  PASSIVE SKILLS (ranked by avg level)");
  ln();
  const passive = Object.entries(stats.passiveSkills).sort(
    (a, b) => b[1].avgLv - a[1].avgLv,
  );
  if (passive.length > 0) {
    const mLen = Math.max(...passive.map(([n]) => n.length));
    for (const [name, d] of passive) {
      ln(
        `  ${name.padEnd(mLen)}  Avg: ${String(d.avgLv).padStart(5)}  Max: ${String(d.maxLv).padStart(2)}`,
      );
    }
  }

  // ─── Stigma Skills ─────────────────────────────────────────────
  hdr("⚡ STIGMA SKILLS (ranked by avg level)");
  ln();
  const stigma = Object.entries(stats.stigmaSkills).sort(
    (a, b) => b[1].avgLv - a[1].avgLv,
  );
  if (stigma.length > 0) {
    const mLen = Math.max(...stigma.map(([n]) => n.length));
    for (const [name, d] of stigma) {
      const eqPct = percent(d.equippedCount, t);
      ln(
        `  ${name.padEnd(mLen)}  Avg: ${String(d.avgLv).padStart(5)}  Max: ${String(d.maxLv).padStart(2)}  Equipped: ${eqPct.padStart(5)}%  (${d.count} players)`,
      );
    }
  }

  // ─── Top Stigma Combos ─────────────────────────────────────────
  if (Object.keys(stats.equippedStigmaCombos).length > 0) {
    hdr("🔗 TOP EQUIPPED STIGMA COMBINATIONS");
    const sorted = Object.entries(stats.equippedStigmaCombos)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    for (let i = 0; i < sorted.length; i++) {
      const [combo, count] = sorted[i];
      ln(`\n  #${i + 1}  (${count}/${t} players — ${percent(count, t)}%)`);
      for (const skill of combo.split(" + ")) ln(`       • ${skill}`);
    }
  }

  // ─── Arcana Set Combinations ──────────────────────────────────
  hdr("🃏 ARCANA SET COMBINATIONS");
  const combos = Object.entries(stats.arcanaSetCombos)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
  if (combos.length > 0) {
    for (let i = 0; i < combos.length; i++) {
      const [combo, count] = combos[i];
      ln(
        `\n  #${i + 1}  ${combo}  — ${count}/${t} players (${percent(count, t)}%)`,
      );
    }
    ln();
  }

  // ─── Arcana Set Bonuses Reference ─────────────────────────────
  const sets = Object.entries(stats.arcanaSets).sort(
    (a, b) => b[1].count - a[1].count,
  );
  if (sets.length > 0) {
    hdr("📖 ARCANA SET BONUSES REFERENCE");
    ln();
    for (const [name, data] of sets) {
      ln(`  ${name}`);
      for (const bonus of data.bonuses) {
        ln(`    ${bonus}`);
      }
      ln();
    }
  }

  // ─── Arcana Base Stats ────────────────────────────────────────
  hdr("📊 ARCANA BASE STATS DISTRIBUTION");
  ln();
  const mStats = Object.entries(stats.arcanaMainStats).sort(
    (a, b) => b[1] - a[1],
  );
  if (mStats.length > 0) {
    const mLen = Math.max(...mStats.map(([n]) => n.length));
    // Total arcana slots across all players
    const totalSlots = Object.values(stats.arcanaMainStats).reduce(
      (a, b) => a + b,
      0,
    );
    for (const [name, count] of mStats) {
      ln(
        `  ${name.padEnd(mLen)}  ${bar(count, totalSlots)} ${String(count).padStart(3)}/${totalSlots} slots (${percent(count, totalSlots)}%)`,
      );
    }
  }

  // ─── Arcana Card Usage ────────────────────────────────────────
  hdr("🎴 ARCANA CARD USAGE");
  ln();
  const cards = Object.entries(stats.arcanaUsage).sort((a, b) => b[1] - a[1]);
  if (cards.length > 0) {
    const mLen = Math.max(...cards.map(([n]) => n.length));
    for (const [name, count] of cards) {
      ln(
        `  ${name.padEnd(mLen)}  ${bar(count, t)} ${String(count).padStart(3)}/${t} (${percent(count, t)}%)`,
      );
    }
  }

  // ─── Equipment Substats By Slot Type ─────────────────────────
  if (Object.keys(stats.subStatsBySlot).length > 0) {
    hdr("⚙️  EQUIPMENT SUBSTATS BY SLOT TYPE");
    // Group by slot type in a logical order
    const slotTypeOrder = [
      "Mace",
      "Spellbook",
      "Staff",
      "Greatsword",
      "Sword",
      "Dagger",
      "Bow",
      "Pistol",
      "Harp",
      "Guard",
      "Top",
      "Legs",
      "Helm",
      "Pauldrons",
      "Gloves",
      "Shoes",
      "Cloak",
      "Belt",
      "Necklace",
      "Earrings",
      "Ring",
      "Bracelet",
      "Rune",
      "Amulet",
    ];
    const orderedTypes = slotTypeOrder.filter((s) => stats.subStatsBySlot[s]);
    for (const s of Object.keys(stats.subStatsBySlot)) {
      if (!orderedTypes.includes(s)) orderedTypes.push(s);
    }

    for (const slotType of orderedTypes) {
      const slotStats = stats.subStatsBySlot[slotType];
      // Total items of this type across all players
      const totalItems = Math.max(
        ...Object.values(slotStats).map((d) => d.count),
        1,
      );
      const sorted = Object.entries(slotStats).sort(
        (a, b) => b[1].count - a[1].count,
      );
      ln();
      ln(`  ── ${slotType} (${totalItems} items across players) ──`);

      const mLen = Math.max(...sorted.map(([n]) => n.length), 1);
      for (const [statName, data] of sorted) {
        // Compute most common value
        const valCounts = {};
        for (const v of data.values) {
          valCounts[v] = (valCounts[v] || 0) + 1;
        }
        const topVal = Object.entries(valCounts).sort((a, b) => b[1] - a[1])[0];
        const pct = percent(data.count, totalItems);
        ln(
          `    ${bar(data.count, totalItems, 10)}  ${statName.padEnd(mLen)}  ${data.count}/${totalItems} (${pct.padStart(5)}%)  most common: ${topVal[0]}`,
        );
      }
    }
  }

  // ─── Summary / Takeaways ──────────────────────────────────────
  hdr("💡 QUICK BUILD GUIDE");
  ln();
  ln("  Top 5 Active Skills to level first:");
  for (const [name, d] of active.slice(0, 5)) {
    ln(`    • ${name} (avg ${d.avgLv})`);
  }

  ln();
  ln("  Top Passive Skills:");
  for (const [name, d] of passive.slice(0, 5)) {
    ln(`    • ${name} (avg ${d.avgLv})`);
  }

  ln();
  ln("  Top Stigma Skills to level:");
  for (const [name, d] of stigma.filter(([, d]) => d.avgLv > 0).slice(0, 5)) {
    ln(
      `    ${d.equippedCount > t / 2 ? "★" : "•"} ${name} (avg ${d.avgLv}, ${percent(d.equippedCount, t)}% equip rate)`,
    );
  }

  if (combos.length > 0) {
    ln();
    ln("  Most Popular Arcana Combo:");
    ln(`    ★ ${combos[0][0]} (${percent(combos[0][1], t)}% of players)`);
    // Show which bonuses activate for this combo
    const parts = combos[0][0].match(/([^(]+)\((\d+)\)/g) || [];
    for (const part of parts) {
      const m = part.match(/(.+)\((\d+)\)/);
      if (m) ln(`      ${m[1].trim()}: ${m[2]}-piece active`);
    }
  }

  ln();
  ln("  ★ = equipped by more than 50% of top players");
  ln();

  return lines.join("\n");
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log();
  console.log(
    "╔══════════════════════════════════════════════════════════════╗",
  );
  console.log(
    "║  Shugo.gg Leaderboard Scraper & Build Analyzer               ║",
  );
  console.log(
    "╚══════════════════════════════════════════════════════════════╝",
  );

  const config = await resolveConfig();
  const headers = makeHeaders(
    `${BASE}/leaderboard/${config.lbType}?class=${config.cls}`,
  );

  log.info("main", `Leaderboard: ${config.lbInfo.label}`);
  log.info("main", `Class: ${config.cls}`);
  log.info("main", `Limit: ${config.limit}`);

  // 1. Leaderboard
  const players = await fetchLeaderboard(config, headers);
  if (players.length === 0) {
    log.error("main", "No players found. Try a different leaderboard type or check shugo.gg.");
    process.exit(1);
  }

  // 2. Fetch builds + equipment details
  //    We keep pulling leaderboard pages until we have collected `config.limit`
  //    valid builds (or run out of pages / players).
  printHeader("🔍 FETCHING CHARACTER BUILDS");
  const enriched = [];
  const allArcanaIds = [];

  // Cursor into the already-fetched `players` array; if we exhaust it we fetch more.
  let playerCursor = 0; // index into `players`
  let lbPage = Math.ceil(players.length / 100) + 1; // next page to fetch
  let scanned = 0; // total candidates examined (for display)
  const MAX_RETRIES = 3;
  const RETRY_BASE_MS = 500;

  while (enriched.length < config.limit) {
    // Refill the candidate pool if we've consumed everything fetched so far
    if (playerCursor >= players.length) {
      if (lbPage > 20) break; // hard cap — don't hammer the API forever
      const { lbInfo, cls } = config;
      const rankingType = CLASS_RANKING_IDS[cls] || 0;
      const url = `${BASE}/api/leaderboard?contentType=${lbInfo.contentType}&rankingType=${rankingType}&page=${lbPage}&limit=100`;
      try {
        const data = await fetchWithRetry(
          () => fetchJSON(url, headers),
          MAX_RETRIES,
          RETRY_BASE_MS,
        );
        const rankings = data?.rankings || [];
        if (rankings.length === 0) break; // no more pages
        players.push(...rankings);
        lbPage++;
        await sleep(DELAY_MS);
      } catch (err) {
        log.warn("main", `Could not fetch more pages: ${err.message}`);
        break;
      }
    }

    const p = players[playerCursor++];
    scanned++;
    const name = p.characterName || "Unknown";
    const gs = p.gearScore;
    log.info(name, `Scanned: ${scanned} | Found: ${enriched.length + 1}/${config.limit}${gs ? ` (GS: ${gs.toLocaleString()})` : ""}`);

    // Fetch build (with retry)
    let result = null;
    try {
      result = await fetchWithRetry(
        () => fetchCharacterBuild(p, headers, config),
        MAX_RETRIES,
        RETRY_BASE_MS,
      );
    } catch (err) {
      log.warn(name, `Skipped: failed after ${MAX_RETRIES} attempts (${err.message})`);
      await sleep(DELAY_MS);
      continue;
    }

    if (!result) {
      await sleep(DELAY_MS);
      continue;
    }

    // Fetch equipment substats (with retry)
    let equipDetails = [];
    try {
      equipDetails = await fetchWithRetry(
        () => fetchEquipmentDetails(result, headers),
        MAX_RETRIES,
        RETRY_BASE_MS,
      );
    } catch (err) {
      log.warn(name, `Failed equipment (using partial data) — ${err.message}`);
      result._equip = null;
    }
    result._equipDetails = equipDetails;

    // Class validation: check MainHand/SubHand against this class's primary weapon
    // Supports localized names (e.g. TW "法杖" for Staff)
    const primaryWeapon = CLASS_WEAPONS[config.cls.toLowerCase()];
    let hasValidWeapon = !primaryWeapon;

    if (primaryWeapon && result._equip && equipDetails.length > 0) {
      const validLabels = [primaryWeapon];
      if (primaryWeapon === "Staff") validLabels.push("法杖"); // TW localized

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
        log.warn(name, `Weapons don't match ${config.cls}. Ignoring equipment data.`);
        // Clear equipment data so they still count towards the leaderboard limit
        // but their irrelevant class stats aren't analyzed.
        result._equip = null;
        equipDetails = [];
        result._equipDetails = [];
      }
    }

    // Fetch the game's own ItemLevel stat from character/info (matches Shugo.gg iLvl exactly)
    const itemLevel = await fetchItemLevel(result, headers);
    result._itemLevel = itemLevel;

    enriched.push(result);
    // Collect arcana item IDs for set info
    const eqList = result._equip?.equipment?.equipmentList || [];
    for (const item of eqList) {
      if ((item.slotPosName || "").startsWith("Arcana")) {
        allArcanaIds.push(item.id);
      }
    }

    await sleep(DELAY_MS);
  }

  log.success("main", `${enriched.length}/${config.limit} builds fetched (scanned ${scanned} candidates)`);

  // 3. Fetch arcana item details (for set bonuses)
  log.info("main", "Fetching Arcana set details...");
  const itemDetails = await fetchItemDetails(allArcanaIds, headers);
  log.success("main", `${Object.keys(itemDetails).length} unique Arcana items resolved`);

  // 4. Extract & Aggregate
  const builds = enriched.map((p) =>
    extractBuild(p, itemDetails, p._equipDetails || [], p._itemLevel ?? null),
  );
  const stats = aggregate(builds);

  // 5. Generate report
  const report = formatReport(stats, config);
  console.log(report);

  // 6. Save report as readable text
  const filename = `${config.cls}_${config.lbType}_builds.txt`;
  writeFileSync(filename, report, "utf-8");
  log.success("main", `Report saved to: ${filename}`);
}

main().catch((err) => {
  log.error("main", `Fatal error: ${err.message || err}`);
  process.exit(1);
});
