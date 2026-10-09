import { leaderboardTypes, classes, serverNames } from "./scraper-shared.js";
import { regions, globalSubregions } from "./regions.js";

export const COMBAT_POWER = "combat-power";
export const CP_SOURCE = "Shugo Combat Power";

export function getSourceMode(env = {}) {
  const mode = env.LEADERBOARD_SOURCE_MODE || process.env.LEADERBOARD_SOURCE_MODE || COMBAT_POWER;
  if (![COMBAT_POWER, "mode-specific"].includes(mode))
    throw new Error("Invalid LEADERBOARD_SOURCE_MODE.");
  return mode;
}

export function isHistoricalOnly(lbType, sourceMode) {
  return sourceMode === COMBAT_POWER && lbType !== COMBAT_POWER;
}

// Existing D1 TEXT fields can safely carry a qualified population key. Legacy
// keys remain byte-for-byte unchanged so their snapshots survive this switch.
export function populationKey(lbType, region) {
  if (lbType !== COMBAT_POWER) return lbType;
  if (!regions[region]) throw new Error("A single supported region is required for Combat Power.");
  return `${COMBAT_POWER}:shugo-cp:${region}`;
}

export function parsePopulationKey(key) {
  const match = /^combat-power:shugo-cp:(GLOBAL|KR|TW)$/.exec(key);
  return match
    ? { leaderboard: COMBAT_POWER, region: match[1], source: CP_SOURCE }
    : { leaderboard: key, region: "all", source: null };
}

export function discoveryConfig(env = {}) {
  const sourceMode = getSourceMode(env);
  const servers = Object.fromEntries(
    Object.keys(regions).map((region) => {
      const list = Object.entries(serverNames).map(([id, name]) => ({ id, name }));
      if (region !== "GLOBAL") return [region, list];
      // Public Shugo server catalog, inspected 2026-10-09. These families have
      // different counts; do not offer fabricated copies of all legacy servers.
      const counts = { 1: 10, 2: 5, 3: 23, 4: 6, 5: 18 };
      const globalNames = {
        ...serverNames,
        1021: "Gauss",
        1022: "Lamuatan",
        1023: "Nathara",
        2020: "Indnath",
        2021: "Agnita",
        2022: "Atiel",
        2023: "Tassin",
      };
      return [
        region,
        Object.entries(globalSubregions).flatMap(([digit, subregion]) =>
          Object.entries(globalNames)
            .map(([id, name]) => ({ id, name }))
            .filter(({ id }) => Number(id.slice(2)) <= counts[digit])
            .map(({ id, name }) => ({
              id: `${id[0]}${digit}${id.slice(2)}`,
              name: `${name} (${subregion.label})`,
            }))
        ),
      ];
    })
  );
  return {
    sourceMode,
    defaultLeaderboard: sourceMode === COMBAT_POWER ? COMBAT_POWER : "nightmare",
    classes,
    regions: Object.entries(regions).map(([id, value]) => ({ id, label: value.label })),
    leaderboards: Object.entries(leaderboardTypes).map(([id, value]) => ({
      id,
      label: value.label,
      historicalOnly: isHistoricalOnly(id, sourceMode),
    })),
    servers,
  };
}
