// Region identity is part of every character/cache key. Global uses the same
// host as KR, but different language and subregion parameters.
export const regions = {
  GLOBAL: { label: "Global", apiBase: "https://aion2.plaync.com/api", lang: "en-US" },
  KR: { label: "Korea", apiBase: "https://aion2.plaync.com/api", lang: "en" },
  TW: { label: "Taiwan", apiBase: "https://tw.ncsoft.com/aion2/api", lang: "en" },
};

export const globalSubregions = {
  1: { id: "nae", label: "NA East" },
  2: { id: "naw", label: "NA West" },
  3: { id: "eu", label: "EU" },
  4: { id: "la", label: "SA" },
  5: { id: "as", label: "Asia" },
};

export function normalizeRegion(value) {
  const region = String(value || "").toUpperCase();
  const aliases = { KOREA: "KR", TAIWAN: "TW", GLOBAL: "GLOBAL" };
  const normalized = aliases[region] || region;
  return regions[normalized] ? normalized : null;
}

export function globalSubregion(serverId) {
  const id = String(serverId);
  return /^[12][1-5]\d{2}$/.test(id) ? globalSubregions[id[1]].id : null;
}

export function characterKey(player) {
  return JSON.stringify([
    normalizeRegion(player.region),
    String(player.serverId),
    player.characterId,
  ]);
}

export function characterApiUrl(player, path, extra = {}) {
  const region = normalizeRegion(player.region);
  if (!region || !player.characterId || !Number(player.serverId)) {
    throw new Error("Character region and identifiers are required.");
  }
  const config = regions[region];
  const params = new URLSearchParams({
    lang: config.lang,
    characterId: player.characterId,
    serverId: String(player.serverId),
    ...extra,
  });
  if (region === "GLOBAL") {
    const subregion = globalSubregion(player.serverId);
    if (!subregion) throw new Error("Unknown Global server subregion.");
    params.set("region", subregion);
  }
  return `${config.apiBase}/character/${path}?${params}`;
}

export function normalizeFaction(value) {
  const faction = String(value || "").toLowerCase();
  if (faction === "elyos") return "elyos";
  if (["asmodian", "asmodians", "asmo"].includes(faction)) return "asmodian";
  return null;
}

export function matchesPlayerFilters(player, config) {
  if (config.region && config.region !== "all" && player.region !== config.region) return false;
  if (
    config.serverId &&
    config.serverId !== "all" &&
    String(player.serverId) !== String(config.serverId)
  )
    return false;
  if (config.race && config.race !== "all") {
    const faction =
      normalizeFaction(player.faction || player.race) ||
      (Number(player.serverId) >= 2000 ? "asmodian" : "elyos");
    if (faction !== normalizeFaction(config.race)) return false;
  }
  if (config.runeFilter && config.runeFilter !== "all") {
    const rune = (player.equipItems || []).find((item) => item.categoryName === "Rune");
    const name = (rune?.itemName || "").toLowerCase();
    if (config.runeFilter === "pve" && !name.includes("clash")) return false;
    if (config.runeFilter === "pvp" && !name.includes("devotion")) return false;
  }
  return true;
}
