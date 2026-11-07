import { leaderboardTypes } from "./scraper-shared.js";
import { COMBAT_POWER } from "./discovery-config.js";

const EQUIPMENT_GROUPS = [
  {
    label: "Weapons & Guard",
    icon: "⚔️",
    categories: ["Main Hand", "Guard"],
  },
  {
    label: "Armor",
    icon: "🛡️",
    categories: ["Top", "Legs", "Helm", "Pauldrons", "Gloves", "Shoes", "Cloak", "Belt"],
  },
  {
    label: "Accessories",
    icon: "💍",
    categories: [
      "Earrings",
      "Necklace",
      "Amulet",
      "Ring",
      "Bracelet",
      "Brooch",
      "Seal",
      "Pendant",
      "Rune",
    ],
  },
  {
    label: "Arcanas",
    icon: "✨",
    categories: [
      "Grail",
      "Chalice",
      "Parchment",
      "Compass",
      "Bell",
      "Mirror",
      "Scales",
      "Key",
      "Hourglass",
      "Dice",
      "Lantern",
      "Arcana",
    ],
  },
];

const PAIRED_ACCESSORIES = new Set(["Earrings", "Ring", "Bracelet", "Brooch", "Seal", "Rune"]);

function mergeSlotEntries(first, second, kind) {
  const merged = { ...first };
  for (const [name, entry] of Object.entries(second)) {
    const current = merged[name];
    if (!current) {
      merged[name] = entry;
      continue;
    }
    merged[name] =
      kind === "substats"
        ? {
            ...current,
            count: current.count + entry.count,
            values: [...current.values, ...entry.values],
          }
        : {
            ...current,
            count: current.count + entry.count,
            grade: current.grade ?? entry.grade,
            maxEnchant: Math.max(current.maxEnchant || 0, entry.maxEnchant || 0),
            itemLevel:
              entry.itemLevel != null &&
              (current.itemLevel == null || entry.itemLevel > current.itemLevel)
                ? entry.itemLevel
                : (current.itemLevel ?? null),
          };
  }
  return merged;
}

// Both equipment panels must classify the same slots, including cached builds
// with numbered slots and categories carrying parenthesized qualifiers.
export function groupEquipmentSlots(slots = {}, kind = "items") {
  const groups = EQUIPMENT_GROUPS.map(({ label, icon }) => ({ label, icon, slots: [] }));
  const other = { label: "Other Equipment", icon: "📦", slots: [] };

  for (const [slot, entries] of Object.entries(slots)) {
    if (!entries || Object.keys(entries).length === 0) continue;
    const category = slot
      .replace(/\s*\([^)]*\)$/, "")
      .replace(/\d+$/, "")
      .trim()
      .replace(/^Earring$/, "Earrings");
    const index = EQUIPMENT_GROUPS.findIndex((group) => group.categories.includes(category));
    const group = index === -1 ? other : groups[index];
    const displaySlot = PAIRED_ACCESSORIES.has(category) ? category : slot;
    const existing = group.slots.find(([name]) => name === displaySlot);
    if (existing) existing[1] = mergeSlotEntries(existing[1], entries, kind);
    else group.slots.push([displaySlot, entries]);
  }

  return [...groups, other].filter((group) => group.slots.length > 0);
}

export function resultLabel(type, historical = false) {
  const label = leaderboardTypes[type]?.label || type;
  return historical
    ? `Historical ${label} Snapshot`
    : type === COMBAT_POWER
      ? "Top Combat Power Builds"
      : `Top ${label} Builds`;
}

export function canQuickBuild(stats, builds) {
  return (
    !!stats && !stats.isHistorical && stats.total > 0 && Array.isArray(builds) && builds.length > 0
  );
}

export function leaderboardLabel(type) {
  return leaderboardTypes[type]?.label || type;
}

export function stigmaUsagePercent(stat, total, historical = false) {
  // Older aggregates store usage count/pct, not equippedCount. Preserve those
  // recorded values without inventing player-level equipment information.
  if (historical && stat.equippedCount == null) {
    if (Number.isFinite(stat.pct)) return stat.pct;
    return total > 0 && Number.isFinite(stat.count) ? (stat.count / total) * 100 : null;
  }
  return total > 0 && Number.isFinite(stat.equippedCount)
    ? (stat.equippedCount / total) * 100
    : null;
}

// Pick a real player's template that best represents the observed skill/item
// usage. This preserves a playable combination instead of inventing a build.
export function quickBuild(stats, builds) {
  if (!canQuickBuild(stats, builds)) return null;
  const score = (build) =>
    [...build.activeSkills, ...build.stigmaSkills].reduce(
      (sum, skill) =>
        sum + (stats.activeSkills[skill.name]?.count || stats.stigmaSkills[skill.name]?.count || 0),
      0
    ) +
    build.equipItems.reduce(
      (sum, item) => sum + (stats.itemsBySlot[item.categoryName]?.[item.itemName]?.count || 0),
      0
    );
  return [...builds].sort(
    (a, b) =>
      score(b) - score(a) || (b.leaderboardCombatPower || 0) - (a.leaderboardCombatPower || 0)
  )[0];
}

export function sourceHealthText(meta) {
  if (meta.health === "unavailable") return "Unavailable";
  if (meta.health === "historical") return "Historical aggregate snapshot";
  const omitted = meta.unavailablePlayers?.length || 0;
  const availability = omitted
    ? ` · ${omitted} unavailable profile${omitted === 1 ? "" : "s"} omitted`
    : "";
  if (meta.source === "Cache")
    return `${meta.health === "stale" ? "Stale" : "Recent"} full-build cache · fetched ${new Date(meta.fetchedAt).toISOString()}${availability}`;
  if (meta.leaderboardType === COMBAT_POWER)
    return `Live/Recent Character Data · Shugo CP leaderboard · periodically refreshed${availability}`;
  return meta.health === "partial" ? "Partial Data" : "Recent Character Data";
}
