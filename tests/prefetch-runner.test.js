import { describe, expect, it, vi } from "vitest";
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

describe("scheduled Combat Power runner", () => {
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
