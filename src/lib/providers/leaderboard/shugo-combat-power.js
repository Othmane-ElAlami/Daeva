import { baseUrl, makeHeaders, subrequestBudgetExhausted } from "../../scraper-shared.js";
import { normalizeRegion, normalizeFaction, globalSubregion, characterKey } from "../../regions.js";
import { COMBAT_POWER, CP_SOURCE } from "../../discovery-config.js";
import { ProviderError } from "./base.js";

export class ShugoCombatPowerError extends ProviderError {
  constructor(message, code = "SCHEMA") {
    super(message, CP_SOURCE);
    this.name = "ShugoCombatPowerError";
    this.code = code;
  }
}

function fail(message) {
  throw new ShugoCombatPowerError(message);
}

function timestamp(value) {
  if (value == null) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    fail("Invalid Combat Power timestamp.");
  return value;
}

export function parseCombatPowerResponse(data, config) {
  const region = normalizeRegion(data?.region);
  if (
    !data ||
    region !== config.region ||
    data.sort !== "combatPower" ||
    !Array.isArray(data.entries)
  )
    fail("Combat Power response schema or region changed.");
  for (const key of ["page", "limit", "total", "totalPages"]) {
    if (!Number.isInteger(data[key]) || data[key] < (key === "page" || key === "limit" ? 1 : 0))
      fail(`Invalid Combat Power pagination: ${key}.`);
  }
  if (typeof data.hasMore !== "boolean" || data.page !== (config.startPage || 1))
    fail("Invalid Combat Power pagination.");
  if (
    !data.entries.length &&
    (data.page === 1 || data.hasMore || (data.page - 1) * data.limit < data.total)
  ) {
    throw new ShugoCombatPowerError(
      "Shugo Combat Power returned an empty discovery pool.",
      "EMPTY_RESULT"
    );
  }
  const factionFilter = normalizeFaction(config.race);
  const rankScope =
    config.cls || factionFilter || (config.serverId && config.serverId !== "all")
      ? "filtered"
      : "region";
  const rankings = data.entries.map((entry) => {
    if (
      typeof entry.characterId !== "string" ||
      !entry.characterId.trim() ||
      !Number.isInteger(entry.serverId) ||
      entry.serverId <= 0
    )
      fail("Combat Power entry is missing character identifiers.");
    if (
      normalizeRegion(entry.region) !== region ||
      typeof entry.name !== "string" ||
      !entry.name.trim() ||
      typeof entry.className !== "string"
    )
      fail("Combat Power entry metadata changed.");
    if (config.cls && entry.className.toLowerCase() !== config.cls)
      fail("Shugo did not honor the class filter.");
    const faction = normalizeFaction(entry.faction);
    if (!faction || (factionFilter && faction !== factionFilter))
      fail("Invalid Combat Power faction.");
    if (
      config.serverId &&
      config.serverId !== "all" &&
      String(entry.serverId) !== String(config.serverId)
    )
      fail("Shugo did not honor the server filter.");
    if (
      typeof entry.combatPower !== "number" ||
      !Number.isFinite(entry.combatPower) ||
      entry.combatPower <= 0 ||
      !Number.isInteger(entry.rank) ||
      entry.rank <= 0
    )
      fail("Combat Power score or rank changed.");
    if (
      entry.gearScore != null &&
      (typeof entry.gearScore !== "number" ||
        !Number.isFinite(entry.gearScore) ||
        entry.gearScore < 0)
    )
      fail("Invalid gear score.");
    if (
      region === "GLOBAL" &&
      (!globalSubregion(entry.serverId) || entry.subRegion !== globalSubregion(entry.serverId))
    )
      fail("Unknown Global server/subregion.");
    return {
      characterId: entry.characterId,
      characterName: entry.name,
      serverId: entry.serverId,
      serverName: typeof entry.serverName === "string" ? entry.serverName : null,
      region,
      subRegion: entry.subRegion ?? null,
      class: entry.className.toLowerCase(),
      className: entry.className,
      faction,
      rank: entry.rank,
      // Upstream rank belongs to the requested filters; no region-wide rank is
      // exposed for class-filtered responses. Never invent it from the index.
      globalRank: rankScope === "filtered" ? null : entry.rank,
      rankScope,
      combatPower: entry.combatPower,
      gearScore: entry.gearScore ?? null,
      profileImage: typeof entry.profileImg === "string" ? entry.profileImg : null,
      lastSeen: timestamp(entry.lastSeen),
      source: CP_SOURCE,
    };
  });
  rankings.sort((a, b) => b.combatPower - a.combatPower || a.rank - b.rank);
  return {
    rankings,
    meta: {
      source: CP_SOURCE,
      sourceType: COMBAT_POWER,
      leaderboardType: COMBAT_POWER,
      basis: "Combat Power",
      region,
      health: "complete",
      ageMs: null,
      season: null,
      dataLabel: "Live/Recent Character Data",
      freshness: "Shugo CP leaderboard · periodically refreshed",
      generatedAt: timestamp(data.generatedAt),
      topRefreshedAt: timestamp(data.topRefreshedAt),
      total: data.total,
      totalPages: data.totalPages,
      hasMore: data.hasMore,
      page: data.page,
      pageSize: data.limit,
      pagesFetched: 1,
      rankScope,
    },
  };
}

