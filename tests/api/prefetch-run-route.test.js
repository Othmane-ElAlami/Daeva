// ─────────────────────────────────────────────────────────────────────────────
// Tests for app/api/prefetch/run/route.js
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@cloudflare/next-on-pages", () => ({ getRequestContext: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({
  validateAdminRequest: vi.fn(),
  unauthorizedResponse: vi.fn(() => new Response("Unauthorized", { status: 401 })),
}));
vi.mock("@/lib/prefetch/runner", () => ({ runPrefetchJob: vi.fn() }));
vi.mock("@/lib/prefetch/cache", () => ({
  getPrefetchCache: vi.fn(),
  setPrefetchCache: vi.fn(),
  getAllPrefetchEntries: vi.fn(),
  clearPrefetchCache: vi.fn(),
}));
// scraper-shared must NOT be mocked — the route uses its constants for validation
vi.mock("@/lib/scraper-shared", async (importOriginal) => {
  return await importOriginal();
});

import { getRequestContext } from "@cloudflare/next-on-pages";
import { validateAdminRequest } from "@/lib/admin-auth";
import { runPrefetchJob } from "@/lib/prefetch/runner";
import { getPrefetchCache, setPrefetchCache } from "@/lib/prefetch/cache";
import { POST } from "../../app/api/prefetch/run/route.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeDb() {
  const stmt = { bind: vi.fn().mockReturnThis(), run: vi.fn().mockResolvedValue({}) };
  return { prepare: vi.fn().mockReturnValue(stmt) };
}

