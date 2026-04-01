// ─────────────────────────────────────────────────────────────────────────────
// Integration tests: full data pipeline
// Verifies extractBuild → aggregate → snapshot consistency
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { extractBuild, aggregate } from "../../src/lib/scraper-shared.js";

function makeFullPlayer(name, serverId, overrides = {}) {
  return {
    characterName: name,
    serverId,
    region: serverId >= 2000 ? "KR" : "KR",
    faction: "Elyos",
    globalRank: overrides.rank || 1,
    _equip: {
      skill: {
        skillList: [
          {
            name: "Divine Strike",
            category: "Active",
            skillLevel: 5,
            equip: true,
          },
          {
            name: "Healing Light",
            category: "Active",
            skillLevel: 4,
            equip: true,
          },
          { name: "Word of Wind", category: "Dp", skillLevel: 3, equip: true },
          { name: "Shield Mantra", category: "Dp", skillLevel: 2, equip: true },
          {
            name: "Recovery Increase",
            category: "Dp",
            skillLevel: 4,
            equip: true,
          },
          {
            name: "Aetheric Field",
            category: "Dp",
            skillLevel: 3,
            equip: true,
          },
          {
            name: "Crit Strike",
            category: "Passive",
            skillLevel: 3,
            equip: false,
          },
          {
            name: "Evasion Mastery",
            category: "Passive",
            skillLevel: 2,
            equip: false,
          },
        ],
      },
      equipment: {
        equipmentList: [
          {
            id: "w1",
            name: "Archon's Mace",
            slotPos: 1,
            slotPosName: "MainHand1",
            grade: 5,
            enchantLevel: 15,
          },
          {
            id: "s1",
            name: "Noble Shield",
            slotPos: 2,
            slotPosName: "SubHand1",
            grade: 5,
          },
          {
            id: "t1",
            name: "Sacred Robe",
            slotPos: 3,
            slotPosName: "Torso",
            grade: 5,
          },
          {
            id: "p1",
            name: "Holy Leggings",
            slotPos: 4,
            slotPosName: "Pants",
            grade: 4,
          },
          {
            id: "h1",
            name: "Divine Helm",
            slotPos: 5,
            slotPosName: "Helmet",
            grade: 5,
          },
          {
            id: "sh1",
            name: "Blessed Pauldrons",
            slotPos: 6,
            slotPosName: "Shoulder",
            grade: 4,
          },
          {
            id: "g1",
            name: "Holy Gloves",
            slotPos: 7,
            slotPosName: "Gloves",
            grade: 5,
          },
          {
            id: "b1",
            name: "Sacred Boots",
            slotPos: 8,
            slotPosName: "Boots",
            grade: 4,
          },
          {
            id: "n1",
            name: "Star Necklace",
            slotPos: 9,
            slotPosName: "Necklace",
            grade: 5,
          },
          {
            id: "arc1",
            name: "Blood Grail",
            slotPos: 10,
            slotPosName: "Arcana1",
            grade: 5,
            enchantLevel: 3,
          },
          {
            id: "arc2",
            name: "Vigor Parchment",
            slotPos: 11,
            slotPosName: "Arcana2",
            grade: 5,
            enchantLevel: 2,
          },
          {
            id: "arc3",
            name: "Blood Compass",
            slotPos: 12,
            slotPosName: "Arcana3",
            grade: 4,
            enchantLevel: 1,
          },
          {
            id: "arc4",
            name: "Blood Bell",
            slotPos: 13,
            slotPosName: "Arcana4",
            grade: 5,
            enchantLevel: 3,
          },
          {
            id: "arc5",
            name: "Vigor Mirror",
            slotPos: 14,
            slotPosName: "Arcana5",
            grade: 4,
            enchantLevel: 2,
          },
          {
            id: "arc6",
            name: "Blood Scales",
            slotPos: 15,
            slotPosName: "Arcana6",
            grade: 5,
            enchantLevel: 3,
          },
          {
            id: "rune1",
            name: overrides.runeName || "Clash Rune of Valor",
            slotPos: 16,
            slotPosName: "Rune1",
            grade: 5,
          },
        ],
      },
      profile: { factionName: "Elyos", combatPower: 15000 },
    },
    ...overrides,
  };
}

