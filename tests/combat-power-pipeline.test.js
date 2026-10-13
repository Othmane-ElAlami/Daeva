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
import {
  getPrefetchCache,
  setPrefetchCache,
  getAllPrefetchEntries,
} from "../src/lib/prefetch/cache.js";
import { populationKey, discoveryConfig } from "../src/lib/discovery-config.js";
import { parseCombatPowerResponse } from "../src/lib/providers/leaderboard/shugo-combat-power.js";
import { getLeaderboard } from "../src/lib/providers/leaderboard/index.js";
import { analyze } from "../src/lib/analyzer.js";
import {
  loadCachedBuild,
  loadCachedBuilds,
  fetchCharacterBuild,
  BUILD_FRESH_MS,
} from "../src/lib/character-builds.js";
import { claimRefresh, updateRefresh } from "../src/lib/prefetch/refresh.js";
import { runPrefetchJob } from "../src/lib/prefetch/runner.js";
import {
  extractBuild,
  buildPlayerMetadata,
  aggregate,
  createBudget,
  createWorkerBudget,
} from "../src/lib/scraper-shared.js";
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
import { POST as prefetchPOST } from "../app/api/prefetch/run/route.js";
import { GET as prefetchStatus } from "../app/api/prefetch/status/route.js";
import { runCombatPowerPrefetch } from "../scripts/prefetch-combat-power.mjs";

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
  it("filters expired player rows in SQL before transferring/parsing them during runner preparation", async () => {
    const fetchedAt = Date.now() - 7 * 3600000;
    for (const player of players.slice(0, 2))
      await setCachedPlayer(
        db,
        player.characterId,
        player.serverId,
        player.region,
        equip,
        details,
        3353,
        { ...sampleBuild, ...buildPlayerMetadata(player), buildFetchedAt: fetchedAt },
        fetchedAt
      );
    await db
      .prepare("UPDATE player_cache SET character_id = ? WHERE character_id = ?")
      .bind(players[1].characterId, `GLOBAL:${players[1].characterId}`)
      .run();
    const prepare = db.prepare.bind(db);
    let rowsRead = 0;
    vi.spyOn(db, "prepare").mockImplementation((sql) => {
      const statement = prepare(sql);
      if (sql.includes("FROM player_cache")) {
        const all = statement.all.bind(statement);
        statement.all = async () => {
          const result = await all();
          rowsRead += result.results.length;
          return result;
        };
      }
      return statement;
    });
    const candidates = players.slice(0, 2);
    const fresh = await loadCachedBuilds(db, candidates, {
      normalize: true,
      maxAgeMs: BUILD_FRESH_MS,
    });
    expect([...fresh.values()]).toEqual([null, null]);
    expect(rowsRead).toBe(0);
    const retained = await loadCachedBuilds(db, candidates);
    expect([...retained.values()].every((build) => build.buildFetchedAt === fetchedAt)).toBe(true);
  });
  it("stores a large complete CP population losslessly and keeps encoded cache counts and guards accurate", async () => {
    const equipment = fixture("tw-equipment");
    equipment.equipment.equipmentList = equipment.equipment.equipmentList.slice(0, 22);
    const item = fixture("global-item");
    const details = equipment.equipment.equipmentList.map((entry) => ({
      ...item,
      id: entry.id,
      name: entry.name,
      slotPos: entry.slotPos,
    }));
    const player = parseCombatPowerResponse(fixture("tw"), {
      region: "TW",
      cls: "chanter",
    }).rankings[0];
    const base = extractBuild({ ...player, _equip: equipment }, {}, details, 3353, 1111968);
    const builds = Array.from({ length: 100 }, (_, index) => ({
      ...base,
      characterId: `large-sample-${index}`,
      rank: index + 1,
    }));
    const stats = { ...aggregate(builds), sourceMeta: { total: 100 } };
    const saved = await setPrefetchCache(
      db,
      "chanter",
      "combat-power",
      stats,
      builds,
      100000,
      "Shugo Combat Power",
      "TW"
    );
    expect(saved).toMatchObject({ stored: true, complete: true, buildCount: 100 });
    const row = db.sqlite.prepare("SELECT data, builds FROM prefetch_cache").get();
    expect(Buffer.byteLength(JSON.stringify(builds))).toBeGreaterThan(2_000_000);
    expect(Buffer.byteLength(row.data) + Buffer.byteLength(row.builds)).toBeLessThan(2_000_000);
    expect(JSON.parse(row.builds).encoding).toBe("object-table-v1");
    expect((await getPrefetchCache(db, "chanter", "combat-power", true, "TW")).builds).toEqual(
      builds
    );
    expect(
      await getPrefetchCache(db, "chanter", "combat-power", true, "TW", { metadataOnly: true })
    ).toMatchObject({ buildCount: 100, data: { population: { complete: true } } });
    expect((await getAllPrefetchEntries(db))[0]).toMatchObject({ buildCount: 100, complete: true });
    const sample = await setPrefetchCache(
      db,
      "chanter",
      "combat-power",
      stats,
      builds.slice(0, 1),
      100000,
      "Shugo Combat Power",
      "TW"
    );
    expect(sample.stored).toBe(false);
    expect(db.sqlite.prepare("SELECT builds FROM prefetch_cache").get().builds).toBe(row.builds);
  });
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
      // Fresh healthy samples satisfy a matching small request directly. Stale
      // incomplete samples remain a fallback after live discovery fails.
      expect(global.fetch.mock.calls).toHaveLength(stale ? 1 : 0);
      if (stale) expect(global.fetch.mock.calls[0][0]).toContain("/leaderboard/combat-power?");
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
  it.each(["item-level", "combat-power", "equipment"])(
    "recovers an invalid direct %s response through the validated proxy",
    async (failure) => {
      const upstream = mockOfficialPipeline();
      const fetch = vi.fn(async (input, options) => {
        const url = new URL(input);
        if (url.pathname === "/api/proxy") return upstream(url.searchParams.get("url"), options);
        const data = await (await upstream(input, options)).json();
        if (url.pathname.endsWith("/character/info")) {
          if (failure === "item-level")
            for (const stat of data.stat.statList) if (stat.type === "ItemLevel") stat.value = 0;
          if (failure === "combat-power") data.profile.combatPower = null;
        }
        if (failure === "equipment" && url.pathname.endsWith("/character/equipment"))
          data.equipment.equipmentList = [];
        return Response.json(data);
      });
      vi.stubGlobal("fetch", fetch);
      const result = await fetchCharacterBuild(players[0], db, createBudget());
      expect(result.warnings).toEqual([]);
      expect(result.build.gearScore).toBe(3353);
      expect(result.build.combatPower).toBe(222360);
      expect(result.build.equipItems).toHaveLength(1);
      expect(
        fetch.mock.calls.filter(([url]) => new URL(url).pathname === "/api/proxy")
      ).toHaveLength(1);
      expect(
        fetch.mock.calls.filter(([url]) =>
          new URL(url).pathname.endsWith("/character/equipment/item")
        )
      ).toHaveLength(1);
      expect((await loadCachedBuild(db, players[0])).gearScore).toBe(3353);
    }
  );
  it("rejects mismatched profile IDs on both transports without caching a build", async () => {
    const upstream = mockOfficialPipeline();
    const fetch = vi.fn(async (input, options) => {
      let url = new URL(input);
      if (url.pathname === "/api/proxy") url = new URL(url.searchParams.get("url"));
      const data = await (await upstream(url.toString(), options)).json();
      if (url.pathname.endsWith("/character/info")) data.profile.characterId = "wrong-character";
      return Response.json(data);
    });
    vi.stubGlobal("fetch", fetch);
    await expect(fetchCharacterBuild(players[0], db, createBudget())).rejects.toThrow(
      "Official profile identifiers do not match discovery."
    );
    expect(fetch.mock.calls.filter(([url]) => new URL(url).pathname === "/api/proxy")).toHaveLength(
      1
    );
    expect(
      await getCachedPlayer(db, players[0].characterId, players[0].serverId, "GLOBAL")
    ).toBeNull();
  });
  it("preserves the last cached build when both profile transports have unavailable stats", async () => {
    const fetchedAt = Date.now() - 7 * 3600000;
    await setCachedPlayer(
      db,
      players[0].characterId,
      players[0].serverId,
      "GLOBAL",
      equip,
      details,
      3353,
      sampleBuild,
      fetchedAt
    );
    const upstream = mockOfficialPipeline();
    const fetch = vi.fn(async (input, options) => {
      let url = new URL(input);
      if (url.pathname === "/api/proxy") url = new URL(url.searchParams.get("url"));
      const data = await (await upstream(url.toString(), options)).json();
      if (url.pathname.endsWith("/character/info"))
        for (const stat of data.stat.statList) if (stat.type === "ItemLevel") stat.value = 0;
      return Response.json(data);
    });
    vi.stubGlobal("fetch", fetch);
    await expect(fetchCharacterBuild(players[0], db, createBudget())).rejects.toThrow(
      "Official character stats are unavailable."
    );
    expect(fetch.mock.calls.filter(([url]) => new URL(url).pathname === "/api/proxy")).toHaveLength(
      1
    );
    const retained = await getCachedPlayer(
      db,
      players[0].characterId,
      players[0].serverId,
      "GLOBAL"
    );
    expect(retained.fetchedAt).toBe(fetchedAt);
    expect(retained.itemLevel).toBe(3353);
  });
  it.each(["proxy", "retry"])(
    "recovers a bad item response via %s without refetching successful items",
    async (recovery) => {
      const equipment = fixture("global-equipment");
      equipment.equipment.equipmentList = equipment.equipment.equipmentList.slice(0, 2);
      const counts = new Map();
      const upstream = vi.fn(async (input) => {
        let url = new URL(input);
        if (url.pathname === "/api/proxy") url = new URL(url.searchParams.get("url"));
        if (url.pathname.endsWith("/character/info")) return Response.json(fixture("global-info"));
        if (url.pathname.endsWith("/character/equipment")) return Response.json(equipment);
        const id = url.searchParams.get("id");
        counts.set(id, (counts.get(id) || 0) + 1);
        if (
          id === String(equipment.equipment.equipmentList[0].id) &&
          counts.get(id) <= (recovery === "proxy" ? 1 : 2)
        )
          return Response.json({});
        const item = equipment.equipment.equipmentList.find((item) => String(item.id) === id);
        return Response.json({ ...fixture("global-item"), id: item.id, name: item.name });
      });
      vi.stubGlobal("fetch", upstream);
      const result = await fetchCharacterBuild(players[0], db, createBudget(), {
        retryItemDetails: true,
      });
      expect(result.warnings).toEqual([]);
      expect(result.build.equipItems).toHaveLength(2);
      expect(counts.get(String(equipment.equipment.equipmentList[0].id))).toBe(
        recovery === "proxy" ? 2 : 3
      );
      expect(counts.get(String(equipment.equipment.equipmentList[1].id))).toBe(1);
      expect(
        upstream.mock.calls.filter(([url]) => String(url).includes("/character/equipment?"))
      ).toHaveLength(1);
      expect((await loadCachedBuild(db, players[0])).equipItems).toHaveLength(2);
    }
  );
  it("reports an unresolved item and preserves the existing player cache", async () => {
    const fetchedAt = Date.now() - 7 * 3600000;
    await setCachedPlayer(
      db,
      players[0].characterId,
      players[0].serverId,
      "GLOBAL",
      equip,
      details,
      3353,
      sampleBuild,
      fetchedAt
    );
    const fetch = mockOfficialPipeline();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input, options) => {
        if (String(input).includes("equipment/item") || String(input).includes("equipment%2Fitem"))
          return Response.json({});
        return fetch(input, options);
      })
    );
    const result = await fetchCharacterBuild(players[0], db, createBudget(), {
      retryItemDetails: true,
    });
    expect(result.warnings[0]).toContain(
      `id ${equip.equipment.equipmentList[0].id}, slot ${equip.equipment.equipmentList[0].slotPos}`
    );
    expect(result.warnings[0]).toContain("Malformed official item details");
    expect((await getCachedPlayers(db, [players[0]])).get(characterKey(players[0])).fetchedAt).toBe(
      fetchedAt
    );
  });
  it.each([false, true])(
    "runner prefetch uploads 100 unique builds and reuses the population (corrupt duplicate: %s)",
    async (duplicate) => {
      const discovery = fixture("global");
      discovery.entries = Array.from({ length: 100 }, (_, index) => ({
        ...discovery.entries[0],
        characterId: `runner-${index}`,
        rank: index + 1,
        combatPower: 300000 - index,
        profileImg: discovery.entries[0].profileImg.replace(
          "charKey=1000",
          `charKey=${1000 + index}`
        ),
      }));
      if (duplicate) {
        discovery.entries.splice(1, 0, { ...discovery.entries[0], characterId: "runner-`0" });
        discovery.entries.forEach((entry, index) => (entry.rank = index + 1));
      }
      const entries = discovery.entries;
      Object.assign(discovery, {
        total: entries.length,
        limit: 100,
        totalPages: duplicate ? 2 : 1,
        hasMore: duplicate,
      });
      const upstream = vi.fn(async (url) => {
        expect(url).toContain("/api/leaderboard/combat-power?");
        const page = Number(new URL(url).searchParams.get("page"));
        return Response.json({
          ...discovery,
          page,
          hasMore: page === 1 && duplicate,
          entries: entries.slice((page - 1) * 100, page * 100),
        });
      });
      vi.stubGlobal("fetch", upstream);
      getRequestContext.mockReturnValue({
        env: { DB: db, ADMIN_SECRET: "runner-test", LEADERBOARD_SOURCE_MODE: "combat-power" },
      });
      const fetchedAt = Date.now() - 60000;
      const enrich = vi.fn(async (player) => ({
        build: { ...sampleBuild, ...buildPlayerMetadata(player), buildFetchedAt: fetchedAt },
        warnings: [],
      }));
      const options = {
        apiUrl: "http://localhost",
        secret: "runner-test",
        cls: "chanter",
        region: "GLOBAL",
        request: (url, init) => prefetchPOST(new Request(url, init)),
        enrich,
        wait: async () => {},
        log: () => {},
      };
      expect(await runCombatPowerPrefetch(options)).toMatchObject({
        complete: true,
        buildCount: 100,
        enrichedCount: 100,
        requests: 102,
      });
      expect(enrich).toHaveBeenCalledTimes(100);
      const cached = await getPrefetchCache(db, "chanter", "combat-power", false, "GLOBAL");
      expect(cached.data.population).toMatchObject({
        complete: true,
        buildCount: 100,
        preparedBy: "scheduled",
      });
      expect(cached.builds[0].buildFetchedAt).toBe(fetchedAt);
      expect(cached.builds.map((build) => build.rank)).toEqual(
        Array.from({ length: 100 }, (_, i) => i + 1 + (duplicate && i > 0 ? 1 : 0))
      );
      expect(cached.data.sourceMeta.discoveryDuplicatesIgnored).toBe(duplicate ? 1 : 0);
      expect((await getAllPrefetchEntries(db))[0].discoveryDuplicatesIgnored).toBe(
        duplicate ? 1 : 0
      );
      expect(canQuickBuild(cached.data, cached.builds)).toBe(true);
      enrich.mockClear();
      expect(await runCombatPowerPrefetch(options)).toMatchObject({
        complete: true,
        buildCount: 100,
        enrichedCount: 0,
        requests: 1,
      });
      expect(enrich).not.toHaveBeenCalled();
      const result = await events({ limit: 100 });
      expect(result.events.find((event) => event.type === "done")).toMatchObject({
        count: 100,
        sourceMeta: { source: "Cache" },
      });
      expect(upstream).toHaveBeenCalledTimes(duplicate ? 2 : 1);
    }
  );
  it.each(["region", "identity", "timestamp", "details"])(
    "rejects an invalid runner upload (%s) before writing any character cache",
    async (invalid) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json(fixture("global")))
      );
      getRequestContext.mockReturnValue({
        env: { DB: db, ADMIN_SECRET: "runner-test", LEADERBOARD_SOURCE_MODE: "combat-power" },
      });
      const base = {
        cls: "chanter",
        leaderboard: "combat-power",
        region: "GLOBAL",
        execution: "runner",
      };
      const post = (body) =>
        prefetchPOST(
          new Request("http://localhost/api/prefetch/run", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer runner-test" },
            body: JSON.stringify(body),
          })
        );
      const prepared = await (await post(base)).json();
      const build = {
        ...sampleBuild,
        ...buildPlayerMetadata(prepared.enrichPlayer),
        buildFetchedAt: Date.now(),
      };
      if (invalid === "region") build.region = "TW";
      if (invalid === "identity") build.characterId = "other-character";
      if (invalid === "timestamp") build.buildFetchedAt -= 11 * 60000;
      if (invalid === "details") build.arcanas = null;
      expect(
        (await post({ ...base, continuation: prepared.continuation, enrichedBuild: build })).status
      ).toBe(400);
      expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM player_cache").get().count).toBe(0);
    }
  );
  it("runner build failure releases the lease and preserves the last complete dataset", async () => {
    await setPrefetchCache(
      db,
      "chanter",
      "combat-power",
      { sourceMeta: { total: 1 } },
      [sampleBuild],
      -1,
      "Shugo Combat Power",
      "GLOBAL"
    );
    const before = await getPrefetchCache(db, "chanter", "combat-power", true, "GLOBAL");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(fixture("global")))
    );
    getRequestContext.mockReturnValue({
      env: { DB: db, ADMIN_SECRET: "runner-test", LEADERBOARD_SOURCE_MODE: "combat-power" },
    });
    const enrich = vi.fn(async () => {
      throw new Error("Official profile identifiers do not match discovery. runner-test");
    });
    await expect(
      runCombatPowerPrefetch({
        apiUrl: "http://localhost",
        secret: "runner-test",
        cls: "chanter",
        region: "GLOBAL",
        request: (url, init) => prefetchPOST(new Request(url, init)),
        enrich,
        wait: async () => {},
        log: () => {},
      })
    ).rejects.toThrow("identifiers do not match");
    expect(enrich).toHaveBeenCalledTimes(2);
    const after = await getPrefetchCache(db, "chanter", "combat-power", true, "GLOBAL");
    expect(after.builds).toEqual(before.builds);
    expect(after.fetchedAt).toBe(before.fetchedAt);
    expect(after.expiresAt).toBe(before.expiresAt);
    expect(after.data.refresh).toMatchObject({ status: "failed", leaseExpiresAt: 0 });
    expect(after.data.refresh.error).toContain("enrichment");
    expect(after.data.refresh.error).toContain("[redacted]");
    expect(after.data.refresh.error).not.toContain("runner-test");
  });
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
    let playerRowsRead = 0;
    vi.spyOn(db, "prepare").mockImplementation((sql) => {
      if (++queries > 50) throw new Error("D1 Free query limit exceeded");
      const statement = prepare(sql);
      if (sql.includes("FROM player_cache")) {
        const all = statement.all.bind(statement);
        statement.all = async () => {
          const result = await all();
          playerRowsRead += result.results.length;
          return result;
        };
      }
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

    // Scheduled continuations read only the next wave. All completed builds
    // are loaded once, in a separate publication request with no enrichment.
    fetch.mockClear();
    continuation = undefined;
    let scheduled;
    let scheduledBatches = 0;
    do {
      queries = 0;
      playerRowsRead = 0;
      const publishing = continuation?.phase === "publish";
      scheduled = await runPrefetchJob("chanter", "combat-power", db, {
        region: "GLOBAL",
        sourceMode: "combat-power",
        continuation,
        env: { WORKER_SUBREQUEST_LIMIT: "50" },
      });
      if (publishing) {
        expect(scheduled.count).toBe(100);
        expect(scheduled.stats.total).toBe(100);
        expect(scheduled.budgetUsed).toBe(0);
        expect(playerRowsRead).toBe(100);
      } else {
        expect(scheduled.builds.length).toBeLessThanOrEqual(5);
        expect(playerRowsRead).toBeLessThanOrEqual(5);
        expect(scheduled.stats).toBeUndefined();
        expect(scheduled.continuation.processedCount).toBe((continuation?.processedCount || 0) + 5);
      }
      continuation = scheduled.continuation;
      expect(++scheduledBatches).toBeLessThanOrEqual(120);
    } while (continuation);
    expect(scheduledBatches).toBe(21);
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

describe("prefetched populations and refresh safety", () => {
  function completePipeline(total = players.length) {
    const official = mockOfficialPipeline();
    const fetch = vi.fn(async (url) => {
      if (url.includes("/leaderboard/combat-power")) {
        const response = fixture("global");
        return Response.json({
          ...response,
          entries: response.entries.slice(0, total),
          total,
          totalPages: 1,
          hasMore: false,
        });
      }
      return official(url);
    });
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }
  function prefetchRequest(continuation) {
    getRequestContext.mockReturnValue({
      env: { DB: db, ADMIN_SECRET: "prefetch-tests", LEADERBOARD_SOURCE_MODE: "combat-power" },
    });
    return new Request("http://test/api/prefetch/run", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer prefetch-tests" },
      body: JSON.stringify({
        cls: "chanter",
        leaderboard: "combat-power",
        region: "GLOBAL",
        continuation,
      }),
    });
  }
  async function warmPopulation() {
    let body;
    do {
      const response = await prefetchPOST(prefetchRequest(body?.continuation));
      expect(response.status).toBe(200);
      body = await response.json();
    } while (body.continuation);
    expect(body.complete).toBe(true);
    return getPrefetchCache(db, "chanter", "combat-power", true, "GLOBAL");
  }
  it("scheduled prefetch stores complete enriched builds and repeated interactive requests reuse them directly", async () => {
    const fetch = completePipeline();
    const cached = await warmPopulation();
    expect(cached.data.population).toMatchObject({
      complete: true,
      buildCount: 10,
      expectedCount: 10,
      preparedBy: "scheduled",
    });
    expect(cached.builds[0]).toMatchObject({
      activeSkills: expect.any(Array),
      stigmaSkills: expect.any(Array),
      equipItems: expect.any(Array),
    });
    expect(cached.builds[0].stigmaSkills).toHaveLength(13);
    fetch.mockClear();
    const summary = await getPrefetchCache(db, "chanter", "combat-power", false, "GLOBAL", {
      metadataOnly: true,
    });
    expect(summary.builds).toBeUndefined();
    expect(summary.buildCount).toBe(10);
    expect(summary.data.population.complete).toBe(true);
    const skipped = await (await prefetchPOST(prefetchRequest())).json();
    expect(skipped).toMatchObject({ success: true, skipped: true, playerCount: 10 });
    for (let index = 0; index < 2; index++) {
      db.sqlite.prepare("DELETE FROM rate_limits").run();
      const result = await events({ limit: 10 });
      const done = result.events.find((e) => e.type === "done");
      expect(done).toMatchObject({
        count: 10,
        budgetUsed: 0,
        sourceMeta: { source: "Cache", populationComplete: true },
      });
      expect(done.builds).toEqual(cached.builds);
      expect(canQuickBuild(done.stats, done.builds)).toBe(true);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("serves a stale complete population quickly while preserving its timestamp for scheduled refresh", async () => {
    const fetch = completePipeline();
    await warmPopulation();
    const fetchedAt = Date.now() - 8 * 3600000;
    db.sqlite
      .prepare("UPDATE prefetch_cache SET fetched_at = ?, expires_at = ?")
      .run(fetchedAt, fetchedAt + 7 * 3600000);
    fetch.mockClear();
    const done = (await events()).events.find((e) => e.type === "done");
    expect(done.sourceMeta).toMatchObject({
      source: "Cache",
      health: "stale",
      fetchedAt,
      refreshDue: true,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not replace a full population with an incomplete sample, malformed builds or failed refresh", async () => {
    completePipeline();
    const cached = await warmPopulation();
    const sample = await setPrefetchCache(
      db,
      "chanter",
      "combat-power",
      {
        ...cached.data,
        population: undefined,
        sourceMeta: { ...cached.data.sourceMeta, total: 4000 },
      },
      cached.builds.slice(0, 1),
      10000,
      "Shugo Combat Power",
      "GLOBAL"
    );
    expect(sample.stored).toBe(false);
    const invalid = await setPrefetchCache(
      db,
      "chanter",
      "combat-power",
      cached.data,
      [{ ...cached.builds[0], characterId: "" }],
      10000,
      "Shugo Combat Power",
      "GLOBAL"
    );
    expect(invalid.stored).toBe(false);
    const fetchedAt = Date.now() - 6 * 3600000;
    db.sqlite.prepare("UPDATE prefetch_cache SET fetched_at = ?").run(fetchedAt);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({}, { status: 503 }))
    );
    expect((await prefetchPOST(prefetchRequest())).status).toBe(503);
    const retained = await getPrefetchCache(db, "chanter", "combat-power", true, "GLOBAL");
    expect(retained.builds).toEqual(cached.builds);
    expect(retained.fetchedAt).toBe(fetchedAt);
    expect(retained.expiresAt).toBe(cached.expiresAt);
    const status = await (
      await prefetchStatus(
        new Request("http://test/api/prefetch/status", {
          headers: { Authorization: "Bearer prefetch-tests" },
        })
      )
    ).json();
    expect(status.failedPopulations).toEqual([
      expect.objectContaining({
        class: "chanter",
        region: "GLOBAL",
        buildCount: 10,
        complete: true,
      }),
    ]);
    expect(status.populations).toHaveLength(24);
    expect(JSON.stringify(status)).not.toContain("prefetch-tests");
    expect(JSON.stringify(status)).not.toContain("owner");
  });
  it("coordinates a population in D1 while region and class leases remain independent", async () => {
    const leases = await Promise.all([claimRefresh(db, config), claimRefresh(db, config)]);
    expect(leases.filter((lease) => lease.acquired)).toHaveLength(1);
    const owner = leases.find((lease) => lease.acquired).token;
    expect((await claimRefresh(db, { ...config, region: "TW" })).acquired).toBe(true);
    expect((await claimRefresh(db, { ...config, cls: "cleric" })).acquired).toBe(true);
    expect((await claimRefresh(db, config, owner)).acquired).toBe(true);
    await updateRefresh(db, config, owner, "failed");
    expect((await claimRefresh(db, config)).acquired).toBe(true);
  });
  it("reports a failed cache publication while retaining the previous full dataset", async () => {
    completePipeline();
    const cached = await warmPopulation();
    const fetchedAt = Date.now() - 8 * 86400000;
    const expiresAt = fetchedAt + 7 * 3600000;
    db.sqlite
      .prepare("UPDATE prefetch_cache SET fetched_at = ?, expires_at = ?")
      .run(fetchedAt, expiresAt);
    const prepare = db.prepare;
    db.prepare = (sql) => {
      if (sql.includes("builds = excluded.builds")) throw new Error("Cache write failed");
      return prepare(sql);
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      let result;
      let continuation;
      do {
        result = await events({ continuation });
        continuation = result.events.find((e) => e.type === "continue");
      } while (continuation);
      const done = result.events.find((e) => e.type === "done");
      expect(done.count).toBe(10);
      expect(done.sourceMeta.source).toBe("Shugo Combat Power");
      const retained = await getPrefetchCache(db, "chanter", "combat-power", true, "GLOBAL");
      expect(retained.builds).toEqual(cached.builds);
      expect(retained.fetchedAt).toBe(fetchedAt);
      expect(retained.expiresAt).toBe(expiresAt);
      expect(retained.data.refresh).toMatchObject({
        status: "failed",
        error: "Cache publication failed. Existing cached data is retained.",
      });
    } finally {
      log.mockRestore();
    }
  });
  it("a concurrent cold request waits for the shared dataset instead of duplicating upstream work", async () => {
    const official = completePipeline(1);
    let unblock;
    let discovered;
    const gate = new Promise((resolve) => {
      unblock = resolve;
    });
    const started = new Promise((resolve) => {
      discovered = resolve;
    });
    const fetch = vi.fn(async (url) => {
      if (url.includes("/leaderboard/combat-power")) {
        discovered();
        await gate;
      }
      return official(url);
    });
    vi.stubGlobal("fetch", fetch);
    const request = (ip) =>
      new Request("http://test/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json", "cf-connecting-ip": ip },
        body: JSON.stringify({ ...config, limit: 1 }),
      });
    const first = await POST(request("first-user"));
    await started;
    const second = await POST(request("second-user"));
    expect(await second.text()).toContain('"type":"pending"');
    expect(fetch).toHaveBeenCalledTimes(1);
    unblock();
    expect(await first.text()).toContain('"type":"done"');
    fetch.mockClear();
    const third = await POST(request("third-user"));
    expect(await third.text()).toContain('"source":"Cache"');
    expect(fetch).not.toHaveBeenCalled();
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
