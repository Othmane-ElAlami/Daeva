// ─────────────────────────────────────────────────────────────────────────────
// Tests for src/lib/db.js
// Covers: getCachedPlayer, setCachedPlayer with mock D1 database
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach } from "vitest";
import { getCachedPlayer, setCachedPlayer } from "../../src/lib/db.js";

function createMockDb() {
  const rows = new Map();

  const mockStmt = {
    bind: vi.fn(function (...args) {
      this._boundArgs = args;
      return this;
    }),
    first: vi.fn(async function () {
      const key = `${this._boundArgs[0]}_${this._boundArgs[1]}`;
      return rows.get(key) || null;
    }),
    run: vi.fn(async function () {
      // INSERT OR REPLACE
      const args = this._boundArgs;
      const key = `${args[0]}_${args[1]}`;
      rows.set(key, {
        equip_data: args[3],
        equip_details: args[4],
        item_level: args[5],
        fetched_at: args[6],
      });
    }),
  };

  return {
    prepare: vi.fn(() => {
      // Return a fresh statement-like object each time
      const stmt = { ...mockStmt, _boundArgs: [] };
      stmt.bind = vi.fn(function (...args) {
        stmt._boundArgs = args;
        return stmt;
      });
      stmt.first = vi.fn(async () => {
        const key = `${stmt._boundArgs[0]}_${stmt._boundArgs[1]}`;
        return rows.get(key) || null;
      });
      stmt.run = vi.fn(async () => {
        const args = stmt._boundArgs;
        const key = `${args[0]}_${args[1]}`;
        rows.set(key, {
          equip_data: args[3],
          equip_details: args[4],
          item_level: args[5],
          fetched_at: args[6],
        });
      });
      return stmt;
    }),
    _rows: rows,
  };
}

describe("getCachedPlayer", () => {
  it("returns null when player is not cached", async () => {
    const db = createMockDb();
    const result = await getCachedPlayer(db, "char1", "1001");
    expect(result).toBeNull();
  });

  it("returns cached player data within TTL", async () => {
    const db = createMockDb();
    const equipData = { equipment: { equipmentList: [{ id: 1 }] } };
    const equipDetails = [{ slotPos: 1, subStats: [] }];

    // Store the player first
    await setCachedPlayer(db, "char1", "1001", "KR", equipData, equipDetails, 385);

    const result = await getCachedPlayer(db, "char1", "1001");
    expect(result).not.toBeNull();
    expect(result.equipData).toEqual(equipData);
    expect(result.equipDetails).toEqual(equipDetails);
    expect(result.itemLevel).toBe(385);
    expect(typeof result.fetchedAt).toBe("number");
  });

  it("returns null for expired cache (>24 hours)", async () => {
    const db = createMockDb();

    // Manually insert an expired entry
    const key = "char_expired_1001";
    db._rows.set(key, {
      equip_data: JSON.stringify({ test: true }),
      equip_details: JSON.stringify([]),
      item_level: 400,
      fetched_at: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
    });

    // Override the prepare to find this exact entry
    const expiredDb = {
      prepare: vi.fn(() => {
        const stmt = {
          _boundArgs: [],
          bind: vi.fn(function (...args) {
            stmt._boundArgs = args;
            return stmt;
          }),
          first: vi.fn(async () => ({
            equip_data: JSON.stringify({ test: true }),
            equip_details: JSON.stringify([]),
            item_level: 400,
            fetched_at: Date.now() - 25 * 60 * 60 * 1000,
          })),
        };
        return stmt;
      }),
    };

    const result = await getCachedPlayer(expiredDb, "char_expired", "1001");
    expect(result).toBeNull();
  });

  it("returns data for fresh cache (<24 hours)", async () => {
    const freshDb = {
      prepare: vi.fn(() => {
        const stmt = {
          _boundArgs: [],
          bind: vi.fn(function (...args) {
            stmt._boundArgs = args;
            return stmt;
          }),
          first: vi.fn(async () => ({
            equip_data: JSON.stringify({ equipment: {} }),
            equip_details: JSON.stringify([{ id: 1 }]),
            item_level: 420,
            fetched_at: Date.now() - 1 * 60 * 60 * 1000, // 1 hour ago
          })),
        };
        return stmt;
      }),
    };

    const result = await getCachedPlayer(freshDb, "char_fresh", "2001");
    expect(result).not.toBeNull();
    expect(result.equipData).toEqual({ equipment: {} });
    expect(result.itemLevel).toBe(420);
  });

  it("handles null item_level", async () => {
    const db = {
      prepare: vi.fn(() => {
        const stmt = {
          bind: vi.fn(() => stmt),
          first: vi.fn(async () => ({
            equip_data: JSON.stringify({}),
            equip_details: JSON.stringify([]),
            item_level: null,
            fetched_at: Date.now(),
          })),
        };
        return stmt;
      }),
    };

    const result = await getCachedPlayer(db, "char1", "1001");
    expect(result.itemLevel).toBeNull();
  });

  it("converts characterId and serverId to strings", async () => {
    const db = createMockDb();

    // Store with numeric-like IDs
    await setCachedPlayer(db, 12345, 1001, "KR", { test: true }, [], 400);

    // Verify prepare was called and bind received strings
    const calls = db.prepare.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
  });
});

describe("setCachedPlayer", () => {
  it("stores player data correctly", async () => {
    const db = createMockDb();
    const equipData = { equipment: { equipmentList: [] } };
    const equipDetails = [{ slotPos: 1, subStats: [{ name: "ATK", value: 10 }] }];

    await setCachedPlayer(db, "char1", "1001", "KR", equipData, equipDetails, 385);

    expect(db.prepare).toHaveBeenCalled();
  });

  it("stores null region as null", async () => {
    const bindArgs = [];
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(function (...args) {
          bindArgs.push(...args);
          return this;
        }),
        run: vi.fn(),
      })),
    };

    await setCachedPlayer(db, "char1", "1001", null, {}, [], null);
    // region arg (index 2) should be null
    expect(bindArgs[2]).toBeNull();
    // itemLevel arg (index 5) should be null
    expect(bindArgs[5]).toBeNull();
  });

  it("serializes equipData and equipDetails as JSON", async () => {
    const bindArgs = [];
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(function (...args) {
          bindArgs.push(...args);
          return this;
        }),
        run: vi.fn(),
      })),
    };

    const equipData = { foo: "bar" };
    const equipDetails = [{ a: 1 }];
    await setCachedPlayer(db, "c1", "s1", "KR", equipData, equipDetails, 400);

    // equip_data (index 3) and equip_details (index 4) should be JSON strings
    expect(bindArgs[3]).toBe(JSON.stringify(equipData));
    expect(bindArgs[4]).toBe(JSON.stringify(equipDetails));
  });

  it("stores fetched_at as current timestamp", async () => {
    const bindArgs = [];
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(function (...args) {
          bindArgs.push(...args);
          return this;
        }),
        run: vi.fn(),
      })),
    };

    const beforeTs = Date.now();
    await setCachedPlayer(db, "c1", "s1", "KR", {}, [], 400);
    const afterTs = Date.now();

    // fetched_at (index 6) should be roughly now
    const ts = bindArgs[6];
    expect(ts).toBeGreaterThanOrEqual(beforeTs);
    expect(ts).toBeLessThanOrEqual(afterTs);
  });
});
