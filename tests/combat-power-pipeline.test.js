import { readFileSync } from "node:fs";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { memoryD1 } from "./helpers/d1.js";
import {
  getCachedPlayer,
  getCachedPlayers,
  setCachedPlayer,
  setNormalizedCachedBuild,
} from "../src/lib/db.js";
import { characterKey } from "../src/lib/regions.js";
import { getPrefetchCache, setPrefetchCache } from "../src/lib/prefetch/cache.js";
import { populationKey, discoveryConfig } from "../src/lib/discovery-config.js";
import { parseCombatPowerResponse } from "../src/lib/providers/leaderboard/shugo-combat-power.js";
import { getLeaderboard } from "../src/lib/providers/leaderboard/index.js";
import { analyze } from "../src/lib/analyzer.js";
import { loadCachedBuild, loadCachedBuilds } from "../src/lib/character-builds.js";
import { extractBuild, createBudget, createWorkerBudget } from "../src/lib/scraper-shared.js";
import {
  resultLabel,
  canQuickBuild,
  quickBuild,
  sourceHealthText,
  stigmaUsagePercent,
} from "../src/lib/analyzer-presentation.js";

vi.mock("@cloudflare/next-on-pages", () => ({ getRequestContext: vi.fn() }));
import { getRequestContext } from "@cloudflare/next-on-pages";
import { POST } from "../app/api/scrape/route.js";

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/shugo-combat-power/${name}.json`, import.meta.url)));
const config = {
  cls: "chanter",
  lbType: "combat-power",
  sourceMode: "combat-power",
  limit: 10,
  region: "GLOBAL",
  serverId: "all",
  race: "all",
  runeFilter: "all",
};
const players = parseCombatPowerResponse(fixture("global"), config).rankings;
const equip = fixture("global-equipment");
equip.equipment.equipmentList = equip.equipment.equipmentList.slice(0, 1);
equip.profile = fixture("global-info").profile;
const details = [{ ...fixture("global-item"), slotPos: 1 }];
const sampleBuild = extractBuild({ ...players[0], _equip: equip }, {}, details, 3353, 222360);
let db;
beforeEach(() => {
  db = memoryD1();
  getRequestContext.mockReturnValue({ env: { DB: db, LEADERBOARD_SOURCE_MODE: "combat-power" } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  db.sqlite.close();
});

async function events(body) {
  const response = await POST(
    new Request("http://test/api/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json", "cf-connecting-ip": "test" },
      body: JSON.stringify({ ...config, ...body }),
    })
  );
  const text = await response.text();
  if (response.status !== 200) return { response, body: JSON.parse(text) };
  return {
    response,
    events: text
      .split("\n\n")
      .filter(Boolean)
      .map((part) => JSON.parse(part.slice(6))),
  };
}

function mockOfficialPipeline() {
  const fetch = vi.fn(async (input) => {
    const url = new URL(input);
    if (url.pathname === "/api/leaderboard/combat-power") return Response.json(fixture("global"));
    if (url.pathname.endsWith("/character/equipment")) return Response.json(equip);
    if (url.pathname.endsWith("/character/info")) {
      const info = fixture("global-info");
      info.profile.characterId = url.searchParams.get("characterId");
      info.profile.serverId = Number(url.searchParams.get("serverId"));
      return Response.json(info);
    }
    if (url.pathname.endsWith("/character/equipment/item"))
      return Response.json(fixture("global-item"));
    throw new Error(`Unexpected upstream: ${url}`);
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("CP cache identity and SQL behavior", () => {
  it("separates Global/KR/TW even for identical character/server IDs", async () => {
    for (const region of ["GLOBAL", "KR", "TW"])
      await setCachedPlayer(db, "same-id", 1001, region, { region }, details, 1);
    for (const region of ["GLOBAL", "KR", "TW"])
      expect((await getCachedPlayer(db, "same-id", 1001, region)).equipData.region).toBe(region);
    const identities = ["GLOBAL", "KR", "TW"].map((region) => ({
      characterId: "same-id",
      serverId: 1001,
      region,
    }));
    const batch = await getCachedPlayers(db, identities);
    for (const player of identities)
      expect(batch.get(characterKey(player)).equipData.region).toBe(player.region);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM player_cache").get().n).toBe(3);
  });
  it("reuses legacy character data only for its stored region", async () => {
    await db
      .prepare("INSERT INTO player_cache VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind("old-id", "1001", "KR", JSON.stringify(equip), JSON.stringify(details), 1, Date.now())
      .run();
    expect(await getCachedPlayer(db, "old-id", 1001, "TW")).toBeNull();
    expect(await getCachedPlayer(db, "old-id", 1001, "KR")).not.toBeNull();
    const identities = ["KR", "TW"].map((region) => ({
      characterId: "old-id",
      serverId: 1001,
      region,
    }));
    const batch = await getCachedPlayers(db, identities);
    expect(batch.get(characterKey(identities[0]))).not.toBeNull();
    expect(batch.get(characterKey(identities[1]))).toBeNull();
  });
  it("applies the 24-hour TTL to bulk reads without reviving an expired scoped row from legacy data", async () => {
    const player = { characterId: "expired", serverId: 1001, region: "GLOBAL" };
    await setCachedPlayer(
      db,
      player.characterId,
      player.serverId,
      player.region,
      equip,
      details,
      3353
    );
    db.sqlite
      .prepare("UPDATE player_cache SET fetched_at = ?")
      .run(Date.now() - 25 * 60 * 60 * 1000);
    await db
      .prepare("INSERT INTO player_cache VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(
        "expired",
        "1001",
        "GLOBAL",
        JSON.stringify(equip),
        JSON.stringify(details),
        3353,
        Date.now()
      )
      .run();
    expect((await getCachedPlayers(db, [player])).get(characterKey(player))).toBeNull();
    expect(
      await getCachedPlayer(db, player.characterId, player.serverId, player.region)
    ).toBeNull();
  });
  it("upgrades raw caches to compact builds without changing official data or freshness", async () => {
    const player = players[0];
    await setCachedPlayer(
      db,
      player.characterId,
      player.serverId,
      player.region,
      equip,
      details,
      3353
    );
    const fetchedAt = Date.now() - 3600000;
    db.sqlite.prepare("UPDATE player_cache SET fetched_at = ?").run(fetchedAt);
    const upgraded = (await loadCachedBuilds(db, [player], { normalize: true })).get(
      characterKey(player)
    );
    expect(upgraded.buildFetchedAt).toBe(fetchedAt);
    const compact = (await getCachedPlayers(db, [player])).get(characterKey(player));
    expect(compact).toMatchObject({
      equipData: null,
      equipDetails: null,
      buildData: upgraded,
      fetchedAt,
    });
    const raw = await getCachedPlayer(db, player.characterId, player.serverId, player.region);
    expect(raw.equipData.equipment).toEqual(equip.equipment);
    expect(raw.equipData.skill).toEqual(equip.skill);
    expect(raw.equipDetails).toEqual(details);
    expect(await loadCachedBuild(db, player)).toEqual(upgraded);
    db.sqlite.prepare("UPDATE player_cache SET fetched_at = ?").run(Date.now() - 25 * 3600000);
    expect((await loadCachedBuilds(db, [player])).get(characterKey(player))).toBeNull();
  });
  it("does not overwrite a newer character snapshot during a lazy cache upgrade", async () => {
    const player = players[0];
    await setCachedPlayer(
      db,
      player.characterId,
      player.serverId,
      player.region,
      equip,
      details,
      3353
    );
    const row = (await getCachedPlayers(db, [player])).get(characterKey(player));
    db.sqlite.prepare("UPDATE player_cache SET fetched_at = ?").run(row.fetchedAt + 1);
    await setNormalizedCachedBuild(db, row.cacheId, player.serverId, sampleBuild, row.fetchedAt);
    const current = (await getCachedPlayers(db, [player])).get(characterKey(player));
    expect(current.buildData).toBeNull();
    expect(current.fetchedAt).toBe(row.fetchedAt + 1);
  });
  it("rebases discovery metadata on compact builds while preserving official build details", async () => {
    const player = players[0];
    await setCachedPlayer(
      db,
      player.characterId,
      player.serverId,
      player.region,
      equip,
      details,
      3353,
      sampleBuild
    );
    const updated = { ...player, rank: 9, characterName: "Renamed", combatPower: 300001 };
    const cached = (await loadCachedBuilds(db, [updated])).get(characterKey(updated));
    expect(cached).toMatchObject({
      name: "Renamed",
      rank: 9,
      leaderboardCombatPower: 300001,
      combatPower: 222360,
      activeSkills: sampleBuild.activeSkills,
      equipItems: sampleBuild.equipItems,
    });
    const legacy = {
      ...player,
      source: "Official AION 2",
      rank: 3,
      combatPower: null,
      gearScore: null,
    };
    expect(await loadCachedBuild(db, legacy)).toMatchObject({
      source: "Official AION 2",
      rank: 3,
      leaderboardCombatPower: null,
      leaderboardGearScore: null,
      combatPower: 222360,
    });
    const otherRegion = { ...player, region: "TW" };
    expect((await loadCachedBuilds(db, [otherRegion])).get(characterKey(otherRegion))).toBeNull();
  });
  it.each([{ characterId: "wrong-character" }, { region: "TW" }, { stigmaSkills: null }])(
    "rejects an invalid compact build instead of losing data on resume: %s",
    async (invalid) => {
      const player = players[0];
      await setCachedPlayer(
        db,
        player.characterId,
        player.serverId,
        player.region,
        equip,
        details,
        3353,
        { ...sampleBuild, ...invalid }
      );
      expect((await loadCachedBuilds(db, [player])).get(characterKey(player))).toBeNull();
      expect(await loadCachedBuild(db, player)).toBeNull();
    }
  );
  it("stores all region/source/type populations without overwriting legacy caches", async () => {
    await setPrefetchCache(db, "chanter", "nightmare", {}, [sampleBuild], 1000);
    for (const region of ["GLOBAL", "KR", "TW"])
      await setPrefetchCache(
        db,
        "chanter",
        "combat-power",
        {},
        [{ ...sampleBuild, region }],
        1000,
        "Shugo Combat Power",
        region
      );
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM prefetch_cache").get().n).toBe(4);
    expect((await getPrefetchCache(db, "chanter", "nightmare")).builds).toHaveLength(1);
    expect(
      new Set([
        populationKey("nightmare", "GLOBAL"),
        ...["GLOBAL", "KR", "TW"].map((region) => populationKey("combat-power", region)),
      ]).size
    ).toBe(4);
  });
  it("never promotes older-than-seven-day full-build snapshots", async () => {
    await setPrefetchCache(
      db,
      "chanter",
      "combat-power",
      {},
      [sampleBuild],
      1000,
      "Shugo Combat Power",
      "GLOBAL"
    );
    db.sqlite.prepare("UPDATE prefetch_cache SET fetched_at = ?").run(Date.now() - 8 * 86400000);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(fixture("forbidden"), { status: 403 }))
    );
    await expect(getLeaderboard({ ...config, db }, createBudget())).rejects.toMatchObject({
      name: "AllProvidersFailedError",
    });
  });
  it("rejects malformed CP build snapshots as provider failures", async () => {
    await setPrefetchCache(
      db,
      "chanter",
      "combat-power",
      {},
      [{ ...sampleBuild, leaderboardCombatPower: null }],
      1000,
      "Shugo Combat Power",
      "GLOBAL"
    );
    await expect(
      getLeaderboard({ ...config, db, forceProvider: "Cache" }, createBudget())
    ).rejects.toMatchObject({ name: "ProviderError", source: "Cache" });
  });
});

describe("provider failures and historical populations", () => {
  beforeEach(() =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(fixture("forbidden"), { status: 403 }))
    )
  );
  it.each([false, true])(
    "provider failure uses matching %s stale/fresh full-build cache and emits builds",
    async (stale) => {
      await setPrefetchCache(
        db,
        "chanter",
        "combat-power",
        {},
        [sampleBuild],
        stale ? -1 : 100000,
        "Shugo Combat Power",
        "GLOBAL"
      );
      const result = await events({ limit: 1 });
      const done = result.events.find((event) => event.type === "done");
      expect(done.builds).toHaveLength(1);
      expect(done.sourceMeta.source).toBe("Cache");
      expect(done.sourceMeta.health).toBe(stale ? "stale" : "complete");
      expect(done.stats.leaderboardType).toBe("combat-power");
      expect(canQuickBuild(done.stats, done.builds)).toBe(true);
      expect(global.fetch.mock.calls).toHaveLength(1);
      expect(global.fetch.mock.calls[0][0]).toContain("/leaderboard/combat-power?");
    }
  );
  async function seedSnapshot(type) {
    await db
      .prepare("INSERT INTO meta_snapshots VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(
        "chanter",
        type,
        17,
        '[{"name":"Recovery","count":17,"avgLv":10,"pct":100}]',
        "[]",
        "[]",
        "[]",
        1234567890000
      )
      .run();
  }
  it("provider exhaustion falls back to CP history only", async () => {
    await seedSnapshot(populationKey("combat-power", "GLOBAL"));
    await seedSnapshot("nightmare");
    const result = await events();
    const done = result.events.find((event) => event.type === "done");
    expect(done.stats).toMatchObject({
      isHistorical: true,
      leaderboardType: "combat-power",
      region: "GLOBAL",
      updatedAt: 1234567890000,
    });
    expect(done.builds).toEqual([]);
    expect(canQuickBuild(done.stats, done.builds)).toBe(false);
  });
  it("never substitutes a Nightmare aggregate for a failed CP request", async () => {
    await seedSnapshot("nightmare");
    const result = await events();
    expect(result.events.some((event) => event.type === "done")).toBe(false);
    expect(result.events.find((event) => event.type === "error").message).toMatch(/unavailable/);
  });
  it("historical Nightmare retains its original metadata and skips all live discovery", async () => {
    await seedSnapshot("nightmare");
    const result = await events({ lbType: "nightmare", region: "all" });
    const done = result.events.find((event) => event.type === "done");
    expect(done).toMatchObject({
      leaderboardType: "nightmare",
      sourceMeta: { basis: "Nightmare", source: "Historical Snapshot" },
    });
    expect(resultLabel(done.leaderboardType, done.stats.isHistorical)).toBe(
      "Historical Nightmare Snapshot"
    );
    expect(global.fetch).not.toHaveBeenCalled();
    expect(db.sqlite.prepare("SELECT leaderboard FROM meta_snapshots").all()).toEqual([
      { leaderboard: "nightmare" },
    ]);
  });
  it("rejects cross-region continuations and all-region CP pooling", async () => {
    expect((await events({ region: "all" })).response.status).toBe(400);
    expect(
      (
        await events({
          continuation: {
            players: players.slice(0, 1),
            sourceMeta: { leaderboardType: "nightmare" },
          },
        })
      ).response.status
    ).toBe(400);
  });
});

describe("official build enrichment, ranking and continuation", () => {
  it("completes 100 fully enriched builds without exceeding Free D1/fetch limits in any batch", async () => {
    const response = fixture("global");
    response.entries = Array.from({ length: 100 }, (_, index) => ({
      ...response.entries[index % response.entries.length],
      characterId: `sample-top100-${index}`,
      rank: index + 1,
      combatPower: 300000 - index,
    }));
    Object.assign(response, { limit: 100, total: 100, totalPages: 1, hasMore: false });
    const fullEquipment = fixture("global-equipment");
    const fetch = vi.fn(async (input) => {
      const url = new URL(input);
      if (url.pathname === "/api/leaderboard/combat-power") return Response.json(response);
      if (url.pathname.endsWith("/character/equipment")) return Response.json(fullEquipment);
      if (url.pathname.endsWith("/character/info")) {
        const info = fixture("global-info");
        info.profile.characterId = url.searchParams.get("characterId");
        info.profile.serverId = Number(url.searchParams.get("serverId"));
        return Response.json(info);
      }
      if (url.pathname.endsWith("/character/equipment/item")) {
        const item = fullEquipment.equipment.equipmentList.find(
          (entry) => String(entry.id) === url.searchParams.get("id")
        );
        return Response.json({ ...fixture("global-item"), id: item.id, name: item.name });
      }
      throw new Error(`Unexpected upstream: ${url}`);
    });
    vi.stubGlobal("fetch", fetch);
    const prepare = db.prepare.bind(db);
    let queries = 0;
    let maxQueries = 0;
    vi.spyOn(db, "prepare").mockImplementation((sql) => {
      if (++queries > 50) throw new Error("D1 Free query limit exceeded");
      const statement = prepare(sql);
      const bind = statement.bind.bind(statement);
      statement.bind = (...args) => {
        expect(args.length).toBeLessThanOrEqual(100);
        return bind(...args);
      };
      return statement;
    });
    let result;
    let continuation;
    let batches = 0;
    do {
      queries = 0;
      const budget = createWorkerBudget();
      result = await analyze({ ...config, limit: 100, continuation }, { db, budget });
      expect(budget.used).toBeLessThan(50);
      maxQueries = Math.max(maxQueries, queries);
      if (result.continuation) {
        expect(result.continuation.processedCount).toBeGreaterThan(
          continuation?.processedCount || 0
        );
        continuation = result.continuation;
      }
      expect(++batches).toBeLessThanOrEqual(100);
    } while (result.continuation);
    expect(result.count).toBe(100);
    expect(result.builds.map((build) => build.rank)).toEqual(
      Array.from({ length: 100 }, (_, index) => index + 1)
    );
    expect(
      result.builds.every(
        (build) =>
          build.equipItems.length === 25 &&
          build.activeSkills.length === 12 &&
          build.stigmaSkills.length === 13
      )
    ).toBe(true);
    expect(maxQueries).toBeLessThan(15);
    expect(canQuickBuild(result.stats, result.builds)).toBe(true);
    expect(
      fetch.mock.calls.filter(([url]) => url.includes("/leaderboard/combat-power"))
    ).toHaveLength(1);

    // Warm populations use compact projections and bounded cached-player waves.
    fetch.mockClear();
    continuation = undefined;
    let warm;
    let warmBatches = 0;
    do {
      queries = 0;
      warm = await analyze(
        { ...config, limit: 100, continuation },
        { db, budget: createWorkerBudget() }
      );
      expect(queries).toBeLessThanOrEqual(4);
      if (warm.continuation) {
        expect(warm.continuation.processedCount).toBe((continuation?.processedCount || 0) + 5);
        continuation = warm.continuation;
      }
      warmBatches++;
    } while (warm.continuation);
    expect(warm.count).toBe(100);
    expect(warmBatches).toBe(20);
    expect(fetch).toHaveBeenCalledTimes(1);

    // Three-player waves crossing a 40-row read boundary still reuse every cache.
    queries = 0;
    fetch.mockClear();
    const paid = await analyze({ ...config, limit: 100 }, { db, budget: createBudget() });
    expect(paid.count).toBe(100);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("completes full 25-item builds across 50-subrequest invocations without repeating discovery", async () => {
    const officialFetch = mockOfficialPipeline();
    let calls = 0;
    const fullEquipment = fixture("global-equipment");
    const fetch = vi.fn(async (input, options) => {
      if (++calls > 50) throw new Error("Too many subrequests");
      const url = new URL(input);
      if (url.pathname.endsWith("/character/equipment")) return Response.json(fullEquipment);
      if (url.pathname.endsWith("/character/equipment/item")) {
        const item = fullEquipment.equipment.equipmentList.find(
          (item) => String(item.id) === url.searchParams.get("id")
        );
        return Response.json({ ...fixture("global-item"), id: item.id, name: item.name });
      }
      return officialFetch(input, options);
    });
    vi.stubGlobal("fetch", fetch);
    let continuation;
    let previous = 0;
    let result;
    for (let batch = 0; batch < 4; batch++) {
      calls = 0;
      result = await analyze(
        { ...config, limit: 3, continuation },
        { db, budget: createWorkerBudget({ WORKER_SUBREQUEST_LIMIT: "50" }) }
      );
      expect(calls).toBeLessThan(45);
      if (!result.continuation) break;
      expect(result.continuation.processedCount).toBeGreaterThan(previous);
      previous = result.continuation.processedCount;
      continuation = result.continuation;
    }
    expect(result.continuation).toBeUndefined();
    expect(result.builds.map((build) => build.rank)).toEqual([1, 2, 3]);
    expect(result.builds.every((build) => build.equipItems.length === 25)).toBe(true);
    expect(
      fetch.mock.calls.filter(([url]) => url.includes("/leaderboard/combat-power"))
    ).toHaveLength(1);
  });
  it("fails explicitly instead of returning a continuation that cannot advance", async () => {
    const officialFetch = mockOfficialPipeline();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input, options) => {
        if (!String(input).includes("/leaderboard/combat-power"))
          throw new Error("Too many subrequests");
        return officialFetch(input, options);
      })
    );
    await expect(analyze(config, { db, budget: createWorkerBudget() })).rejects.toMatchObject({
      name: "AllProvidersFailedError",
    });
  });
  it("rejects incomplete raw character caches rather than losing item details on resume", async () => {
    await setCachedPlayer(
      db,
      players[0].characterId,
      players[0].serverId,
      "GLOBAL",
      equip,
      [],
      3353
    );
    expect(await loadCachedBuild(db, players[0])).toBeNull();
    await setCachedPlayer(
      db,
      players[0].characterId,
      players[0].serverId,
      "GLOBAL",
      equip,
      details,
      3353
    );
    expect(await loadCachedBuild(db, players[0])).not.toBeNull();
  });
  it("returns usable partial builds when item failures make a budget continuation unsafe", async () => {
    const officialFetch = mockOfficialPipeline();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input, options) => {
        if (String(input).includes("equipment%2Fitem") || String(input).includes("equipment/item"))
          return Response.json({}, { status: 503 });
        return officialFetch(input, options);
      })
    );
    const budget = createBudget();
    budget.consume(950);
    const result = await analyze(config, { db, budget });
    expect(result.continuation).toBeUndefined();
    expect(result.count).toBeGreaterThan(0);
    expect(result.sourceMeta.buildHealth).toBe("partial");
    expect(result.errors.join(" ")).toContain("cannot be resumed safely");
    expect(canQuickBuild(result.stats, result.builds)).toBe(true);
  });
  it("does not resume or cache a build whose item response has a mismatched identifier", async () => {
    const officialFetch = mockOfficialPipeline();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input, options) => {
        if (String(input).includes("equipment/item"))
          return Response.json({ ...fixture("global-item"), id: "wrong-item" });
        return officialFetch(input, options);
      })
    );
    const budget = createBudget();
    budget.consume(950);
    const result = await analyze(config, { db, budget });
    expect(result.count).toBeGreaterThan(0);
    expect(result.continuation).toBeUndefined();
    expect(result.sourceMeta.buildHealth).toBe("partial");
    expect(await loadCachedBuild(db, players[0])).toBeNull();
  });
  it("aggregates real CP-shaped players and makes Quick Build usable", async () => {
    const fetch = mockOfficialPipeline();
    const result = await events({ limit: 2 });
    const done = result.events.find((event) => event.type === "done");
    expect(done.stats.total).toBe(2);
    expect(done.builds[0].activeSkills).toHaveLength(12);
    expect(done.builds[0].stigmaSkills).toHaveLength(13);
    expect(done.builds[0].passiveSkills).toHaveLength(10);
    expect(done.builds[0].manastones).toHaveLength(4);
    expect(done.builds[0].combatPower).toBe(222360);
    expect(canQuickBuild(done.stats, done.builds)).toBe(true);
    expect(quickBuild(done.stats, done.builds)).toBe(done.builds[0]);
    expect(fetch.mock.calls.filter(([url]) => url.includes("shugo.gg"))).toHaveLength(1);
    expect(resultLabel(done.leaderboardType)).toBe("Top Combat Power Builds");
  });
  it("does not let a cached lower-ranked character replace a higher-ranked live build", async () => {
    await setCachedPlayer(
      db,
      players[1].characterId,
      players[1].serverId,
      players[1].region,
      equip,
      details,
      1
    );
    mockOfficialPipeline();
    const result = await analyze({ ...config, limit: 2 }, { db });
    expect(result.builds.map((build) => build.rank)).toEqual([1, 2]);
  });
  it("resumes bounded official item fetches without querying discovery again", async () => {
    const fetch = mockOfficialPipeline();
    const budget = createBudget();
    budget.consume(950);
    const first = await analyze(config, { db, budget });
    expect(first.continuation).toBeDefined();
    expect(first.continuation.sourceMeta.source).toBe("Shugo Combat Power");
    const second = await analyze({ ...config, continuation: first.continuation }, { db });
    expect(second.count).toBe(10);
    expect(second.builds.map((build) => build.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(
      fetch.mock.calls.filter(([url]) => url.includes("/leaderboard/combat-power"))
    ).toHaveLength(1);
  });
  it("restores CP order when a lower-ranked cached build completes across a budget boundary", async () => {
    await setCachedPlayer(
      db,
      players[2].characterId,
      players[2].serverId,
      "GLOBAL",
      equip,
      details,
      3353
    );
    mockOfficialPipeline();
    const budget = createBudget();
    budget.consume(965);
    const first = await analyze(config, { db, budget });
    expect(first.builds.map((build) => build.rank)).toEqual([3]);
    const second = await analyze({ ...config, continuation: first.continuation }, { db });
    expect(second.builds.map((build) => build.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
  it("character API failure uses the same CP cache instead of returning empty builds", async () => {
    await setPrefetchCache(
      db,
      "chanter",
      "combat-power",
      {},
      [sampleBuild],
      100000,
      "Shugo Combat Power",
      "GLOBAL"
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) =>
        url.includes("/leaderboard/combat-power")
          ? Response.json({ ...fixture("global"), hasMore: false })
          : Response.json({}, { status: 503 })
      )
    );
    const result = await analyze({ ...config, limit: 1 }, { db });
    expect(result.sourceMeta.source).toBe("Cache");
    expect(result.count).toBe(1);
  });
});

describe("presentation and restoration configuration", () => {
  it("preserves recorded historical stigma usage without fabricating equipped counts", () => {
    const recorded = { count: 7, pct: 70, avgLv: 3 };
    expect(stigmaUsagePercent(recorded, 10, true)).toBe(70);
    expect(recorded).not.toHaveProperty("equippedCount");
    expect(stigmaUsagePercent({}, 10, true)).toBeNull();
    expect(stigmaUsagePercent({ equippedCount: 3 }, 10)).toBe(30);
  });
  it("restores Official then legacy Shugo without querying Combat Power", async () => {
    const fetch = vi.fn(async (input) => {
      const url = new URL(input);
      const official = url.hostname === "aion2.plaync.com";
      return Response.json({
        expectedServers: 78,
        successfulServers: official ? 0 : 78,
        rankings: official ? [] : [{ characterId: "legacy", serverId: 1001, region: "KR" }],
      });
    });
    vi.stubGlobal("fetch", fetch);
    const result = await getLeaderboard(
      {
        ...config,
        sourceMode: "mode-specific",
        lbType: "nightmare",
        lbInfo: { contentType: 1, label: "Nightmare" },
        rankingType: 1,
        baseUrl: "https://shugo.gg",
        maxPages: 1,
      },
      createBudget()
    );
    expect(result.meta).toMatchObject({
      source: "Shugo",
      leaderboardType: "nightmare",
      basis: "Nightmare",
    });
    expect(fetch.mock.calls.map(([url]) => new URL(url).hostname)).toEqual([
      "aion2.plaync.com",
      "shugo.gg",
    ]);
    expect(fetch.mock.calls.every(([url]) => !url.includes("combat-power"))).toBe(true);
  });
  it("never labels CP as a game-mode ranking and never treats query generation as freshness", () => {
    expect(resultLabel("combat-power")).toBe("Top Combat Power Builds");
    const meta = parseCombatPowerResponse(fixture("global"), config).meta;
    expect(sourceHealthText(meta)).toContain("periodically refreshed");
    expect(sourceHealthText(meta)).not.toContain("minutes ago");
    expect(canQuickBuild({ isHistorical: true, total: 17 }, [sampleBuild])).toBe(false);
    expect(canQuickBuild({ total: 1 }, [])).toBe(false);
  });
  it("marks all old selectors historical while defaulting to a distinct CP type", () => {
    const settings = discoveryConfig({ LEADERBOARD_SOURCE_MODE: "combat-power" });
    expect(settings.defaultLeaderboard).toBe("combat-power");
    expect(settings.regions.map((region) => region.id)).toEqual(["GLOBAL", "KR", "TW"]);
    expect(
      settings.leaderboards
        .filter((item) => item.id !== "combat-power")
        .every((item) => item.historicalOnly)
    ).toBe(true);
    expect(discoveryConfig({ LEADERBOARD_SOURCE_MODE: "mode-specific" }).defaultLeaderboard).toBe(
      "nightmare"
    );
  });
});