function req(body) {
  return new Request("http://test/api/prefetch/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const SUCCESS_RESULT = {
  builds: [{ name: "A" }],
  stats: { total: 1 },
  playerCount: 1,
  errors: [],
  budgetUsed: 50,
};

afterEach(() => vi.unstubAllEnvs());

beforeEach(() => {
  vi.stubEnv("LEADERBOARD_SOURCE_MODE", "mode-specific");
  vi.clearAllMocks();
  getRequestContext.mockReturnValue({ env: { DB: makeDb() } });
  validateAdminRequest.mockResolvedValue({ authorized: true });
  runPrefetchJob.mockResolvedValue(SUCCESS_RESULT);
  setPrefetchCache.mockResolvedValue();
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/prefetch/run — auth & gating", () => {
  it("returns 401 when not authorized", async () => {
    validateAdminRequest.mockResolvedValue({ authorized: false });
    expect((await POST(req({ cls: "gladiator", leaderboard: "nightmare" }))).status).toBe(401);
  });

  it("returns 503 when PREFETCH_ENABLED=false", async () => {
    process.env.PREFETCH_ENABLED = "false";
    try {
      expect((await POST(req({ cls: "gladiator", leaderboard: "nightmare" }))).status).toBe(503);
    } finally {
      delete process.env.PREFETCH_ENABLED;
    }
  });
});

describe("POST /api/prefetch/run — input validation", () => {
  it("returns 400 for invalid class", async () => {
    const res = await POST(req({ cls: "invalid_class", leaderboard: "nightmare" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid class/i);
  });

  it("returns 400 for invalid leaderboard", async () => {
    const res = await POST(req({ cls: "gladiator", leaderboard: "fake_lb" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid leaderboard/i);
  });

  it("returns 400 for malformed JSON body", async () => {
    const res = await POST(
      new Request("http://test/api/prefetch/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when class is missing", async () => {
    const res = await POST(req({ leaderboard: "nightmare" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when leaderboard is missing", async () => {
    const res = await POST(req({ cls: "gladiator" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/prefetch/run — happy path", () => {
  it("runs job, stores cache, returns success payload", async () => {
    const res = await POST(req({ cls: "gladiator", leaderboard: "nightmare" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.class).toBe("gladiator");
    expect(body.leaderboard).toBe("nightmare");
    expect(body.playerCount).toBe(1);
    expect(body.budgetUsed).toBe(50);
    expect(typeof body.durationMs).toBe("number");
    expect(body.errorCount).toBe(0);
    expect(setPrefetchCache).toHaveBeenCalledOnce();
  });

  it("passes correct TTL derived from PREFETCH_CACHE_TTL_MINUTES", async () => {
    process.env.PREFETCH_CACHE_TTL_MINUTES = "60";
    try {
      await POST(req({ cls: "gladiator", leaderboard: "nightmare" }));
      // setPrefetchCache(db, cls, leaderboard, stats, builds, ttlMs)
      const callArgs = setPrefetchCache.mock.calls[0];
      expect(callArgs[5]).toBe(60 * 60_000);
    } finally {
      delete process.env.PREFETCH_CACHE_TTL_MINUTES;
    }
  });

  it("accepts any valid class and leaderboard combination", async () => {
    const res = await POST(req({ cls: "chanter", leaderboard: "abyss" }));
    expect(res.status).toBe(200);
    expect((await res.json()).class).toBe("chanter");
  });
});

describe("POST /api/prefetch/run — edge cases", () => {
  it("skips recently refreshed populations without fetching upstream", async () => {
    getPrefetchCache.mockResolvedValueOnce({
      fetchedAt: Date.now(),
      builds: SUCCESS_RESULT.builds,
    });
    const res = await POST(req({ cls: "gladiator", leaderboard: "nightmare" }));
    expect((await res.json()).skipped).toBe(true);
    expect(runPrefetchJob).not.toHaveBeenCalled();
  });

  it("refuses mode-specific jobs during temporary CP mode", async () => {
    vi.stubEnv("LEADERBOARD_SOURCE_MODE", "combat-power");
    expect((await POST(req({ cls: "chanter", leaderboard: "nightmare" }))).status).toBe(503);
    expect(runPrefetchJob).not.toHaveBeenCalled();
  });
  it.each([
    [3, 4000, undefined, false],
    [100, 4000, undefined, true],
    [7, 7, undefined, true],
    [100, 4000, "partial", false],
  ])(
    "refresh guard handles %s builds from a %s-player CP pool (%s)",
    async (count, total, buildHealth, skipped) => {
      vi.stubEnv("LEADERBOARD_SOURCE_MODE", "combat-power");
      getPrefetchCache.mockResolvedValueOnce({
        fetchedAt: Date.now(),
        source: "Shugo Combat Power",
        builds: Array.from({ length: count }, () => SUCCESS_RESULT.builds[0]),
        data: { sourceMeta: { total, buildHealth } },
      });
      const body = await (
        await POST(req({ cls: "chanter", leaderboard: "combat-power", region: "GLOBAL" }))
      ).json();
      expect(!!body.skipped).toBe(skipped);
      expect(runPrefetchJob.mock.calls.length).toBe(skipped ? 0 : 1);
    }
  );

  it("stores CP builds under their region and source", async () => {
    vi.stubEnv("LEADERBOARD_SOURCE_MODE", "combat-power");
    const res = await POST(req({ cls: "chanter", leaderboard: "combat-power", region: "TW" }));
    expect(res.status).toBe(200);
    expect(runPrefetchJob).toHaveBeenCalledWith(
      "chanter",
      "combat-power",
      expect.anything(),
      expect.objectContaining({ region: "TW", sourceMode: "combat-power" })
    );
    expect(setPrefetchCache.mock.calls[0].slice(6)).toEqual(["Shugo Combat Power", "TW"]);
  });

  it("does not publish or re-stamp a partially continued prefetch", async () => {
    runPrefetchJob.mockResolvedValueOnce({
      ...SUCCESS_RESULT,
      continuation: { processedCount: 1, players: [] },
    });
    const body = await (await POST(req({ cls: "chanter", leaderboard: "nightmare" }))).json();
    expect(body.continuation.processedCount).toBe(1);
    expect(setPrefetchCache).not.toHaveBeenCalled();
  });

  it("skips cache write when no builds returned", async () => {
    runPrefetchJob.mockResolvedValue({
      builds: [],
      stats: null,
      playerCount: 0,
      errors: [],
      budgetUsed: 5,
    });
    const res = await POST(req({ cls: "gladiator", leaderboard: "nightmare" }));
    expect(res.status).toBe(200);
    expect(setPrefetchCache).not.toHaveBeenCalled();
  });

  it("returns 500 and error message when runner throws", async () => {
    runPrefetchJob.mockRejectedValue(new Error("upstream timeout"));
    const res = await POST(req({ cls: "gladiator", leaderboard: "nightmare" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("upstream timeout");
    expect(typeof body.durationMs).toBe("number");
  });

  it("includes up to 10 errors in response", async () => {
    const manyErrors = Array.from({ length: 15 }, (_, i) => `Error ${i}`);
    runPrefetchJob.mockResolvedValue({ ...SUCCESS_RESULT, errors: manyErrors });
    const res = await POST(req({ cls: "gladiator", leaderboard: "nightmare" }));
    const body = await res.json();
    expect(body.errors.length).toBeLessThanOrEqual(10);
    expect(body.errorCount).toBe(15);
  });
});
