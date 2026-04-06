// ─────────────────────────────────────────────────────────────────────────────
// Tests for app/api/admin/*.js routes
// Covers: tables, table-data, reset
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@cloudflare/next-on-pages", () => ({
  getRequestContext: vi.fn(),
}));

const TEST_SECRET = "test-secret";

/** Create a Request pre-populated with the admin Bearer token. */
function authRequest(url, method = "GET") {
  return new Request(url, {
    method,
    headers: { Authorization: `Bearer ${TEST_SECRET}` },
  });
}

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

      getRequestContext.mockReturnValue({ env: { DB: mockDb, ADMIN_SECRET: TEST_SECRET } });

      const { GET } = await import("../../app/api/admin/tables/route.js");
      const res = await GET(authRequest("http://localhost/api/admin/tables"));
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
          ADMIN_SECRET: TEST_SECRET,
          DB: {
            prepare: vi.fn(() => ({
              all: vi.fn(async () => ({ results: [] })),
            })),
          },
        },
      });

      const { GET } = await import("../../app/api/admin/tables/route.js");
      const res = await GET(authRequest("http://localhost/api/admin/tables"));
      const body = await res.json();
      expect(body.tables).toEqual([]);
    });

    it("returns 500 on database error", async () => {
      getRequestContext.mockReturnValue({
        env: {
          ADMIN_SECRET: TEST_SECRET,
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
      const res = await GET(authRequest("http://localhost/api/admin/tables"));
      expect(res.status).toBe(500);
    });
  });

  // ─── GET /api/admin/table-data ───────────────────────────────────────────

  describe("GET /api/admin/table-data", () => {
    it("returns 400 when table parameter is missing", async () => {
      getRequestContext.mockReturnValue({
        env: { ADMIN_SECRET: TEST_SECRET, DB: { prepare: vi.fn() } },
      });

      const { GET } = await import("../../app/api/admin/table-data/route.js");
      const req = authRequest("http://localhost/api/admin/table-data");
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

      getRequestContext.mockReturnValue({ env: { ADMIN_SECRET: TEST_SECRET, DB: mockDb } });

      const { GET } = await import("../../app/api/admin/table-data/route.js");
      const req = authRequest("http://localhost/api/admin/table-data?table=nonexistent");
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

      getRequestContext.mockReturnValue({ env: { ADMIN_SECRET: TEST_SECRET, DB: mockDb } });

      const { GET } = await import("../../app/api/admin/table-data/route.js");
      const req = authRequest("http://localhost/api/admin/table-data?table=player_cache");
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

      getRequestContext.mockReturnValue({ env: { ADMIN_SECRET: TEST_SECRET, DB: mockDb } });

      const { GET } = await import("../../app/api/admin/table-data/route.js");
      const req = authRequest(
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
      const mockDb = {
        prepare: vi.fn((query) => {
          const self = {
            bind: vi.fn(function () {
              return this;
            }),
            run: vi.fn(async () => ({})),
            all: vi.fn(async () => ({ results: [] })),
          };
          if (query.includes("sqlite_master")) {
            return {
              ...self,
              all: vi.fn(async () => ({
                results: [{ name: "player_cache" }, { name: "rate_limits" }],
              })),
            };
          }
          return self;
        }),
      };

      getRequestContext.mockReturnValue({ env: { ADMIN_SECRET: TEST_SECRET, DB: mockDb } });

      const { POST } = await import("../../app/api/admin/reset/route.js");
      const res = await POST(authRequest("http://localhost/api/admin/reset", "POST"));
      expect(res.status).toBe(200);

      const body = await res.json();
      // New response shape: { reset, created, skipped, errors }
      expect(body.reset).toContain("player_cache");
      expect(body.reset).toContain("rate_limits");
      expect(Array.isArray(body.errors)).toBe(true);
    });

    it("returns 500 on database error", async () => {
      getRequestContext.mockReturnValue({
        env: {
          ADMIN_SECRET: TEST_SECRET,
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
      const res = await POST(authRequest("http://localhost/api/admin/reset", "POST"));
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });

    it("handles empty database gracefully", async () => {
      getRequestContext.mockReturnValue({
        env: {
          ADMIN_SECRET: TEST_SECRET,
          DB: {
            prepare: vi.fn(() => ({
              bind: vi.fn(function () {
                return this;
              }),
              all: vi.fn(async () => ({ results: [] })),
              run: vi.fn(async () => ({})),
            })),
          },
        },
      });

      const { POST } = await import("../../app/api/admin/reset/route.js");
      const res = await POST(authRequest("http://localhost/api/admin/reset", "POST"));
      const body = await res.json();
      // New response shape: all manifest tables get created (none exist yet)
      expect(Array.isArray(body.created)).toBe(true);
      expect(Array.isArray(body.reset)).toBe(true);
      expect(Array.isArray(body.errors)).toBe(true);
    });
  });
});