async function requestPage(url, budget) {
  budget?.consume();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      headers: makeHeaders(`${baseUrl}/leaderboard`),
      // The deployed Worker compatibility date rejects redirect: "error".
      // Manual mode returns 3xx responses for the HTTP guard below to reject.
      redirect: "manual",
      signal: controller.signal,
    });
    if (!response.ok)
      throw new ShugoCombatPowerError(`Combat Power HTTP ${response.status}.`, "HTTP");
    if (response.redirected || !response.headers.get("content-type")?.includes("application/json"))
      throw new ShugoCombatPowerError(
        "Combat Power returned HTML, a challenge or an unexpected redirect.",
        "RESPONSE"
      );
    try {
      return await response.json();
    } catch {
      throw new ShugoCombatPowerError("Combat Power returned malformed JSON.", "RESPONSE");
    }
  } catch (error) {
    if (error instanceof subrequestBudgetExhausted || error instanceof ShugoCombatPowerError)
      throw error;
    throw new ShugoCombatPowerError(`Combat Power request failed: ${error.message}`, "NETWORK");
  } finally {
    clearTimeout(timer);
  }
}

export async function getLeaderboard(config, budget) {
  if (config.lbType !== COMBAT_POWER) fail("Combat Power cannot provide game-mode rankings.");
  const region = normalizeRegion(config.region || "GLOBAL");
  if (!region) fail("A single supported Combat Power region is required.");
  const startPage = config.startPage || 1;
  const pageCount = Math.min(config.maxPages ?? Math.ceil((config.limit || 100) / 100), 3);
  const rankings = [];
  const seen = new Set();
  let meta;
  for (let page = startPage; page < startPage + pageCount; page++) {
    const params = new URLSearchParams({
      region,
      sort: "combatPower",
      page: String(page),
      limit: "100",
    });
    if (config.cls) params.set("class", config.cls.charAt(0).toUpperCase() + config.cls.slice(1));
    if (config.serverId && config.serverId !== "all")
      params.set("serverId", String(config.serverId));
    const faction = normalizeFaction(config.race);
    if (faction) params.set("faction", faction);
    const data = await requestPage(`${baseUrl}/api/leaderboard/combat-power?${params}`, budget);
    const result = parseCombatPowerResponse(data, { ...config, region, startPage: page });
    meta = { ...result.meta, pagesFetched: page - startPage + 1 };
    for (const player of result.rankings) {
      const key = characterKey(player);
      if (seen.has(key)) fail("Combat Power pagination returned duplicate characters.");
      seen.add(key);
      rankings.push(player);
    }
    if (!meta.hasMore || rankings.length >= config.limit) break;
  }
  return {
    rankings: rankings
      .sort((a, b) => b.combatPower - a.combatPower || a.rank - b.rank)
      .slice(0, config.limit || 100),
    meta,
  };
}