const itemDetailsMap = {
  arc1: {
    mainStats: [{ name: "Attack", value: "+120" }],
    set: {
      name: "Pure Blood",
      bonuses: [
        { degree: 2, descriptions: ["+5% ATK"] },
        { degree: 4, descriptions: ["+10% ATK"] },
      ],
    },
  },
  arc2: {
    mainStats: [{ name: "HP", value: "+800" }],
    set: {
      name: "Primal Vigor",
      bonuses: [{ degree: 2, descriptions: ["+5% HP"] }],
    },
  },
  arc3: {
    mainStats: [{ name: "Attack", value: "+100" }],
    set: {
      name: "Pure Blood",
      bonuses: [
        { degree: 2, descriptions: ["+5% ATK"] },
        { degree: 4, descriptions: ["+10% ATK"] },
      ],
    },
  },
  arc4: {
    mainStats: [{ name: "Attack", value: "+110" }],
    set: {
      name: "Pure Blood",
      bonuses: [
        { degree: 2, descriptions: ["+5% ATK"] },
        { degree: 4, descriptions: ["+10% ATK"] },
      ],
    },
  },
  arc5: {
    mainStats: [{ name: "HP", value: "+750" }],
    set: {
      name: "Primal Vigor",
      bonuses: [{ degree: 2, descriptions: ["+5% HP"] }],
    },
  },
  arc6: {
    mainStats: [{ name: "Attack", value: "+130" }],
    set: {
      name: "Pure Blood",
      bonuses: [
        { degree: 2, descriptions: ["+5% ATK"] },
        { degree: 4, descriptions: ["+10% ATK"] },
      ],
    },
  },
};

const equipDetailsList = [
  {
    categoryName: "Main Hand",
    slotPos: 1,
    subStats: [
      { name: "Physical Attack", value: "+250" },
      { name: "Accuracy", value: "+45" },
    ],
    subSkills: [{ name: "Critical Hit", level: 2 }],
  },
  {
    categoryName: "Top",
    slotPos: 3,
    subStats: [
      { name: "Physical Defense", value: "+180" },
      { name: "HP", value: "+1200" },
    ],
    subSkills: [],
  },
];

