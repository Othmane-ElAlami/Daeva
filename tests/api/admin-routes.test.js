// ─────────────────────────────────────────────────────────────────────────────
// Tests for app/api/admin/*.js routes
// Covers: tables, table-data, reset
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@cloudflare/next-on-pages", () => ({
  getRequestContext: vi.fn(),
}));

describe("Admin API Routes", () => {
  let getRequestContext;

  beforeEach(async () => {
    const cfModule = await import("@cloudflare/next-on-pages");
    getRequestContext = cfModule.getRequestContext;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── GET /api/admin/tables ───────────────────────────────────────────────

  describe("GET /api/admin/tables", () => {
    it("returns list of tables with row counts and columns", async () => {
      const mockDb = {
        prepare: vi.fn((query) => {
          if (query.includes("sqlite_master")) {
            return {
              all: vi.fn(async () => ({
                results: [{ name: "player_cache" }, { name: "rate_limits" }],
              })),
            };
          }
          if (query.includes("COUNT(*)")) {
            return {
              first: vi.fn(async () => ({ count: 42 })),
            };
          }
          if (query.includes("PRAGMA")) {
            return {
              all: vi.fn(async () => ({
                results: [
                  { name: "id", type: "TEXT", pk: 1 },
                  { name: "data", type: "TEXT", pk: 0 },
                ],
              })),
            };
          }
          return { all: vi.fn(async () => ({ results: [] })) };
        }),
      };

      getRequestContext.mockReturnValue({ env: { DB: mockDb } });

      const { GET } = await import("../../app/api/admin/tables/route.js");
      const res = await GET();
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.tables).toHaveLength(2);
      expect(body.tables[0].name).toBe("player_cache");
      expect(body.tables[0].rowCount).toBe(42);
      expect(body.tables[0].columns).toHaveLength(2);
      expect(body.tables[0].columns[0].name).toBe("id");
      expect(body.tables[0].columns[0].pk).toBe(true);
    });

    it("returns empty array when no tables exist", async () => {
      getRequestContext.mockReturnValue({
        env: {
          DB: {
            prepare: vi.fn(() => ({
              all: vi.fn(async () => ({ results: [] })),
            })),
          },
        },
      });

      const { GET } = await import("../../app/api/admin/tables/route.js");
      const res = await GET();
      const body = await res.json();
      expect(body.tables).toEqual([]);
    });

    it("returns 500 on database error", async () => {
      getRequestContext.mockReturnValue({
        env: {
          DB: {
            prepare: vi.fn(() => ({
              all: vi.fn(async () => {
                throw new Error("DB failure");
              }),
            })),
          },
        },
      });

      const { GET } = await import("../../app/api/admin/tables/route.js");
      const res = await GET();
      expect(res.status).toBe(500);
    });
  });

  // ─── GET /api/admin/table-data ───────────────────────────────────────────

  describe("GET /api/admin/table-data", () => {
    it("returns 400 when table parameter is missing", async () => {
      getRequestContext.mockReturnValue({
        env: { DB: { prepare: vi.fn() } },
      });

      const { GET } = await import("../../app/api/admin/table-data/route.js");
      const req = new Request("http://localhost/api/admin/table-data");
      const res = await GET(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("table");
    });

    it("returns 404 for non-existent table", async () => {
      const mockDb = {
        prepare: vi.fn(() => ({
          bind: vi.fn(function () {
            return this;
          }),
          all: vi.fn(async () => ({ results: [] })),
        })),
      };

      getRequestContext.mockReturnValue({ env: { DB: mockDb } });

      const { GET } = await import("../../app/api/admin/table-data/route.js");
      const req = new Request("http://localhost/api/admin/table-data?table=nonexistent");
      const res = await GET(req);
      expect(res.status).toBe(404);
    });

    it("returns table data for valid table", async () => {
      const mockDb = {
        prepare: vi.fn((query) => {
          if (query.includes("sqlite_master")) {
            return {
              bind: vi.fn(function () {
                return this;
              }),
              all: vi.fn(async () => ({
                results: [{ name: "player_cache" }],
              })),
            };
          }
          if (query.includes("SELECT *")) {
            return {
              all: vi.fn(async () => ({
                results: [
                  { character_id: "c1", server_id: "1001" },
                  { character_id: "c2", server_id: "1002" },
                ],
              })),
            };
          }
          return { all: vi.fn(async () => ({ results: [] })) };
        }),
      };

      getRequestContext.mockReturnValue({ env: { DB: mockDb } });

      const { GET } = await import("../../app/api/admin/table-data/route.js");
      const req = new Request("http://localhost/api/admin/table-data?table=player_cache");
      const res = await GET(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.rows).toHaveLength(2);
    });

    it("validates table name against sqlite_master (prevents SQL injection)", async () => {
      const mockDb = {
        prepare: vi.fn(() => ({
          bind: vi.fn(function () {
            return this;
          }),
          all: vi.fn(async () => ({ results: [] })),
        })),
      };

      getRequestContext.mockReturnValue({ env: { DB: mockDb } });

      const { GET } = await import("../../app/api/admin/table-data/route.js");
      const req = new Request(
        `http://localhost/api/admin/table-data?table=${encodeURIComponent("'; DROP TABLE --")}`
      );
      const res = await GET(req);
      // Should return 404 since malicious table name won't match sqlite_master
      expect(res.status).toBe(404);
    });
  });

  // ─── POST /api/admin/reset ───────────────────────────────────────────────

  describe("POST /api/admin/reset", () => {
    it("clears all user tables and returns cleared list", async () => {
      const deletedTables = [];
      const mockDb = {
        prepare: vi.fn((query) => {
          if (query.includes("sqlite_master")) {
            return {
              all: vi.fn(async () => ({
                results: [{ name: "player_cache" }, { name: "rate_limits" }],
              })),
            };
          }
          if (query.includes("DELETE FROM")) {
            const tableName = query.match(/"(.+?)"/)?.[1];
            deletedTables.push(tableName);
            return { run: vi.fn(async () => ({})) };
          }
          return { all: vi.fn(async () => ({ results: [] })) };
        }),
      };

      getRequestContext.mockReturnValue({ env: { DB: mockDb } });

      const { POST } = await import("../../app/api/admin/reset/route.js");
      const res = await POST();
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.cleared).toContain("player_cache");
      expect(body.cleared).toContain("rate_limits");
    });

    it("returns 500 on database error", async () => {
      getRequestContext.mockReturnValue({
        env: {
          DB: {
            prepare: vi.fn(() => ({
              all: vi.fn(async () => {
                throw new Error("DB failure");
              }),
            })),
          },
        },
      });

      const { POST } = await import("../../app/api/admin/reset/route.js");
      const res = await POST();
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });

    it("handles empty database gracefully", async () => {
      getRequestContext.mockReturnValue({
        env: {
          DB: {
            prepare: vi.fn(() => ({
              all: vi.fn(async () => ({ results: [] })),
            })),
          },
        },
      });

      const { POST } = await import("../../app/api/admin/reset/route.js");
      const res = await POST();
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.cleared).toEqual([]);
    });
  });
});
