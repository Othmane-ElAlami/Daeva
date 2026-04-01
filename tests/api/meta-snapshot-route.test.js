// ─────────────────────────────────────────────────────────────────────────────
// Tests for app/api/meta-snapshot/route.js
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@cloudflare/next-on-pages", () => ({
  getRequestContext: vi.fn(),
}));

describe("GET /api/meta-snapshot", () => {
  let getRequestContext;

  beforeEach(async () => {
    const cfModule = await import("@cloudflare/next-on-pages");
    getRequestContext = cfModule.getRequestContext;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns snapshots with parsed JSON fields", async () => {
    const mockResults = [
      {
        class: "chanter",
        leaderboard: "nightmare",
        total_players: 50,
        stigma_skills: JSON.stringify([{ name: "Skill A", count: 10 }]),
        active_skills: JSON.stringify([{ name: "Active A" }]),
        passive_skills: JSON.stringify([{ name: "Passive A" }]),
        arcana_set_combos: JSON.stringify([{ combo: "Pure Blood(4)" }]),
        updated_at: 1711872000000,
      },
    ];

    getRequestContext.mockReturnValue({
      env: {
        DB: {
          prepare: vi.fn(() => ({
            all: vi.fn(async () => ({ results: mockResults })),
          })),
        },
      },
    });

    const { GET } = await import("../../app/api/meta-snapshot/route.js");
    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.snapshots).toHaveLength(1);
    expect(body.snapshots[0].className).toBe("chanter");
    expect(body.snapshots[0].leaderboard).toBe("nightmare");
    expect(body.snapshots[0].totalPlayers).toBe(50);
    expect(body.snapshots[0].stigmaSkills).toEqual([{ name: "Skill A", count: 10 }]);
    expect(body.snapshots[0].activeSkills).toEqual([{ name: "Active A" }]);
    expect(body.snapshots[0].passiveSkills).toEqual([{ name: "Passive A" }]);
    expect(body.snapshots[0].arcanaSetCombos).toEqual([{ combo: "Pure Blood(4)" }]);
    expect(body.snapshots[0].updatedAt).toBe(1711872000000);
  });

  it("returns empty array when no snapshots exist", async () => {
    getRequestContext.mockReturnValue({
      env: {
        DB: {
          prepare: vi.fn(() => ({
            all: vi.fn(async () => ({ results: [] })),
          })),
        },
      },
    });

    const { GET } = await import("../../app/api/meta-snapshot/route.js");
    const res = await GET();
    const body = await res.json();
    expect(body.snapshots).toEqual([]);
  });

  it("returns empty array when table doesn't exist", async () => {
    getRequestContext.mockReturnValue({
      env: {
        DB: {
          prepare: vi.fn(() => ({
            all: vi.fn(async () => {
              throw new Error("no such table: meta_snapshots");
            }),
          })),
        },
      },
    });

    const { GET } = await import("../../app/api/meta-snapshot/route.js");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.snapshots).toEqual([]);
  });

  it("returns 500 for non-table-missing DB errors", async () => {
    getRequestContext.mockReturnValue({
      env: {
        DB: {
          prepare: vi.fn(() => ({
            all: vi.fn(async () => {
              throw new Error("Connection refused");
            }),
          })),
        },
      },
    });

    const { GET } = await import("../../app/api/meta-snapshot/route.js");
    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("sets appropriate cache headers", async () => {
    getRequestContext.mockReturnValue({
      env: {
        DB: {
          prepare: vi.fn(() => ({
            all: vi.fn(async () => ({ results: [] })),
          })),
        },
      },
    });

    const { GET } = await import("../../app/api/meta-snapshot/route.js");
    const res = await GET();
    const cacheControl = res.headers.get("Cache-Control");
    expect(cacheControl).toContain("max-age=300");
  });

  it("returns Content-Type application/json", async () => {
    getRequestContext.mockReturnValue({
      env: {
        DB: {
          prepare: vi.fn(() => ({
            all: vi.fn(async () => ({ results: [] })),
          })),
        },
      },
    });

    const { GET } = await import("../../app/api/meta-snapshot/route.js");
    const res = await GET();
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });
});
