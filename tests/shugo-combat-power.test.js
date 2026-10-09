import { readFileSync } from "node:fs";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseCombatPowerResponse,
  getLeaderboard,
  ShugoCombatPowerError,
} from "../src/lib/providers/leaderboard/shugo-combat-power.js";
import { characterApiUrl, normalizeRegion } from "../src/lib/regions.js";
import { createBudget, subrequestBudgetExhausted } from "../src/lib/scraper-shared.js";
import { getLeaderboard as selectProvider } from "../src/lib/providers/leaderboard/index.js";

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/shugo-combat-power/${name}.json`, import.meta.url)));
const config = {
  lbType: "combat-power",
  cls: "chanter",
  region: "GLOBAL",
  limit: 10,
  sourceMode: "combat-power",
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Shugo Combat Power public contract", () => {
  it.each(["GLOBAL", "KR", "TW"])(
    "normalizes captured %s entries without inventing metadata",
    (region) => {
      const data = fixture(region.toLowerCase());
      const { rankings, meta } = parseCombatPowerResponse(data, { ...config, region });
      expect(rankings[0]).toMatchObject({
        characterId: data.entries[0].characterId,
        characterName: data.entries[0].name,
        serverId: data.entries[0].serverId,
        serverName: data.entries[0].serverName,
        class: "chanter",
        region,
        combatPower: data.entries[0].combatPower,
        gearScore: data.entries[0].gearScore,
        rank: 1,
        source: "Shugo Combat Power",
        globalRank: null,
      });
      expect(meta).toMatchObject({
        source: "Shugo Combat Power",
        basis: "Combat Power",
        leaderboardType: "combat-power",
        ageMs: null,
        generatedAt: data.generatedAt,
        topRefreshedAt: data.topRefreshedAt,
        total: data.total,
        health: "complete",
      });
      expect(meta).not.toHaveProperty("expectedServers");
    }
  );
  it("uses Combat Power order rather than gear score", () => {
    const data = fixture("global");
    data.entries.reverse();
    data.entries[0].gearScore = 99999;
    const { rankings } = parseCombatPowerResponse(data, config);
    expect(rankings[0].combatPower).toBe(
      Math.max(...data.entries.map((player) => player.combatPower))
    );
    expect(rankings.at(-1).gearScore).toBe(99999);
  });
  it("preserves a region-wide rank only for unfiltered queries", () => {
    const { rankings } = parseCombatPowerResponse(fixture("global"), { ...config, cls: null });
    expect(rankings[0].globalRank).toBe(1);
    expect(rankings[0].rankScope).toBe("region");
  });
  it("asks upstream for class, region, server and faction with CP sorting", async () => {
    const data = fixture("global");
    data.entries = [data.entries[2]];
    data.total = 1;
    data.totalPages = 1;
    data.hasMore = false;
    const fetch = vi.fn(async () => Response.json(data));
    vi.stubGlobal("fetch", fetch);
    await getLeaderboard({ ...config, serverId: 1302, race: "elyos" }, createBudget());
    const [url, options] = fetch.mock.calls[0];
    const params = new URL(url).searchParams;
    expect(new URL(url).pathname).toBe("/api/leaderboard/combat-power");
    expect(Object.fromEntries(params)).toMatchObject({
      class: "Chanter",
      region: "GLOBAL",
      serverId: "1302",
      faction: "elyos",
      sort: "combatPower",
      limit: "100",
      page: "1",
    });
    expect(options).toMatchObject({
      redirect: "error",
      headers: { Referer: "https://shugo.gg/leaderboard", Origin: "https://shugo.gg" },
    });
  });
  it("rejects an ignored class filter", () => {
    const data = fixture("global");
    data.entries[0].className = "Templar";
    expect(() => parseCombatPowerResponse(data, config)).toThrow(/class filter/);
  });
  it("rejects an upstream schema change fixture", () => {
    expect(() => parseCombatPowerResponse(fixture("schema-changed"), config)).toThrow(
      ShugoCombatPowerError
    );
    expect(() => parseCombatPowerResponse(fixture("forbidden"), config)).toThrow(
      ShugoCombatPowerError
    );
  });
  it.each(["characterId", "serverId"])("rejects missing %s instead of making up an ID", (field) => {
    const data = fixture("global");
    delete data.entries[0][field];
    expect(() => parseCombatPowerResponse(data, config)).toThrow(/identifiers/);
  });
  it("rejects an unhealthy first-page empty pool", () => {
    const data = fixture("global");
    data.entries = [];
    data.total = 0;
    data.hasMore = false;
    data.totalPages = 0;
    expect(() => parseCombatPowerResponse(data, config)).toThrow(/empty discovery pool/);
  });
  it("allows an exhausted later page with consistent pagination", () => {
    const data = fixture("global");
    Object.assign(data, { entries: [], page: 2, total: 10, totalPages: 1, hasMore: false });
    expect(parseCombatPowerResponse(data, { ...config, startPage: 2 }).rankings).toEqual([]);
  });
  it("rejects incorrect region, sort and Global subregion", () => {
    for (const change of [{ region: "TW" }, { sort: "gearScore" }])
      expect(() => parseCombatPowerResponse({ ...fixture("global"), ...change }, config)).toThrow(
        ShugoCombatPowerError
      );
    const data = fixture("global");
    data.entries[0].subRegion = "nae";
    expect(() => parseCombatPowerResponse(data, config)).toThrow(/subregion/);
  });
  it.each([
    "<!DOCTYPE html><title>Sign in</title>",
    "<html><title>Just a moment...</title>Verify you are human</html>",
  ])("rejects HTML login/challenge content", async (html) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(html, { headers: { "content-type": "text/html" } }))
    );
    await expect(getLeaderboard(config, createBudget())).rejects.toMatchObject({
      name: "ShugoCombatPowerError",
      code: "RESPONSE",
    });
  });
  it("rejects HTTP and malformed JSON responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Forbidden", { status: 403 }))
    );
    await expect(getLeaderboard(config, createBudget())).rejects.toMatchObject({ code: "HTTP" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{", { headers: { "content-type": "application/json" } }))
    );
    await expect(getLeaderboard(config, createBudget())).rejects.toMatchObject({
      code: "RESPONSE",
    });
  });
  it("preserves typed budget exhaustion without probing other providers", async () => {
    const budget = createBudget();
    budget.exhaust();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(selectProvider(config, budget)).rejects.toBeInstanceOf(subrequestBudgetExhausted);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("never routes a game mode to the CP provider", async () => {
    await expect(
      getLeaderboard({ ...config, lbType: "nightmare" }, createBudget())
    ).rejects.toThrow(/game-mode/);
    await expect(
      selectProvider({ ...config, forceProvider: "Official AION 2" }, createBudget())
    ).rejects.toThrow(/population/);
  });
});

describe("region-specific official character URLs", () => {
  it.each([
    ["Global", "GLOBAL"],
    ["kr", "KR"],
    ["Korea", "KR"],
    ["Taiwan", "TW"],
  ])("normalizes %s", (value, expected) => expect(normalizeRegion(value)).toBe(expected));
  it("does not treat unknown/all regions as Korea", () => {
    expect(normalizeRegion("all")).toBeNull();
    expect(normalizeRegion("EU")).toBeNull();
  });
  it("keeps Global language/subregion and Taiwan host separate", () => {
    const global = new URL(
      characterApiUrl({ region: "GLOBAL", serverId: 2301, characterId: "id+=" }, "info")
    );
    expect(global.searchParams.get("region")).toBe("eu");
    expect(global.searchParams.get("lang")).toBe("en-US");
    expect(global.searchParams.get("characterId")).toBe("id+=");
    const tw = new URL(
      characterApiUrl({ region: "TW", serverId: 1001, characterId: "id+=" }, "info")
    );
    expect(tw.origin).toBe("https://tw.ncsoft.com");
    expect(tw.pathname).toBe("/aion2/api/character/info");
    expect(tw.searchParams.has("region")).toBe(false);
    const kr = new URL(
      characterApiUrl({ region: "KR", serverId: 1001, characterId: "id+=" }, "info")
    );
    expect(kr.searchParams.get("lang")).toBe("en");
    expect(kr.searchParams.has("region")).toBe(false);
  });
});
