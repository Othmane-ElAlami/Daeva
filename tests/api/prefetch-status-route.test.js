// ─────────────────────────────────────────────────────────────────────────────
// Tests for app/api/prefetch/status/route.js
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@cloudflare/next-on-pages", () => ({ getRequestContext: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({
  validateAdminRequest: vi.fn(),
  unauthorizedResponse: vi.fn(() => new Response("Unauthorized", { status: 401 })),
}));
vi.mock("@/lib/prefetch/cache", () => ({
  getPrefetchCache: vi.fn(),
  setPrefetchCache: vi.fn(),
  getAllPrefetchEntries: vi.fn(),
  clearPrefetchCache: vi.fn(),
}));

import { getRequestContext } from "@cloudflare/next-on-pages";
import { validateAdminRequest } from "@/lib/admin-auth";
import { getAllPrefetchEntries } from "@/lib/prefetch/cache";
import { GET } from "../../app/api/prefetch/status/route.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeDb() {
  const stmt = { bind: vi.fn().mockReturnThis(), all: vi.fn().mockResolvedValue({ results: [] }) };
  return { prepare: vi.fn().mockReturnValue(stmt) };
}

function statusRequest() {
  return new Request("http://test/api/prefetch/status");
}

const now = Date.now();
const FAKE_ENTRIES = [
  {
    class: "gladiator",
    leaderboard: "nightmare",
    fetchedAt: now - 5000,
    expiresAt: now + 60_000,
    source: "prefetch",
    isExpired: false,
    ageMinutes: 0,
  },
  {
    class: "cleric",
    leaderboard: "abyss",
    fetchedAt: now - 9_000_000,
    expiresAt: now - 1000,
    source: "prefetch",
    isExpired: true,
    ageMinutes: 150,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  getRequestContext.mockReturnValue({ env: { DB: makeDb() } });
  validateAdminRequest.mockResolvedValue({ authorized: true });
  getAllPrefetchEntries.mockResolvedValue(FAKE_ENTRIES);
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/prefetch/status — auth", () => {
  it("returns 401 when not authorized", async () => {
    validateAdminRequest.mockResolvedValue({ authorized: false });
    expect((await GET(statusRequest())).status).toBe(401);
  });
});

describe("GET /api/prefetch/status — response shape", () => {
  it("returns 200 with required fields", async () => {
    const res = await GET(statusRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.enabled).toBe("boolean");
    expect(typeof body.cacheTtlMinutes).toBe("number");
    expect(typeof body.totalCombinations).toBe("number");
    expect(typeof body.cachedCombinations).toBe("number");
    expect(typeof body.freshEntries).toBe("number");
    expect(typeof body.staleEntries).toBe("number");
    expect(typeof body.coveragePercent).toBe("number");
    expect(Array.isArray(body.entries)).toBe(true);
  });

  it("totalCombinations equals classes × leaderboard types (56)", async () => {
    const res = await GET(statusRequest());
    const body = await res.json();
    // 8 classes × 7 leaderboard types = 56
    expect(body.totalCombinations).toBe(56);
  });

  it("counts fresh and stale entries correctly", async () => {
    const res = await GET(statusRequest());
    const body = await res.json();
    expect(body.cachedCombinations).toBe(2);
    expect(body.freshEntries).toBe(1);
    expect(body.staleEntries).toBe(1);
  });

  it("coveragePercent = cached / total × 100", async () => {
    const res = await GET(statusRequest());
    const body = await res.json();
    expect(body.coveragePercent).toBeCloseTo((2 / 56) * 100, 0);
  });

  it("returns Cache-Control: no-store header", async () => {
    const res = await GET(statusRequest());
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("reflects PREFETCH_ENABLED=false", async () => {
    process.env.PREFETCH_ENABLED = "false";
    try {
      const body = await (await GET(statusRequest())).json();
      expect(body.enabled).toBe(false);
    } finally {
      delete process.env.PREFETCH_ENABLED;
    }
  });

  it("returns coveragePercent=0 when cache is empty", async () => {
    getAllPrefetchEntries.mockResolvedValue([]);
    const body = await (await GET(statusRequest())).json();
    expect(body.coveragePercent).toBe(0);
    expect(body.cachedCombinations).toBe(0);
    expect(body.freshEntries).toBe(0);
    expect(body.staleEntries).toBe(0);
  });
});

describe("GET /api/prefetch/status — error handling", () => {
  it("returns 500 when D1 throws", async () => {
    getAllPrefetchEntries.mockRejectedValue(new Error("D1 failed"));
    const res = await GET(statusRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});