describe("Full pipeline: extractBuild → aggregate", () => {
  it("correctly processes a realistic player through the full pipeline", () => {
    const player = makeFullPlayer("TopChanter", 1001, { rank: 1 });
    const build = extractBuild(player, itemDetailsMap, equipDetailsList, 420, 15000);

    // Verify build extraction
    expect(build.name).toBe("TopChanter");
    expect(build.serverName).toBe("Siel");
    expect(build.race).toBe("Elyos");
    expect(build.gearScore).toBe(420);
    expect(build.combatPower).toBe(15000);

    // Skills
    expect(build.activeSkills).toHaveLength(2);
    expect(build.stigmaSkills).toHaveLength(4);
    expect(build.passiveSkills).toHaveLength(2);

    // Equipment
    expect(build.equipItems.length).toBeGreaterThan(0);
    const mainHand = build.equipItems.find((e) => e.categoryName === "Main Hand");
    expect(mainHand).toBeDefined();
    expect(mainHand.itemName).toBe("Archon's Mace");

    // Arcanas
    expect(build.arcanas).toHaveLength(6);
    expect(build.arcanaSetCombo).toBe("Pure Blood(4) + Primal Vigor(2)");

    // Substats
    expect(build.equipSubStats.length).toBeGreaterThan(0);
    const mainHandStats = build.equipSubStats.find((e) => e.categoryName === "Main Hand");
    expect(mainHandStats).toBeDefined();
    expect(mainHandStats.subStats).toHaveLength(3); // 2 substats + 1 skill

    // Now aggregate
    const stats = aggregate([build]);
    expect(stats.total).toBe(1);
    expect(stats.activeSkills["Divine Strike"]).toBeDefined();
    expect(stats.activeSkills["Divine Strike"].avgLv).toBe(5);
    expect(stats.stigmaSkills["Word of Wind"]).toBeDefined();
    expect(stats.passiveSkills["Crit Strike"]).toBeDefined();
    expect(stats.arcanaSetCombos["Pure Blood(4) + Primal Vigor(2)"]).toBe(1);
    expect(stats.scannedPlayers).toHaveLength(1);
    expect(stats.scannedPlayers[0].gearScore).toBe(420);
  });

  it("aggregates multiple players correctly", () => {
    const players = [
      makeFullPlayer("Player1", 1001, { rank: 1 }),
      makeFullPlayer("Player2", 1002, { rank: 2 }),
      makeFullPlayer("Player3", 2001, { rank: 3 }),
    ];

    const builds = players.map((p) =>
      extractBuild(p, itemDetailsMap, equipDetailsList, 400, 12000)
    );

    const stats = aggregate(builds);

    expect(stats.total).toBe(3);
    expect(stats.activeSkills["Divine Strike"].count).toBe(3);
    expect(stats.activeSkills["Divine Strike"].avgLv).toBe(5);
    expect(stats.stigmaSkills["Word of Wind"].count).toBe(3);
    expect(stats.arcanaSetCombos["Pure Blood(4) + Primal Vigor(2)"]).toBe(3);
    expect(stats.scannedPlayers).toHaveLength(3);

    // Verify server data propagated correctly
    const races = stats.scannedPlayers.map((p) => p.race);
    expect(races.filter((r) => r === "Elyos")).toHaveLength(2);
    expect(races.filter((r) => r === "Asmo")).toHaveLength(1);
  });

  it("handles mixed builds with different skill sets", () => {
    const player1 = makeFullPlayer("Player1", 1001);
    const player2 = makeFullPlayer("Player2", 1002);
    // Modify player2's skills
    player2._equip.skill.skillList = [
      { name: "Meteor Strike", category: "Active", skillLevel: 7, equip: true },
      { name: "Ice Wall", category: "Dp", skillLevel: 5, equip: true },
      { name: "Crit Strike", category: "Passive", skillLevel: 4, equip: false },
    ];

    const build1 = extractBuild(player1, itemDetailsMap, [], 400, 10000);
    const build2 = extractBuild(player2, itemDetailsMap, [], 420, 12000);

    const stats = aggregate([build1, build2]);

    // Player1 has Divine Strike, Player2 has Meteor Strike
    expect(stats.activeSkills["Divine Strike"].count).toBe(1);
    expect(stats.activeSkills["Meteor Strike"].count).toBe(1);

    // Both have Crit Strike passive but at different levels
    expect(stats.passiveSkills["Crit Strike"].count).toBe(2);
    expect(stats.passiveSkills["Crit Strike"].avgLv).toBe(3.5);
    expect(stats.passiveSkills["Crit Strike"].maxLv).toBe(4);
  });

  it("handles player with empty equipment", () => {
    const player = makeFullPlayer("EmptyGear", 1001);
    player._equip.equipment.equipmentList = [];
    player._equip.skill.skillList = [];

    const build = extractBuild(player, {}, [], null, null);
    expect(build.equipItems).toEqual([]);
    expect(build.activeSkills).toEqual([]);
    expect(build.arcanaSetCombo).toBe("None");

    const stats = aggregate([build]);
    expect(stats.total).toBe(1);
    expect(Object.keys(stats.activeSkills)).toHaveLength(0);
  });

  it("preserves data integrity through extract+aggregate+extract cycle", () => {
    // Simulate processing the same player data twice to catch mutation bugs
    const player = makeFullPlayer("TestPlayer", 1001);

    const build1 = extractBuild(player, itemDetailsMap, equipDetailsList, 400, 10000);
    const stat1 = aggregate([build1]);

    const build2 = extractBuild(player, itemDetailsMap, equipDetailsList, 400, 10000);
    const stat2 = aggregate([build2]);

    // Results should be identical
    expect(stat1.total).toBe(stat2.total);
    expect(stat1.activeSkills).toEqual(stat2.activeSkills);
    expect(stat1.stigmaSkills).toEqual(stat2.stigmaSkills);
    expect(stat1.passiveSkills).toEqual(stat2.passiveSkills);
    expect(stat1.arcanaSetCombos).toEqual(stat2.arcanaSetCombos);
  });

  it("slot mapping is exhaustive for all equipment slot types", () => {
    const player = makeFullPlayer("SlotTest", 1001);
    const build = extractBuild(player, itemDetailsMap, [], 400, 10000);

    // Verify all expected slot categories appear
    const categories = build.equipItems.map((e) => e.categoryName);
    expect(categories).toContain("Main Hand");
    expect(categories).toContain("Guard");
    expect(categories).toContain("Top");
    expect(categories).toContain("Legs");
    expect(categories).toContain("Helm");
    expect(categories).toContain("Pauldrons");
    expect(categories).toContain("Gloves");
    expect(categories).toContain("Shoes");
    expect(categories).toContain("Necklace");
    expect(categories).toContain("Grail");
    expect(categories).toContain("Parchment");
    expect(categories).toContain("Compass");
    expect(categories).toContain("Bell");
    expect(categories).toContain("Mirror");
    expect(categories).toContain("Scales");
  });

  it("includes Rune slot in equipment", () => {
    const player = makeFullPlayer("RuneTest", 1001);
    const build = extractBuild(player, itemDetailsMap, [], 400, 10000);
    const categories = build.equipItems.map((e) => e.categoryName);
    expect(categories).toContain("Rune");
    const rune = build.equipItems.find((e) => e.categoryName === "Rune");
    expect(rune.itemName).toBe("Clash Rune of Valor");
  });
});

