import { afterEach, describe, expect, it, vi } from "vitest";
import { runCombatPowerPrefetch } from "../scripts/prefetch-combat-power.mjs";

const player = {
  characterId: "sample",
  serverId: 2301,
  region: "GLOBAL",
  class: "chanter",
  source: "Shugo Combat Power",
};
const continuation = { players: [player], processedCount: 0, refreshToken: "test-lease" };
const baseResponse = {
  success: true,
  class: "chanter",
  region: "GLOBAL",
  leaderboard: "combat-power",
  errorCount: 0,
};
const options = {
  apiUrl: "http://localhost",
  secret: "test-secret",
  cls: "chanter",
  region: "GLOBAL",
  wait: async () => {},
  log: () => {},
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("scheduled Combat Power runner", () => {
  it("recovers a discovery outage after bounded waits without repeating enrichment", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          {
            code: "UPSTREAM_UNAVAILABLE",
            error: "All leaderboard providers failed: Combat Power HTTP 503.",
          },
          { status: 503 }
        )
      )
      .mockResolvedValueOnce(
        Response.json(
          {
            code: "UPSTREAM_UNAVAILABLE",
            error: "All leaderboard providers failed: Combat Power HTTP 503.",
          },
          { status: 503 }
        )
      )
      .mockResolvedValueOnce(
        Response.json({ ...baseResponse, playerCount: 0, continuation, enrichPlayer: player })
      )
      .mockResolvedValueOnce(Response.json({ ...baseResponse, playerCount: 1, complete: true }));
    const wait = vi.fn(async () => {});
    const log = vi.fn();
    const enrich = vi.fn(async () => ({ build: { characterId: "sample" }, warnings: [] }));
    expect(await runCombatPowerPrefetch({ ...options, request, wait, log, enrich })).toMatchObject({
      complete: true,
      enrichedCount: 1,
    });
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([30000, 60000]);
    expect(enrich).toHaveBeenCalledOnce();
    expect(
      request.mock.calls
        .slice(0, 3)
        .every(([, init]) => init.body === request.mock.calls[0][1].body)
    ).toBe(true);
    expect(log.mock.calls.flat().join(" ")).toContain("Combat Power HTTP 503");
  });
  it("fails persistent discovery unavailability with bounded, redacted diagnostic details", async () => {
    const request = vi.fn(async () =>
      Response.json(
        {
          code: "UPSTREAM_UNAVAILABLE",
          error: `All leaderboard providers failed: Combat Power HTTP 503. ${options.secret}\n::error::upstream`,
        },
        { status: 503 }
      )
    );
    const wait = vi.fn(async () => {});
    const log = vi.fn();
    const enrich = vi.fn();
    await expect(
      runCombatPowerPrefetch({ ...options, request, wait, log, enrich })
    ).rejects.toThrow("Combat Power HTTP 503");
    expect(request).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([30000, 60000]);
    expect(enrich).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join(" ")).not.toContain(options.secret);
    expect(log.mock.calls.flat().join(" ")).not.toContain("\n");
    expect(log.mock.calls.flat().join(" ")).toContain("[redacted]");
  });
  it("accepts the handoff from a cached checkpoint to the next uncached build", async () => {
    const checkpoint = { ...continuation, processedCount: 5 };
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ ...baseResponse, playerCount: 5, continuation: checkpoint })
      )
      .mockResolvedValueOnce(
        Response.json({
          ...baseResponse,
          playerCount: 5,
          continuation: checkpoint,
          enrichPlayer: player,
        })
      )
      .mockResolvedValueOnce(Response.json({ ...baseResponse, playerCount: 6, complete: true }));
    const enrich = vi.fn(async () => ({ build: { characterId: "sample" }, warnings: [] }));
    expect(await runCombatPowerPrefetch({ ...options, request, enrich })).toMatchObject({
      complete: true,
      buildCount: 6,
      enrichedCount: 1,
      requests: 3,
    });
    expect(enrich).toHaveBeenCalledOnce();
    expect(JSON.parse(request.mock.calls[2][1].body).enrichedBuild.characterId).toBe("sample");
  });
  it.each(["checkpoint", "unaccepted-upload"])(
    "still rejects a repeated %s without progress",
    async (stage) => {
      const response = {
        ...baseResponse,
        playerCount: 5,
        continuation: { ...continuation, processedCount: 5 },
        ...(stage === "unaccepted-upload" ? { enrichPlayer: player } : {}),
      };
      const request = vi.fn(async (_url, init) =>
        JSON.parse(init.body).failed
          ? Response.json({ code: "ENRICHMENT_FAILED" }, { status: 502 })
          : Response.json(response)
      );
      const enrich = vi.fn(async () => ({ build: { characterId: "sample" }, warnings: [] }));
      await expect(runCombatPowerPrefetch({ ...options, request, enrich })).rejects.toThrow(
        "no progress"
      );
      expect(enrich).toHaveBeenCalledTimes(stage === "unaccepted-upload" ? 1 : 0);
    }
  );
  it("heartbeats through upstream backoff and uploads the same player's completed build", async () => {
    vi.useFakeTimers();
    const request = vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.heartbeat)
        return Response.json({ ...baseResponse, heartbeat: true, playerCount: 0, continuation });
      if (body.enrichedBuild)
        return Response.json({ ...baseResponse, complete: true, playerCount: 1 });
      return Response.json({ ...baseResponse, playerCount: 0, continuation, enrichPlayer: player });
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response("limited", {
            status: 429,
            headers: { "Retry-After": "65" },
          })
        )
        .mockResolvedValue(Response.json({ id: 1 }))
    );
    const enrich = vi.fn(async (_player, _db, budget, config) => {
      await config.requestJSON("https://aion2.plaync.com/item", {}, "GET", null, budget);
      return { build: { characterId: "sample" }, warnings: [] };
    });
    const result = runCombatPowerPrefetch({ ...options, request, enrich });
    const check = expect(result).resolves.toMatchObject({
      complete: true,
      enrichedCount: 1,
      upstreamRetries: 1,
      rateLimits: 1,
    });
    await vi.advanceTimersByTimeAsync(90000);
    await check;
    expect(enrich).toHaveBeenCalledOnce();
    const bodies = request.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(bodies.filter((body) => body.heartbeat)).toHaveLength(1);
    expect(bodies.filter((body) => !body.heartbeat && !body.enrichedBuild)).toHaveLength(1);
    expect(bodies.at(-1).enrichedBuild).toEqual({ characterId: "sample" });
  });
  it("retries a transient invalid official profile once without rediscovering the population", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ ...baseResponse, playerCount: 0, continuation, enrichPlayer: player })
      )
      .mockResolvedValueOnce(Response.json({ ...baseResponse, playerCount: 1, complete: true }));
    const enrich = vi
      .fn()
      .mockRejectedValueOnce(new Error("Official profile identifiers do not match discovery."))
      .mockResolvedValueOnce({ build: { characterId: "sample" }, warnings: [] });
    expect(await runCombatPowerPrefetch({ ...options, request, enrich })).toMatchObject({
      complete: true,
      enrichedCount: 1,
    });
    expect(enrich).toHaveBeenCalledTimes(2);
    expect(JSON.parse(request.mock.calls[1][1].body)).toMatchObject({
      enrichedBuild: { characterId: "sample" },
      execution: "runner",
    });
  });
  it.each(["items", "equipment-refresh"])(
    "never uploads an incomplete %s result or repeats enrichment",
    async (failure) => {
      const request = vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ ...baseResponse, playerCount: 0, continuation, enrichPlayer: player })
        )
        .mockResolvedValueOnce(Response.json({ code: "ENRICHMENT_FAILED" }, { status: 502 }));
      const enrich = vi.fn(async () => {
        if (failure === "equipment-refresh") {
          const error = new Error("Item details unavailable after incomplete equipment refresh.");
          error.code = "EQUIPMENT_REFRESH_FAILED";
          throw error;
        }
        return { build: { characterId: "sample" }, warnings: ["Item details unavailable"] };
      });
      await expect(runCombatPowerPrefetch({ ...options, request, enrich })).rejects.toThrow(
        "incomplete"
      );
      expect(enrich).toHaveBeenCalledTimes(1);
      expect(JSON.parse(request.mock.calls[1][1].body)).toMatchObject({
        failed: true,
        continuation,
      });
      expect(JSON.parse(request.mock.calls[1][1].body).failure).toMatchObject({
        phase: "enrichment",
        message: expect.stringContaining("Item details unavailable"),
      });
      expect(JSON.parse(request.mock.calls[1][1].body).enrichedBuild).toBeUndefined();
    }
  );
  it.each(["missing-item", "schema", "rate-limit", "proxy-rate-limit"])(
    "only backfills a confirmed unavailable character (%s)",
    async (failure) => {
      const skippable = ["missing-item", "schema"].includes(failure);
      const replacement = { ...player, characterId: "replacement" };
      const omitted = [{ ...player, code: "ITEM_UNAVAILABLE", preparedBuildCount: 0 }];
      const request = vi.fn(async (_url, init) => {
        const body = JSON.parse(init.body);
        if (body.failed) return Response.json({ code: "ENRICHMENT_FAILED" }, { status: 502 });
        if (body.unavailable)
          return Response.json({
            ...baseResponse,
            playerCount: 0,
            sourceMeta: { unavailablePlayers: omitted },
            continuation: {
              ...continuation,
              players: [replacement],
              sourceMeta: { unavailablePlayers: omitted },
            },
            enrichPlayer: replacement,
          });
        if (body.enrichedBuild)
          return Response.json({
            ...baseResponse,
            playerCount: 1,
            complete: true,
            sourceMeta: { unavailablePlayers: omitted },
          });
        return Response.json({
          ...baseResponse,
          playerCount: 0,
          continuation,
          enrichPlayer: player,
        });
      });
      const enrich = vi.fn(async (target) => {
        if (target.characterId === "replacement")
          return { build: { characterId: target.characterId }, warnings: [] };
        const error = new Error("Official item unavailable");
        if (failure === "schema") error.code = "ITEM_UNAVAILABLE";
        else error.status = failure === "rate-limit" ? 429 : 404;
        if (failure === "proxy-rate-limit") error.officialFailure = { status: 429 };
        return {
          build: { characterId: "sample" },
          warnings: [error.message],
          itemFailures: [error],
        };
      });
      const run = runCombatPowerPrefetch({ ...options, request, enrich });
      if (skippable) {
        expect(await run).toMatchObject({
          complete: true,
          buildCount: 1,
          enrichedCount: 1,
          unavailableCount: 1,
        });
        expect(enrich).toHaveBeenCalledTimes(2);
      } else {
        await expect(run).rejects.toThrow("incomplete");
        expect(enrich).toHaveBeenCalledOnce();
      }
      const bodies = request.mock.calls.map(([, init]) => JSON.parse(init.body));
      expect(bodies.filter((body) => body.unavailable)).toHaveLength(skippable ? 1 : 0);
      expect(bodies.filter((body) => body.enrichedBuild?.characterId === "sample")).toHaveLength(0);
    }
  );
  it("enables bounded gear-change recovery without rediscovery and logs successful recovery", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ ...baseResponse, playerCount: 0, continuation, enrichPlayer: player })
      )
      .mockResolvedValueOnce(Response.json({ ...baseResponse, playerCount: 1, complete: true }));
    const enrich = vi.fn(async () => ({
      build: { characterId: "sample" },
      warnings: [],
      equipmentRefreshed: true,
    }));
    const log = vi.fn();
    expect(await runCombatPowerPrefetch({ ...options, request, enrich, log })).toMatchObject({
      complete: true,
      enrichedCount: 1,
    });
    expect(enrich).toHaveBeenCalledOnce();
    expect(enrich.mock.calls[0][3]).toEqual({
      retryItemDetails: true,
      retryEquipmentChanges: true,
      itemConcurrency: 4,
      requestJSON: expect.any(Function),
    });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("refreshed changed equipment"));
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("rejects repeated platform errors and malformed success bodies after bounded retries", async () => {
    const request = vi.fn(
      async () => new Response(`error code: 1102 ${options.secret}`, { status: 503 })
    );
    const log = vi.fn();
    await expect(runCombatPowerPrefetch({ ...options, request, log })).rejects.toThrow(
      "HTTP 503, Cloudflare 1102"
    );
    expect(request).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls.flat().join(" ")).not.toContain(options.secret);
    await expect(
      runCombatPowerPrefetch({ ...options, request: async () => Response.json({}) })
    ).rejects.toThrow("invalid population");
  });
  it("retries an upload without repeating enrichment and redacts failure credentials", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ ...baseResponse, playerCount: 0, continuation, enrichPlayer: player })
      )
      .mockRejectedValueOnce(new Error(options.secret))
      .mockResolvedValueOnce(Response.json({ ...baseResponse, playerCount: 1, complete: true }));
    const enrich = vi.fn(async () => ({ build: { characterId: "sample" }, warnings: [] }));
    const log = vi.fn();
    expect(await runCombatPowerPrefetch({ ...options, request, enrich, log })).toMatchObject({
      complete: true,
    });
    expect(enrich).toHaveBeenCalledOnce();
    expect(request.mock.calls[1][1].body).toBe(request.mock.calls[2][1].body);
    expect(log.mock.calls.flat().join(" ")).not.toContain(options.secret);
    const failing = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ ...baseResponse, playerCount: 0, continuation, enrichPlayer: player })
      )
      .mockResolvedValueOnce(Response.json({ code: "ENRICHMENT_FAILED" }, { status: 502 }));
    let problem;
    try {
      await runCombatPowerPrefetch({
        ...options,
        request: failing,
        enrich: async () => {
          throw new Error(`Official failure ${options.secret}`);
        },
      });
    } catch (error) {
      problem = error;
    }
    expect(problem.message).toContain("[redacted]");
    expect(problem.message).not.toContain(options.secret);
    expect(JSON.parse(failing.mock.calls[1][1].body).failure.message).toContain("[redacted]");
  });
});
