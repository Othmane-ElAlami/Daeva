#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Aion 2 Leaderboard Scraper (shugo.gg) & Build Analyzer (Official API)
// Fetches top players and analyzes Active, Stigma, Passive skills + Arcanas
// Usage: node scraper.mjs [--class chanter] [--type nightmare] [--limit 100]
// ─────────────────────────────────────────────────────────────────────────────

import { writeFileSync } from "fs";
import { argv } from "process";
import { createInterface } from "readline";
import { createCliLogger } from "./src/lib/logger.js";
import {
  baseUrl,
  leaderboardTypes,
  classRankingIds,
  classWeapons,
  classes,
  makeHeaders,
  makeDirectHeaders,
  sleep,
  proxyUrl,
  fetchJSON,
  fetchWithRetry,
  fetchItemLevelAndCP,
  extractItemLevelFromInfo,
  extractCombatPowerFromInfo,
  extractBuild,
  aggregate,
} from "./src/lib/scraper-shared.js";

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

// ── Resolve config ───────────────────────────────────────────────────────────
async function resolveConfig() {
  let lbType = getArg("type");
  let cls = getArg("class");
  let limit = getArg("limit");

  if (!lbType) {
    console.log("\n  Available leaderboard types:");
    Object.entries(leaderboardTypes).forEach(([key, v], i) =>
      console.log(`    ${i + 1}. ${v.label} (${key})`),
    );
    const ans = await ask("\n  Choose leaderboard type (name or number): ");
    const keys = Object.keys(leaderboardTypes);
    const num = parseInt(ans, 10);
    if (num >= 1 && num <= keys.length) {
      lbType = keys[num - 1];
    } else if (leaderboardTypes[ans.toLowerCase()]) {
      lbType = ans.toLowerCase();
    } else {
      log.error("resolveConfig", "Invalid leaderboard type.");
      process.exit(1);
    }
  }

  if (!cls) {
    console.log("\n  Available classes:");
    classes.forEach((c, i) =>
      console.log(`    ${i + 1}. ${c.charAt(0).toUpperCase() + c.slice(1)}`),
    );
    const ans = await ask("\n  Choose class (name or number): ");
    const num = parseInt(ans, 10);
    if (num >= 1 && num <= classes.length) {
      cls = classes[num - 1];
    } else if (classes.includes(ans.toLowerCase())) {
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
    lbInfo: leaderboardTypes[lbType.toLowerCase()],
    cls: cls.toLowerCase(),
    limit,
  };
}

// ── CLI-only Constants ───────────────────────────────────────────────────────
const delayMs = 250;
const fetchTimeoutMs = 15000; // 15s timeout per request

// ── CLI-only Helpers ─────────────────────────────────────────────────────────
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

// ── Fetch Leaderboard ────────────────────────────────────────────────────────
async function fetchLeaderboard(config, headers) {
  printHeader("📋 FETCHING LEADERBOARD");

  const { lbInfo, limit, cls } = config;
  const rankingType = classRankingIds[cls] || 0;
  const players = [];
  let page = 1;

  while (players.length < limit && page <= 10) {
    const url = `${baseUrl}/api/leaderboard?contentType=${lbInfo.contentType}&rankingType=${rankingType}&page=${page}&limit=100`;
    log.info("fetchLeaderboard", `Fetching page ${page}...`);
    try {
      const data = await fetchJSON(url, headers);
      const rankings = data?.rankings || [];
      if (rankings.length === 0) break;
      players.push(...rankings);
      page++;
      await sleep(delayMs);
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
  if (!charId || !serverId) {
    log.warn(
      player.characterName || "Unknown",
      "Missing characterId or serverId — skipped",
    );
    return null;
  }

  try {
    const getRegionalApiBase = (region) => {
      if (region === "TW") return "https://tw.ncsoft.com/aion2/api";
      return "https://aion2.plaync.com/api";
    };
    const apiBase = getRegionalApiBase(player.region);

    const targetPath = `/character/equipment?lang=en&characterId=${encodeURIComponent(charId)}&serverId=${serverId}`;
    let equipData;

    // CLI scraper: try direct API first (more reliable, no proxy overhead).
    // Direct calls MUST NOT include Origin / Referer headers (CORS rejection).
    try {
      equipData = await fetchJSON(
        `${apiBase}${targetPath}`,
        makeDirectHeaders(),
      );
    } catch (directErr) {
      log.warn(
        player.characterName,
        `Direct API failed (${directErr.message}), trying proxy fallback…`,
      );
      equipData = await fetchJSON(proxyUrl(`${apiBase}${targetPath}`), headers);
    }

    const eqList = equipData?.equipment?.equipmentList || [];

    if (eqList.length === 0) {
      throw new Error("character/equipment returned empty equipmentList");
    }

    return { ...player, _equip: equipData };
  } catch (err) {
    log.warn(
      player.characterName || "Unknown",
      `Build fetch failed: ${err.message}`,
    );
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
        `${baseUrl}/api/items/batch-details`,
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

// ── Fetch Equipment Details (actual substats) ────────────────────────────────
async function fetchEquipmentDetails(player, headers) {
  const equip = player._equip;
  const eqList = equip?.equipment?.equipmentList || [];
  if (eqList.length === 0) return [];

  const items = eqList
    .filter((e) => e)
    .map((e) => ({
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

  // ─── Equipment Items By Slot Type ────────────────────────────
  if (Object.keys(stats.itemsBySlot).length > 0) {
    hdr("🛡️  EQUIPMENT ITEMS BY SLOT TYPE");
    const slotTypeOrder = [
      "Mace", "Spellbook", "Staff", "Greatsword", "Longsword", "Sword", "Dagger", "Bow", "Orb", "Pistol", "Harp", "Guard",
      "Top", "Legs", "Helm", "Pauldrons", "Gloves", "Shoes", "Cloak", 
      "Belt", "Necklace", "Earrings", "Ring", "Bracelet", "Rune", "Amulet"
    ];
    const orderedTypes = slotTypeOrder.filter((s) => stats.itemsBySlot[s]);
    for (const s of Object.keys(stats.itemsBySlot)) {
      if (!orderedTypes.includes(s)) orderedTypes.push(s);
    }

    for (const slotType of orderedTypes) {
      const slotItems = stats.itemsBySlot[slotType];
      const totalItems = Object.values(slotItems).reduce((acc, curr) => acc + curr.count, 0);
      const sorted = Object.entries(slotItems).sort((a, b) => b[1].count - a[1].count);
      
      ln();
      ln(`  ── ${slotType} (${totalItems} items equipped) ──`);
      const mLen = Math.max(...sorted.map(([n]) => n.length), 1);
      
      for (const [itemName, data] of sorted) {
        const pct = percent(data.count, totalItems);
        ln(`    ${bar(data.count, totalItems, 10)}  ${itemName.padEnd(mLen)}  ${data.count}/${totalItems} (${pct.padStart(5)}%)  [${data.grade || "Unknown"}]`);
      }
    }
  }

  // ─── Equipment Substats By Slot Type ─────────────────────────
  if (Object.keys(stats.subStatsBySlot).length > 0) {
    hdr("⚙️  EQUIPMENT SUBSTATS BY SLOT TYPE");
    // Group by slot type in a logical order
    const slotTypeOrder = [
      "Mace", "Spellbook", "Staff", "Greatsword", "Longsword", "Sword", "Dagger", "Bow", "Orb", "Pistol", "Harp", "Guard",
      "Top", "Legs", "Helm", "Pauldrons", "Gloves", "Shoes", "Cloak", 
      "Belt", "Necklace", "Earrings", "Ring", "Bracelet", "Rune", "Amulet"
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
    `${baseUrl}/leaderboard/${config.lbType}?class=${config.cls}`,
  );

  log.info("main", `Leaderboard: ${config.lbInfo.label}`);
  log.info("main", `Class: ${config.cls}`);
  log.info("main", `Limit: ${config.limit}`);

  // 1. Leaderboard
  const players = await fetchLeaderboard(config, headers);
  if (players.length === 0) {
    log.error(
      "main",
      "No players found. Try a different leaderboard type or check shugo.gg.",
    );
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
  const maxRetries = 3;
  const retryBaseMs = 500;

  while (enriched.length < config.limit) {
    // Refill the candidate pool if we've consumed everything fetched so far
    if (playerCursor >= players.length) {
      if (lbPage > 20) break; // hard cap — don't hammer the API forever
      const { lbInfo, cls } = config;
      const rankingType = classRankingIds[cls] || 0;
      const url = `${baseUrl}/api/leaderboard?contentType=${lbInfo.contentType}&rankingType=${rankingType}&page=${lbPage}&limit=100`;
      try {
        const data = await fetchWithRetry(
          () => fetchJSON(url, headers),
          maxRetries,
          retryBaseMs,
        );
        const rankings = data?.rankings || [];
        if (rankings.length === 0) break; // no more pages
        players.push(...rankings);
        lbPage++;
        await sleep(delayMs);
      } catch (err) {
        log.warn("main", `Could not fetch more pages: ${err.message}`);
        break;
      }
    }

    const p = players[playerCursor++];
    scanned++;
    const name = p.characterName || "Unknown";
    const pGs = p.gearScore;
    const pCp = p.combatPower;
    const statsStr = [pGs ? `GS: ${pGs.toLocaleString()}` : "", pCp ? `CP: ${pCp.toLocaleString()}` : ""].filter(Boolean).join(" | ");
    log.info(
      name,
      `Scanned: ${scanned} | Found: ${enriched.length + 1}/${config.limit}${statsStr ? ` (${statsStr})` : ""}`,
    );

    // Fetch build (with retry)
    let result = null;
    try {
      result = await fetchWithRetry(
        () => fetchCharacterBuild(p, headers, config),
        maxRetries,
        retryBaseMs,
      );
    } catch (err) {
      log.warn(
        name,
        `Skipped: failed after ${maxRetries} attempts (${err.message})`,
      );
      await sleep(delayMs);
      continue;
    }

    if (!result) {
      await sleep(delayMs);
      continue;
    }

    // Fetch equipment substats (with retry)
    let equipDetails = [];
    try {
      equipDetails = await fetchWithRetry(
        () => fetchEquipmentDetails(result, headers),
        maxRetries,
        retryBaseMs,
      );
    } catch (err) {
      log.warn(
        name,
        `Failed equipment substats (skills/gear still usable) — ${err.message}`,
      );
      // DO NOT null-out _equip here — it contains already-fetched skills + equipment
      // that are perfectly valid.  Only the equipment substats are missing.
    }
    result._equipDetails = equipDetails;

    // Class validation: check MainHand/SubHand against this class's primary weapon.
    // Uses item names from the direct API (reliable) rather than categoryName from
    // batch-equipment (which often returns null items).
    const primaryWeapon = classWeapons[config.cls.toLowerCase()];
    let hasValidWeapon = !primaryWeapon;

    if (primaryWeapon && result._equip) {
      const validLabels = Array.isArray(primaryWeapon)
        ? [...primaryWeapon]
        : [primaryWeapon];

      const eqList = result._equip.equipment?.equipmentList || [];
      for (const item of eqList) {
        if (!item) continue;
        if (item.slotPos === 1 || item.slotPos === 2) {
          const itemName = item.name || "";
          const cat = item.categoryName || "";
          if (
            validLabels.some(
              (label) => itemName.includes(label) || cat.startsWith(label),
            )
          ) {
            hasValidWeapon = true;
            break;
          }
        }
      }

      if (!hasValidWeapon) {
        log.warn(
          name,
          `Weapons don't match ${config.cls}. Ignoring equipment data.`,
        );
        // Clear equipment data so they still count towards the leaderboard limit
        // but their irrelevant class stats aren't analyzed.
        result._equip = null;
        equipDetails = [];
        result._equipDetails = [];
      }
    }

    // Fetch the game's own ItemLevel and CP stat from character/info.
    // Try direct API first (faster / more reliable from CLI), then proxy fallback.
    let itemLevel = null;
    let cp = null;
    try {
      const apiBase2 =
        result.region === "TW"
          ? "https://tw.ncsoft.com/aion2/api"
          : "https://aion2.plaync.com/api";
      const infoData = await fetchJSON(
        `${apiBase2}/character/info?lang=en&characterId=${result.characterId}&serverId=${result.serverId}`,
        makeDirectHeaders(),
      );
      itemLevel = extractItemLevelFromInfo(infoData);
      cp = extractCombatPowerFromInfo(infoData);
    } catch {
      // Direct failed — fall back to the proxy-based helper
      const stats = await fetchItemLevelAndCP(result, headers);
      if (stats) {
        itemLevel = stats.itemLevel;
        cp = stats.combatPower;
      }
    }
    result._itemLevel = itemLevel;
    result._combatPower = cp;

    enriched.push(result);
    // Collect arcana item IDs for set info
    const eqList = result._equip?.equipment?.equipmentList || [];
    for (const item of eqList) {
      if ((item.slotPosName || "").startsWith("Arcana")) {
        allArcanaIds.push(item.id);
      }
    }

    await sleep(delayMs);
  }

  log.success(
    "main",
    `${enriched.length}/${config.limit} builds fetched (scanned ${scanned} candidates)`,
  );

  // 3. Fetch arcana item details (for set bonuses)
  log.info("main", "Fetching Arcana set details...");
  const itemDetailsMap = await fetchItemDetails(allArcanaIds, headers);
  log.success(
    "main",
    `${Object.keys(itemDetailsMap).length} unique Arcana items resolved`,
  );

  // 4. Extract & Aggregate
  const builds = enriched.map((p) =>
    extractBuild(p, itemDetailsMap, p._equipDetails || [], p._itemLevel ?? null, p._combatPower ?? null),
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