// ─── Race and Rune filtering pipeline tests ──────────────────────────────────

describe("Race and Rune filtering in build pipeline", () => {
  it("extracts race correctly from Elyos serverId", () => {
    const player = makeFullPlayer("ElyosPlayer", 1005);
    const build = extractBuild(player, itemDetailsMap, [], 400, 10000);
    expect(build.race).toBe("Elyos");
  });

  it("extracts race correctly from Asmodian serverId", () => {
    const player = makeFullPlayer("AsmoPlayer", 2010);
    const build = extractBuild(player, itemDetailsMap, [], 400, 10000);
    expect(build.race).toBe("Asmo");
  });

  it("extracts Clash rune (PvE) into build equipItems", () => {
    const player = makeFullPlayer("PvePlayer", 1001, {
      runeName: "Ancient Clash Rune",
    });
    const build = extractBuild(player, itemDetailsMap, [], 400, 10000);
    const rune = build.equipItems.find((e) => e.categoryName === "Rune");
    expect(rune).toBeDefined();
    expect(rune.itemName).toBe("Ancient Clash Rune");
  });

  it("extracts Devotion rune (PvP) into build equipItems", () => {
    const player = makeFullPlayer("PvpPlayer", 2001, {
      runeName: "Grand Devotion Rune",
    });
    const build = extractBuild(player, itemDetailsMap, [], 400, 10000);
    const rune = build.equipItems.find((e) => e.categoryName === "Rune");
    expect(rune).toBeDefined();
    expect(rune.itemName).toBe("Grand Devotion Rune");
  });

  it("aggregates mixed race players and preserves race data", () => {
    const players = [
      makeFullPlayer("Elyos1", 1001, { rank: 1 }),
      makeFullPlayer("Elyos2", 1015, { rank: 2 }),
      makeFullPlayer("Asmo1", 2001, { rank: 3, runeName: "Devotion Rune" }),
      makeFullPlayer("Asmo2", 2010, { rank: 4, runeName: "Devotion Rune" }),
    ];
    const builds = players.map((p) => extractBuild(p, itemDetailsMap, [], 400, 10000));
    const stats = aggregate(builds);
    expect(stats.total).toBe(4);

    const elyos = stats.scannedPlayers.filter((p) => p.race === "Elyos");
    const asmo = stats.scannedPlayers.filter((p) => p.race === "Asmo");
    expect(elyos).toHaveLength(2);
    expect(asmo).toHaveLength(2);
  });

  it("can filter builds by rune type before aggregation", () => {
    const players = [
      makeFullPlayer("PvE1", 1001, { rank: 1, runeName: "Clash Rune" }),
      makeFullPlayer("PvP1", 1002, { rank: 2, runeName: "Devotion Rune" }),
      makeFullPlayer("PvE2", 1003, { rank: 3, runeName: "Ancient Clash Rune" }),
    ];
    const builds = players.map((p) => extractBuild(p, itemDetailsMap, [], 400, 10000));

    // Filter PvE builds (Clash)
    const pveBuilds = builds.filter((b) => {
      const rune = (b.equipItems || []).find((e) => e.categoryName === "Rune");
      return rune && rune.itemName.toLowerCase().includes("clash");
    });
    expect(pveBuilds).toHaveLength(2);

    const pveStats = aggregate(pveBuilds);
    expect(pveStats.total).toBe(2);

    // Filter PvP builds (Devotion)
    const pvpBuilds = builds.filter((b) => {
      const rune = (b.equipItems || []).find((e) => e.categoryName === "Rune");
      return rune && rune.itemName.toLowerCase().includes("devotion");
    });
    expect(pvpBuilds).toHaveLength(1);

    const pvpStats = aggregate(pvpBuilds);
    expect(pvpStats.total).toBe(1);
  });
});
