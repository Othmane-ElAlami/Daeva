// ─────────────────────────────────────────────────────────────────────────────
// Tests for src/lib/scraper-shared.js
// Covers: constants, headers, budget, fetchWithRetry, runPool,
//         extractItemLevelFromInfo, extractCombatPowerFromInfo,
//         extractBuild, aggregate, proxyUrl, sleep
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  baseUrl,
  leaderboardTypes,
  classRankingIds,
  classes,
  serverNames,
  makeHeaders,
  makeDirectHeaders,
  sleep,
  proxyUrl,
  subrequestHardLimit,
  subrequestSafetyMargin,
  subrequestBudgetExhausted,
  createBudget,
  fetchJSON,
  fetchWithRetry,
  runPool,
  extractItemLevelFromInfo,
  extractCombatPowerFromInfo,
  extractBuild,
  aggregate,
} from "../../src/lib/scraper-shared.js";

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("Constants", () => {
  it("baseUrl is shugo.gg", () => {
    expect(baseUrl).toBe("https://shugo.gg");
  });

  it("leaderboardTypes has all 7 types with correct contentType values", () => {
    const expected = {
      nightmare: 3,
      abyss: 1,
      "arena-solo": 5,
      "arena-coop": 6,
      transcendence: 4,
      ascension: 21,
      raid: 20,
    };
    expect(Object.keys(leaderboardTypes)).toHaveLength(7);
    for (const [key, ct] of Object.entries(expected)) {
      expect(leaderboardTypes[key]).toBeDefined();
      expect(leaderboardTypes[key].contentType).toBe(ct);
      expect(typeof leaderboardTypes[key].label).toBe("string");
      expect(leaderboardTypes[key].label.length).toBeGreaterThan(0);
    }
  });

  it("classRankingIds has all 8 classes with correct IDs (2-9)", () => {
    const expectedClasses = [
      "gladiator",
      "templar",
      "ranger",
      "assassin",
      "spiritmaster",
      "sorcerer",
      "cleric",
      "chanter",
    ];
    expect(Object.keys(classRankingIds)).toHaveLength(8);
    for (const cls of expectedClasses) {
      expect(classRankingIds[cls]).toBeDefined();
      expect(classRankingIds[cls]).toBeGreaterThanOrEqual(2);
      expect(classRankingIds[cls]).toBeLessThanOrEqual(9);
    }
    // Verify no duplicate IDs
    const ids = Object.values(classRankingIds);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("classes array matches classRankingIds keys", () => {
    expect(classes).toEqual(Object.keys(classRankingIds));
  });

  it("serverNames has 42 servers (21 Elyos + 21 Asmodian)", () => {
    const keys = Object.keys(serverNames).map(Number);
    expect(keys).toHaveLength(42);

    const elyos = keys.filter((k) => k >= 1001 && k <= 1021);
    const asmodian = keys.filter((k) => k >= 2001 && k <= 2021);
    expect(elyos).toHaveLength(21);
    expect(asmodian).toHaveLength(21);

    // Spot-check specific servers
    expect(serverNames[1001]).toBe("Siel");
    expect(serverNames[2001]).toBe("Israphel");
    expect(serverNames[1021]).toBe("Poeta");
    expect(serverNames[2021]).toBe("Pandemonium");
  });

  it("all server names are non-empty strings", () => {
    for (const [id, name] of Object.entries(serverNames)) {
      expect(typeof name).toBe("string");
      expect(name.length).toBeGreaterThan(0);
    }
  });

  it("subrequest budget constants are reasonable", () => {
    expect(subrequestHardLimit).toBe(1000);
    expect(subrequestSafetyMargin).toBe(30);
    expect(subrequestHardLimit - subrequestSafetyMargin).toBe(970);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// HEADER GENERATION
// ═══════════════════════════════════════════════════════════════════════════════

describe("makeHeaders", () => {
  it("returns correct headers with referer", () => {
    const h = makeHeaders("https://example.com/page");
    expect(h["User-Agent"]).toContain("Mozilla/5.0");
    expect(h["Accept"]).toContain("application/json");
    expect(h["Accept-Language"]).toBe("en-US,en;q=0.9");
    expect(h["Referer"]).toBe("https://example.com/page");
    expect(h["Origin"]).toBe(baseUrl);
  });

  it("referer matches the passed argument exactly", () => {
    const ref = `${baseUrl}/leaderboard/nightmare?class=chanter`;
    const h = makeHeaders(ref);
    expect(h["Referer"]).toBe(ref);
  });
});

describe("makeDirectHeaders", () => {
  it("returns headers WITHOUT Origin and Referer", () => {
    const h = makeDirectHeaders();
    expect(h["User-Agent"]).toContain("Mozilla/5.0");
    expect(h["Accept"]).toContain("application/json");
    expect(h["Accept-Language"]).toBe("en-US,en;q=0.9");
    expect(h["Referer"]).toBeUndefined();
    expect(h["Origin"]).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

describe("proxyUrl", () => {
  it("wraps an API path through the proxy endpoint", () => {
    const result = proxyUrl("https://aion2.plaync.com/api/character/info");
    expect(result).toBe(
      `${baseUrl}/api/proxy?url=${encodeURIComponent("https://aion2.plaync.com/api/character/info")}`
    );
  });

  it("handles special characters in the path", () => {
    const url = "https://example.com/api?foo=1&bar=hello world";
    const result = proxyUrl(url);
    expect(result).toContain(encodeURIComponent(url));
    expect(result.startsWith(`${baseUrl}/api/proxy?url=`)).toBe(true);
  });
});

describe("sleep", () => {
  it("resolves after the specified delay", async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40); // allow some margin
  });

  it("returns a promise", () => {
    const result = sleep(1);
    expect(result).toBeInstanceOf(Promise);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUBREQUEST BUDGET
// ═══════════════════════════════════════════════════════════════════════════════

describe("subrequestBudgetExhausted", () => {
  it("is an Error subclass", () => {
    const err = new subrequestBudgetExhausted(500);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(subrequestBudgetExhausted);
    expect(err.name).toBe("SubrequestBudgetExhausted");
    expect(err.message).toContain("500");
    expect(err.message).toContain(String(subrequestHardLimit));
  });
});

describe("createBudget", () => {
  it("starts with 0 used and full remaining", () => {
    const b = createBudget();
    expect(b.used).toBe(0);
    expect(b.remaining).toBe(subrequestHardLimit - subrequestSafetyMargin);
  });

  it("consume increments used count", () => {
    const b = createBudget();
    b.consume(5);
    expect(b.used).toBe(5);
    expect(b.remaining).toBe(subrequestHardLimit - subrequestSafetyMargin - 5);
  });

  it("consume(1) is the default", () => {
    const b = createBudget();
    b.consume();
    expect(b.used).toBe(1);
  });

  it("throws subrequestBudgetExhausted when budget is exceeded", () => {
    const b = createBudget();
    expect(() => b.consume(970)).toThrow(subrequestBudgetExhausted);
  });

  it("canAfford returns true when budget allows", () => {
    const b = createBudget();
    expect(b.canAfford(1)).toBe(true);
    expect(b.canAfford(969)).toBe(true);
    expect(b.canAfford(970)).toBe(false);
  });

  it("canAfford returns false after exhaust()", () => {
    const b = createBudget();
    expect(b.canAfford(1)).toBe(true);
    b.exhaust();
    expect(b.canAfford(1)).toBe(false);
    expect(b.remaining).toBe(0);
  });

  it("consume throws after exhaust()", () => {
    const b = createBudget();
    b.exhaust();
    expect(() => b.consume(1)).toThrow(subrequestBudgetExhausted);
  });

  it("tracks budget across multiple consume calls", () => {
    const b = createBudget();
    b.consume(100);
    b.consume(200);
    b.consume(300);
    expect(b.used).toBe(600);
    expect(b.canAfford(369)).toBe(true);
    expect(b.canAfford(370)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FETCH JSON
// ═══════════════════════════════════════════════════════════════════════════════

describe("fetchJSON", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("makes a GET request and returns parsed JSON", async () => {
    const mockData = { rankings: [{ id: 1 }] };
    fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    });

    const result = await fetchJSON(
      "https://example.com/api",
      { Accept: "application/json" },
      "GET"
    );
    expect(result).toEqual(mockData);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("makes a POST request with JSON body", async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });

    const body = { itemIds: [1, 2, 3] };
    await fetchJSON("https://example.com/api", { Accept: "application/json" }, "POST", body);

    const [, callOpts] = fetch.mock.calls[0];
    expect(callOpts.method).toBe("POST");
    expect(callOpts.body).toBe(JSON.stringify(body));
    expect(callOpts.headers["Content-Type"]).toBe("application/json");
  });

  it("throws on non-ok response", async () => {
    fetch.mockResolvedValue({ ok: false, status: 404 });
    await expect(fetchJSON("https://example.com/api", {})).rejects.toThrow("HTTP 404");
  });

  it("consumes budget when budget is provided", async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    const budget = createBudget();
    await fetchJSON("https://example.com/api", {}, "GET", null, budget);
    expect(budget.used).toBe(1);
  });

  it("logs on failure when logger is provided", async () => {
    fetch.mockResolvedValue({ ok: false, status: 500 });
    const logger = { error: vi.fn(), success: vi.fn() };

    await expect(
      fetchJSON("https://example.com/api", {}, "GET", null, null, logger)
    ).rejects.toThrow("HTTP 500");

    expect(logger.error).toHaveBeenCalled();
  });

  it("logs on success when logger is provided", async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });
    const logger = { error: vi.fn(), success: vi.fn() };

    await fetchJSON("https://example.com/api", {}, "GET", null, null, logger);

    expect(logger.success).toHaveBeenCalled();
  });

  it("detects subrequest limit errors from fetch failures", async () => {
    const budget = createBudget();
    fetch.mockRejectedValue(new Error("Too many subrequests"));

    await expect(fetchJSON("https://example.com/api", {}, "GET", null, budget)).rejects.toThrow(
      subrequestBudgetExhausted
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// FETCH WITH RETRY
// ═══════════════════════════════════════════════════════════════════════════════

describe("fetchWithRetry", () => {
  it("returns on first success", async () => {
    const fn = vi.fn().mockResolvedValue({ data: 42 });
    const result = await fetchWithRetry(fn, 3, 10);
    expect(result).toEqual({ data: 42 });
    expect(fn).toHaveBeenCalledOnce();
  });

  it("retries on failure and succeeds on second attempt", async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error("fail")).mockResolvedValueOnce({ ok: true });

    const result = await fetchWithRetry(fn, 3, 10);
    expect(result).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws after all retries exhausted", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("persistent failure"));

    await expect(fetchWithRetry(fn, 2, 10)).rejects.toThrow("persistent failure");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("never retries subrequestBudgetExhausted", async () => {
    const fn = vi.fn().mockRejectedValue(new subrequestBudgetExhausted(500));

    await expect(fetchWithRetry(fn, 5, 10)).rejects.toThrow(subrequestBudgetExhausted);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("does not retry when budget is exhausted", async () => {
    const budget = createBudget();
    budget.exhaust();
    const fn = vi.fn();

    await expect(fetchWithRetry(fn, 3, 10, budget)).rejects.toThrow(subrequestBudgetExhausted);
    expect(fn).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// RUN POOL
// ═══════════════════════════════════════════════════════════════════════════════

describe("runPool", () => {
  it("runs all tasks and returns results in order", async () => {
    const tasks = [
      () => Promise.resolve("a"),
      () => Promise.resolve("b"),
      () => Promise.resolve("c"),
    ];
    const results = await runPool(tasks, 2);
    expect(results).toEqual(["a", "b", "c"]);
  });

  it("handles empty task list", async () => {
    const results = await runPool([], 5);
    expect(results).toEqual([]);
  });

  it("returns null for failed tasks", async () => {
    const tasks = [
      () => Promise.resolve("ok"),
      () => Promise.reject(new Error("fail")),
      () => Promise.resolve("ok2"),
    ];
    const results = await runPool(tasks, 3);
    expect(results[0]).toBe("ok");
    expect(results[1]).toBeNull();
    expect(results[2]).toBe("ok2");
  });

  it("stops early when budget is exhausted", async () => {
    const budget = createBudget();
    let executed = 0;
    const tasks = Array.from({ length: 100 }, () => async () => {
      executed++;
      budget.consume(50);
      return "done";
    });

    const results = await runPool(tasks, 5, budget);
    // Should stop well before 100 tasks since budget gets consumed
    expect(executed).toBeLessThan(100);
  });

  it("stops on subrequestBudgetExhausted errors", async () => {
    const budget = createBudget();
    let count = 0;
    const tasks = Array.from({ length: 10 }, (_, i) => async () => {
      count++;
      if (i === 2) throw new subrequestBudgetExhausted(500);
      return i;
    });

    await runPool(tasks, 1, budget);
    // With concurrency 1, should stop at task 2
    expect(count).toBeLessThanOrEqual(3);
  });

  it("respects concurrency limit", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    const tasks = Array.from({ length: 10 }, () => async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await sleep(20);
      concurrent--;
      return "done";
    });

    await runPool(tasks, 3);
    expect(maxConcurrent).toBeLessThanOrEqual(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ITEM LEVEL EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════════

describe("extractItemLevelFromInfo", () => {
  it("extracts itemlevel from stat.statList", () => {
    const data = {
      stat: {
        statList: [
          { type: "ItemLevel", value: 385 },
          { type: "Attack", value: 1234 },
        ],
      },
    };
    expect(extractItemLevelFromInfo(data)).toBe(385);
  });

  it("extracts from stat.statSecondList", () => {
    const data = {
      stat: {
        statList: [],
        statSecondList: [{ type: "itemlevel", value: 400 }],
      },
    };
    expect(extractItemLevelFromInfo(data)).toBe(400);
  });

  it("extracts from stat.statListThird", () => {
    const data = {
      stat: {
        statList: [],
        statSecondList: [],
        statListThird: [{ type: "ITEMLEVEL", value: 420 }],
      },
    };
    expect(extractItemLevelFromInfo(data)).toBe(420);
  });

  it("extracts from profile.stat.statList", () => {
    const data = {
      profile: {
        stat: {
          statList: [{ type: "ItemLevel", value: 380 }],
        },
      },
    };
    expect(extractItemLevelFromInfo(data)).toBe(380);
  });

  it("extracts from top-level statList", () => {
    const data = {
      statList: [{ type: "GearScore", value: 410 }],
    };
    expect(extractItemLevelFromInfo(data)).toBe(410);
  });

  it("recognizes alternate stat names: gearscore, ilvl", () => {
    expect(
      extractItemLevelFromInfo({
        stat: { statList: [{ type: "GearScore", value: 300 }] },
      })
    ).toBe(300);

    expect(
      extractItemLevelFromInfo({
        stat: { statList: [{ type: "ilvl", value: 350 }] },
      })
    ).toBe(350);
  });

  it("returns null for missing data", () => {
    expect(extractItemLevelFromInfo(null)).toBeNull();
    expect(extractItemLevelFromInfo(undefined)).toBeNull();
    expect(extractItemLevelFromInfo({})).toBeNull();
    expect(extractItemLevelFromInfo({ stat: {} })).toBeNull();
    expect(extractItemLevelFromInfo({ stat: { statList: [] } })).toBeNull();
  });

  it("returns null for zero or negative values", () => {
    expect(
      extractItemLevelFromInfo({
        stat: { statList: [{ type: "ItemLevel", value: 0 }] },
      })
    ).toBeNull();
    expect(
      extractItemLevelFromInfo({
        stat: { statList: [{ type: "ItemLevel", value: -5 }] },
      })
    ).toBeNull();
  });

  it("returns null for NaN values", () => {
    expect(
      extractItemLevelFromInfo({
        stat: { statList: [{ type: "ItemLevel", value: "abc" }] },
      })
    ).toBeNull();
  });

  it("is case-insensitive for stat type names", () => {
    expect(
      extractItemLevelFromInfo({
        stat: { statList: [{ type: "ITEMLEVEL", value: 450 }] },
      })
    ).toBe(450);
    expect(
      extractItemLevelFromInfo({
        stat: { statList: [{ type: "itemLevel", value: 450 }] },
      })
    ).toBe(450);
  });
});

describe("extractCombatPowerFromInfo", () => {
  it("extracts combatPower from profile", () => {
    expect(extractCombatPowerFromInfo({ profile: { combatPower: 12345 } })).toBe(12345);
  });

  it("returns null when profile is missing", () => {
    expect(extractCombatPowerFromInfo({})).toBeNull();
    expect(extractCombatPowerFromInfo(null)).toBeNull();
    expect(extractCombatPowerFromInfo(undefined)).toBeNull();
  });

  it("returns null when combatPower is missing", () => {
    expect(extractCombatPowerFromInfo({ profile: {} })).toBeNull();
  });

  it("returns 0 when combatPower is 0 (not null)", () => {
    expect(extractCombatPowerFromInfo({ profile: { combatPower: 0 } })).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BUILD EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════════

describe("extractBuild", () => {
  function makePlayer(overrides = {}) {
    return {
      characterName: "TestPlayer",
      serverId: 1001,
      region: "KR",
      faction: "TestFaction",
      globalRank: 1,
      _equip: {
        skill: {
          skillList: [
            {
              name: "Smash",
              category: "Active",
              skillLevel: 5,
              equip: true,
            },
            {
              name: "Shield Bash",
              category: "Dp",
              skillLevel: 3,
              equip: true,
            },
            {
              name: "Critical Mastery",
              category: "Passive",
              skillLevel: 2,
              equip: false,
            },
          ],
        },
        equipment: {
          equipmentList: [
            {
              id: "item1",
              name: "Sword of Light",
              slotPos: 1,
              slotPosName: "MainHand1",
              grade: 5,
              enchantLevel: 10,
            },
            {
              id: "item2",
              name: "Shield of Dawn",
              slotPos: 2,
              slotPosName: "SubHand1",
              grade: 4,
            },
            {
              id: "arc1",
              name: "Blood Card",
              slotPos: 10,
              slotPosName: "Arcana1",
              grade: 5,
              enchantLevel: 3,
            },
            {
              id: "arc2",
              name: "Vigor Card",
              slotPos: 11,
              slotPosName: "Arcana2",
              grade: 4,
              enchantLevel: 2,
            },
          ],
        },
        profile: { factionName: "Elyos" },
      },
      ...overrides,
    };
  }

  it("extracts player name and server info", () => {
    const build = extractBuild(makePlayer(), {}, [], 400, 5000);
    expect(build.name).toBe("TestPlayer");
    expect(build.serverId).toBe(1001);
    expect(build.serverName).toBe("Siel");
    expect(build.region).toBe("KR");
  });

  it("determines race from serverId range", () => {
    expect(extractBuild(makePlayer({ serverId: 1001 }), {}, []).race).toBe("Elyos");
    expect(extractBuild(makePlayer({ serverId: 2001 }), {}, []).race).toBe("Asmo");
    expect(extractBuild(makePlayer({ serverId: 500 }), {}, []).race).toBe("Unknown");
  });

  it("extracts active skills (equipped or leveled)", () => {
    const build = extractBuild(makePlayer(), {}, []);
    expect(build.activeSkills).toHaveLength(1);
    expect(build.activeSkills[0].name).toBe("Smash");
    expect(build.activeSkills[0].level).toBe(5);
    expect(build.activeSkills[0].equipped).toBe(true);
  });

  it("extracts stigma (Dp) skills", () => {
    const build = extractBuild(makePlayer(), {}, []);
    expect(build.stigmaSkills).toHaveLength(1);
    expect(build.stigmaSkills[0].name).toBe("Shield Bash");
  });

  it("extracts passive skills", () => {
    const build = extractBuild(makePlayer(), {}, []);
    expect(build.passiveSkills).toHaveLength(1);
    expect(build.passiveSkills[0].name).toBe("Critical Mastery");
  });

  it("skips unequipped active skills with no level", () => {
    const player = makePlayer();
    player._equip.skill.skillList.push({
      name: "Unused Skill",
      category: "Active",
      skillLevel: 0,
      equip: false,
    });
    const build = extractBuild(player, {}, []);
    expect(build.activeSkills.find((s) => s.name === "Unused Skill")).toBeUndefined();
  });

  it("maps equipment slots correctly", () => {
    const build = extractBuild(makePlayer(), {}, []);
    const mainHand = build.equipItems.find((e) => e.categoryName === "Main Hand");
    const guard = build.equipItems.find((e) => e.categoryName === "Guard");
    expect(mainHand).toBeDefined();
    expect(mainHand.itemName).toBe("Sword of Light");
    expect(guard).toBeDefined();
    expect(guard.itemName).toBe("Shield of Dawn");
  });

  it("maps all slot types correctly", () => {
    const slots = [
      ["Torso", "Top"],
      ["Pants", "Legs"],
      ["Helmet", "Helm"],
      ["Shoulder", "Pauldrons"],
      ["Gloves", "Gloves"],
      ["Boots", "Shoes"],
      ["Cape", "Cloak"],
      ["Belt", "Belt"],
      ["Necklace", "Necklace"],
      ["Amulet", "Amulet"],
      ["Earring1", "Earrings"],
      ["Ring2", "Ring"],
      ["Bracelet1", "Bracelet"],
      ["Rune1", "Rune"],
    ];

    for (const [slotPosName, expectedCategory] of slots) {
      const player = makePlayer();
      player._equip.equipment.equipmentList = [
        {
          id: "x",
          name: "Test Item",
          slotPos: 99,
          slotPosName,
          grade: 3,
        },
      ];
      const build = extractBuild(player, {}, []);
      expect(build.equipItems[0].categoryName).toBe(expectedCategory);
    }
  });

  it("maps arcana slots to correct names (Grail, Parchment, etc.)", () => {
    const arcanaSlots = {
      Arcana1: "Grail",
      Arcana2: "Parchment",
      Arcana3: "Compass",
      Arcana4: "Bell",
      Arcana5: "Mirror",
      Arcana6: "Scales",
    };

    for (const [slotPosName, expectedCategory] of Object.entries(arcanaSlots)) {
      const player = makePlayer();
      player._equip.equipment.equipmentList = [
        {
          id: "x",
          name: "Test Arcana",
          slotPos: 99,
          slotPosName,
          grade: 3,
        },
      ];
      const build = extractBuild(player, {}, []);
      expect(build.equipItems[0].categoryName).toBe(expectedCategory);
    }
  });

  it("sets gearScore and combatPower from parameters", () => {
    const build = extractBuild(makePlayer(), {}, [], 385, 12000);
    expect(build.gearScore).toBe(385);
    expect(build.combatPower).toBe(12000);
  });

  it("handles null itemLevel and cp", () => {
    const build = extractBuild(makePlayer(), {}, [], null, null);
    expect(build.gearScore).toBeNull();
    expect(build.combatPower).toBeNull();
  });

  it("extracts arcana details from itemDetailsMap", () => {
    const itemDetailsMap = {
      arc1: {
        mainStats: [{ name: "Attack", value: "+100" }],
        set: {
          name: "Pure Blood",
          bonuses: [
            { degree: 2, descriptions: ["+5% Attack"] },
            { degree: 4, descriptions: ["+10% Attack"] },
          ],
        },
      },
      arc2: {
        mainStats: [{ name: "Defense", value: "+50" }],
        set: {
          name: "Primal Vigor",
          bonuses: [{ degree: 2, descriptions: ["+5% HP"] }],
        },
      },
    };

    const build = extractBuild(makePlayer(), itemDetailsMap, []);
    expect(build.arcanas).toHaveLength(2);
    expect(build.arcanas[0].mainStat).toBe("Attack: +100");
    expect(build.arcanas[0].setName).toBe("Pure Blood");
    expect(build.arcanas[1].setName).toBe("Primal Vigor");

    expect(build.arcanaSets).toHaveLength(2);
    // Both sets have count 1, so sorted alphabetically: Primal Vigor before Pure Blood
    expect(build.arcanaSetCombo).toBe("Primal Vigor(1) + Pure Blood(1)");
  });

  it("builds arcanaSetCombo string correctly", () => {
    const player = makePlayer();
    player._equip.equipment.equipmentList = [
      { id: "a1", name: "C1", slotPos: 10, slotPosName: "Arcana1", grade: 5 },
      { id: "a2", name: "C2", slotPos: 11, slotPosName: "Arcana2", grade: 5 },
      { id: "a3", name: "C3", slotPos: 12, slotPosName: "Arcana3", grade: 5 },
      { id: "a4", name: "C4", slotPos: 13, slotPosName: "Arcana4", grade: 5 },
    ];

    const details = {
      a1: { set: { name: "Pure Blood", bonuses: [] } },
      a2: { set: { name: "Pure Blood", bonuses: [] } },
      a3: { set: { name: "Pure Blood", bonuses: [] } },
      a4: { set: { name: "Primal Vigor", bonuses: [] } },
    };

    const build = extractBuild(player, details, []);
    expect(build.arcanaSetCombo).toBe("Pure Blood(3) + Primal Vigor(1)");
  });

  it("returns 'None' arcanaSetCombo when no arcana sets", () => {
    const player = makePlayer();
    player._equip.equipment.equipmentList = [];
    const build = extractBuild(player, {}, []);
    expect(build.arcanaSetCombo).toBe("None");
  });

  it("extracts equipment substats from equipDetailsList", () => {
    const equipDetails = [
      {
        categoryName: "Top",
        slotPos: 3,
        subStats: [
          { name: "Attack", value: "+100" },
          { name: "HP", value: "+500" },
        ],
        subSkills: [{ name: "Crit Rate", level: 3 }],
      },
    ];

    const build = extractBuild(makePlayer(), {}, equipDetails);
    expect(build.equipSubStats).toHaveLength(1);
    expect(build.equipSubStats[0].categoryName).toBe("Top");
    expect(build.equipSubStats[0].subStats).toHaveLength(3);
    expect(build.equipSubStats[0].subStats[2].value).toBe("+3");
  });

  it("handles player with missing _equip gracefully", () => {
    const player = { characterName: "NoGear", serverId: 1001, region: "KR" };
    const build = extractBuild(player, {}, []);
    expect(build.name).toBe("NoGear");
    expect(build.activeSkills).toEqual([]);
    expect(build.equipItems).toEqual([]);
    expect(build.arcanaSetCombo).toBe("None");
  });

  it("handles null items in equipmentList", () => {
    const player = makePlayer();
    player._equip.equipment.equipmentList = [
      null,
      {
        id: "x",
        name: "Valid",
        slotPos: 1,
        slotPosName: "Torso",
        grade: 3,
      },
      null,
    ];
    const build = extractBuild(player, {}, []);
    expect(build.equipItems).toHaveLength(1);
    expect(build.equipItems[0].itemName).toBe("Valid");
  });

  it("uses player.faction, falls back to equip.profile fields", () => {
    // With explicit faction
    expect(extractBuild(makePlayer({ faction: "MyFaction" }), {}, []).faction).toBe("MyFaction");

    // Fallback to profile.factionName
    const p2 = makePlayer({ faction: undefined });
    p2._equip.profile = { factionName: "ProfileFaction" };
    expect(extractBuild(p2, {}, []).faction).toBe("ProfileFaction");

    // Fallback to profile.raceName
    const p3 = makePlayer({ faction: undefined });
    p3._equip.profile = { raceName: "RaceFaction" };
    expect(extractBuild(p3, {}, []).faction).toBe("RaceFaction");
  });

  it("handles unknown serverId for serverName", () => {
    const build = extractBuild(makePlayer({ serverId: 9999 }), {}, []);
    expect(build.serverName).toBe("Server 9999");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AGGREGATE
// ═══════════════════════════════════════════════════════════════════════════════

describe("aggregate", () => {
  function makeBuild(overrides = {}) {
    return {
      name: "Player1",
      serverId: 1001,
      serverName: "Siel",
      race: "Elyos",
      region: "KR",
      faction: "Elyos",
      globalRank: 1,
      gearScore: 400,
      combatPower: 10000,
      activeSkills: [
        { name: "Smash", level: 5, equipped: true },
        { name: "Strike", level: 3, equipped: false },
      ],
      stigmaSkills: [
        { name: "Shield Bash", level: 4, equipped: true },
        { name: "Barrier", level: 2, equipped: true },
      ],
      passiveSkills: [{ name: "Crit Mastery", level: 3, equipped: false }],
      arcanas: [
        {
          name: "Blood Card",
          slot: "Arcana1",
          mainStat: "Attack: +100",
          setName: "Pure Blood",
        },
      ],
      arcanaSets: [{ name: "Pure Blood", bonuses: ["(2-piece) +5% Attack"] }],
      arcanaSetCombo: "Pure Blood(1)",
      equipSubStats: [
        {
          categoryName: "Top",
          subStats: [
            { name: "Attack", value: "+100" },
            { name: "HP", value: "+500" },
          ],
        },
      ],
      equipItems: [{ categoryName: "Top", itemName: "Epic Torso", grade: 5 }],
      ...overrides,
    };
  }

  it("returns correct total count", () => {
    const builds = [makeBuild(), makeBuild({ name: "Player2" })];
    const stats = aggregate(builds);
    expect(stats.total).toBe(2);
  });

  it("aggregates active skills with avgLv, maxLv, equippedCount", () => {
    const builds = [
      makeBuild({
        activeSkills: [{ name: "Smash", level: 5, equipped: true }],
      }),
      makeBuild({
        activeSkills: [{ name: "Smash", level: 3, equipped: false }],
      }),
    ];
    const stats = aggregate(builds);
    const smash = stats.activeSkills["Smash"];
    expect(smash).toBeDefined();
    expect(smash.count).toBe(2);
    expect(smash.avgLv).toBe(4.0);
    expect(smash.maxLv).toBe(5);
    expect(smash.equippedCount).toBe(1);
  });

  it("aggregates stigma skills", () => {
    const builds = [
      makeBuild({
        stigmaSkills: [{ name: "Shield Bash", level: 4, equipped: true }],
      }),
      makeBuild({
        stigmaSkills: [{ name: "Shield Bash", level: 6, equipped: true }],
      }),
    ];
    const stats = aggregate(builds);
    const sb = stats.stigmaSkills["Shield Bash"];
    expect(sb.count).toBe(2);
    expect(sb.avgLv).toBe(5.0);
    expect(sb.maxLv).toBe(6);
    expect(sb.equippedCount).toBe(2);
  });

  it("aggregates passive skills (no equippedCount)", () => {
    const builds = [
      makeBuild({
        passiveSkills: [{ name: "Crit Mastery", level: 2 }],
      }),
      makeBuild({
        passiveSkills: [{ name: "Crit Mastery", level: 4 }],
      }),
    ];
    const stats = aggregate(builds);
    const cm = stats.passiveSkills["Crit Mastery"];
    expect(cm.count).toBe(2);
    expect(cm.avgLv).toBe(3.0);
    expect(cm.maxLv).toBe(4);
    expect(cm.equippedCount).toBeUndefined();
  });

  it("aggregates arcana usage", () => {
    const builds = [
      makeBuild({
        arcanas: [
          { name: "Blood Card", mainStat: "Attack: +100" },
          { name: "Blood Card", mainStat: "Attack: +100" },
        ],
      }),
      makeBuild({
        arcanas: [{ name: "Vigor Card", mainStat: "HP: +200" }],
      }),
    ];
    const stats = aggregate(builds);
    expect(stats.arcanaUsage["Blood Card"]).toBe(2);
    expect(stats.arcanaUsage["Vigor Card"]).toBe(1);
    expect(stats.arcanaMainStats["Attack: +100"]).toBe(2);
    expect(stats.arcanaMainStats["HP: +200"]).toBe(1);
  });

  it("aggregates arcana set combos", () => {
    const builds = [
      makeBuild({ arcanaSetCombo: "Pure Blood(4) + Primal Vigor(2)" }),
      makeBuild({ arcanaSetCombo: "Pure Blood(4) + Primal Vigor(2)" }),
      makeBuild({ arcanaSetCombo: "Pure Blood(6)" }),
    ];
    const stats = aggregate(builds);
    expect(stats.arcanaSetCombos["Pure Blood(4) + Primal Vigor(2)"]).toBe(2);
    expect(stats.arcanaSetCombos["Pure Blood(6)"]).toBe(1);
  });

  it("tracks equipped stigma combos (top 5 by level)", () => {
    const builds = [
      makeBuild({
        stigmaSkills: [
          { name: "A", level: 5, equipped: true },
          { name: "B", level: 4, equipped: true },
          { name: "C", level: 3, equipped: true },
        ],
      }),
      makeBuild({
        stigmaSkills: [
          { name: "A", level: 5, equipped: true },
          { name: "B", level: 4, equipped: true },
          { name: "C", level: 3, equipped: true },
        ],
      }),
    ];
    const stats = aggregate(builds);
    const combo = "A + B + C";
    expect(stats.equippedStigmaCombos[combo]).toBe(2);
  });

  it("aggregates substats by slot", () => {
    const builds = [
      makeBuild({
        equipSubStats: [
          {
            categoryName: "Top",
            subStats: [
              { name: "Attack", value: "+100" },
              { name: "HP", value: "+500" },
            ],
          },
        ],
      }),
      makeBuild({
        equipSubStats: [
          {
            categoryName: "Top",
            subStats: [{ name: "Attack", value: "+150" }],
          },
        ],
      }),
    ];
    const stats = aggregate(builds);
    expect(stats.subStatsBySlot["Top"]["Attack"].count).toBe(2);
    expect(stats.subStatsBySlot["Top"]["Attack"].values).toEqual(["+100", "+150"]);
    expect(stats.subStatsBySlot["Top"]["HP"].count).toBe(1);
  });

  it("aggregates items by slot", () => {
    const builds = [
      makeBuild({
        equipItems: [{ categoryName: "Top", itemName: "Sword A", grade: 5 }],
      }),
      makeBuild({
        equipItems: [{ categoryName: "Top", itemName: "Sword A", grade: 5 }],
      }),
      makeBuild({
        equipItems: [{ categoryName: "Top", itemName: "Sword B", grade: 4 }],
      }),
    ];
    const stats = aggregate(builds);
    expect(stats.itemsBySlot["Top"]["Sword A"].count).toBe(2);
    expect(stats.itemsBySlot["Top"]["Sword B"].count).toBe(1);
  });

  it("tracks scanned players metadata", () => {
    const builds = [
      makeBuild({ name: "P1", gearScore: 400, combatPower: 5000 }),
      makeBuild({ name: "P2", gearScore: 420, combatPower: 6000 }),
    ];
    const stats = aggregate(builds);
    expect(stats.scannedPlayers).toHaveLength(2);
    expect(stats.scannedPlayers[0].name).toBe("P1");
    expect(stats.scannedPlayers[0].gearScore).toBe(400);
    expect(stats.scannedPlayers[1].combatPower).toBe(6000);
  });

  it("handles empty builds array", () => {
    const stats = aggregate([]);
    expect(stats.total).toBe(0);
    expect(stats.scannedPlayers).toEqual([]);
    expect(Object.keys(stats.activeSkills)).toHaveLength(0);
  });

  it("computes avgLv correctly for single player", () => {
    const builds = [
      makeBuild({
        activeSkills: [{ name: "Smash", level: 7, equipped: true }],
        stigmaSkills: [],
        passiveSkills: [],
      }),
    ];
    const stats = aggregate(builds);
    expect(stats.activeSkills["Smash"].avgLv).toBe(7.0);
  });

  it("rounds avgLv to 1 decimal place", () => {
    const builds = [
      makeBuild({
        activeSkills: [{ name: "Smash", level: 5, equipped: true }],
        stigmaSkills: [],
        passiveSkills: [],
      }),
      makeBuild({
        activeSkills: [{ name: "Smash", level: 6, equipped: true }],
        stigmaSkills: [],
        passiveSkills: [],
      }),
      makeBuild({
        activeSkills: [{ name: "Smash", level: 7, equipped: true }],
        stigmaSkills: [],
        passiveSkills: [],
      }),
    ];
    const stats = aggregate(builds);
    expect(stats.activeSkills["Smash"].avgLv).toBe(6.0);
  });
});
