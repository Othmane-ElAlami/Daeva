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
  it("never uploads builds with missing official item details", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ ...baseResponse, playerCount: 0, continuation, enrichPlayer: player })
      )
      .mockResolvedValueOnce(Response.json({ code: "ENRICHMENT_FAILED" }, { status: 502 }));
    const enrich = vi.fn(async () => ({
      build: { characterId: "sample" },
      warnings: ["Item details unavailable"],
    }));
    await expect(runCombatPowerPrefetch({ ...options, request, enrich })).rejects.toThrow(
      "incomplete"
    );
    expect(enrich).toHaveBeenCalledTimes(2);
    expect(JSON.parse(request.mock.calls[1][1].body)).toMatchObject({ failed: true, continuation });
    expect(JSON.parse(request.mock.calls[1][1].body).enrichedBuild).toBeUndefined();
  });
  it("rejects repeated platform errors and malformed success bodies after bounded retries", async () => {
    const request = vi.fn(async () => new Response("error code: 1102", { status: 503 }));
    const log = vi.fn();
    await expect(runCombatPowerPrefetch({ ...options, request, log })).rejects.toThrow(
      "unavailable or malformed"
    );
    expect(request).toHaveBeenCalledTimes(3);
    expect(log).not.toHaveBeenCalled();
    await expect(
      runCombatPowerPrefetch({ ...options, request: async () => Response.json({}) })
    ).rejects.toThrow("invalid population");
  });
});
