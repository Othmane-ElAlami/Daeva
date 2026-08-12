// ─────────────────────────────────────────────────────────────────────────────
// Tests for src/lib/prefetch/cache.js and src/lib/prefetch/config.js
// Pure unit tests — no route handler mocking.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from "vitest";
import {
  getPrefetchCache,
  setPrefetchCache,
  getAllPrefetchEntries,
  clearPrefetchCache,
} from "../../src/lib/prefetch/cache.js";
import { loadConfig } from "../../src/lib/prefetch/config.js";

// ─────────────────────────────────────────────────────────────────────────────
// Shared D1 mock factory
// ─────────────────────────────────────────────────────────────────────────────
function makeDb({ firstRow = null, allRows = [] } = {}) {
  const stmt = {
    bind: vi.fn().mockReturnThis(),
    run: vi.fn().mockResolvedValue({}),
    first: vi.fn().mockResolvedValue(firstRow),
    all: vi.fn().mockResolvedValue({ results: allRows }),
  };
  return { prepare: vi.fn().mockReturnValue(stmt), _stmt: stmt };
}

// ═══════════════════════════════════════════════════════════════════════════════
// D1 CACHE
// ═══════════════════════════════════════════════════════════════════════════════

describe("D1 PrefetchCache — getPrefetchCache", () => {
  it("returns null on cache miss", async () => {
    expect(await getPrefetchCache(makeDb({ firstRow: null }), "gladiator", "nightmare")).toBeNull();
  });

  it("returns parsed data on fresh cache hit", async () => {
    const now = Date.now();
    const data = { total: 100 };
    const builds = [{ name: "A" }];
    const db = makeDb({
      firstRow: {
        data: JSON.stringify(data),
        builds: JSON.stringify(builds),
        fetched_at: now - 5000,
        expires_at: now + 60_000,
        source: "prefetch",
      },
    });
    const result = await getPrefetchCache(db, "gladiator", "nightmare");
    expect(result.data).toEqual(data);
    expect(result.builds).toEqual(builds);
    expect(result.source).toBe("prefetch");
    expect(result.isExpired).toBe(false);
  });

  it("returns stale entry when allowStale=true (default)", async () => {
    const now = Date.now();
    const db = makeDb({
      firstRow: {
        data: JSON.stringify({ total: 50 }),
        builds: JSON.stringify([]),
        fetched_at: now - 9_000_000,
        expires_at: now - 1000,
        source: "prefetch",
      },
    });
    const result = await getPrefetchCache(db, "cleric", "abyss", true);
    expect(result).not.toBeNull();
    expect(result.isExpired).toBe(true);
  });

  it("returns null for expired entry when allowStale=false", async () => {
    const now = Date.now();
    const db = makeDb({
      firstRow: {
        data: JSON.stringify({ total: 50 }),
        builds: JSON.stringify([]),
        fetched_at: now - 9_000_000,
        expires_at: now - 1000,
        source: "prefetch",
      },
    });
    expect(await getPrefetchCache(db, "cleric", "abyss", false)).toBeNull();
  });

  it("returns null (not throws) when D1 throws", async () => {
    const db = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockRejectedValue(new Error("D1 error")),
      }),
    };
    expect(await getPrefetchCache(db, "gladiator", "nightmare")).toBeNull();
  });

  it("queries with correct class and leaderboard parameters", async () => {
    const db = makeDb({ firstRow: null });
    await getPrefetchCache(db, "templar", "pvp");
    expect(db._stmt.bind).toHaveBeenCalledWith("templar", "pvp");
  });
});

describe("D1 PrefetchCache — setPrefetchCache", () => {
  it("calls INSERT OR REPLACE with serialized JSON", async () => {
    const db = makeDb();
    const data = { total: 42 };
    const builds = [{ name: "B" }];
    await setPrefetchCache(db, "ranger", "nightmare", data, builds, 45 * 60_000);
    expect(db._stmt.bind).toHaveBeenCalledWith(
      "ranger",
      "nightmare",
      JSON.stringify(data),
      JSON.stringify(builds),
      expect.any(Number),
      expect.any(Number),
      "prefetch"
    );
    expect(db._stmt.run).toHaveBeenCalled();
  });

  it("accepts a custom source value", async () => {
    const db = makeDb();
    await setPrefetchCache(db, "cleric", "abyss", {}, [], 1000, "live");
    const bindArgs = db._stmt.bind.mock.calls[0];
    expect(bindArgs[bindArgs.length - 1]).toBe("live");
  });

  it("sets expires_at = fetched_at + ttlMs", async () => {
    const db = makeDb();
    const ttlMs = 30 * 60_000;
    await setPrefetchCache(db, "gladiator", "pvp", {}, [], ttlMs);
    const [, , , , fetchedAt, expiresAt] = db._stmt.bind.mock.calls[0];
    expect(expiresAt - fetchedAt).toBeCloseTo(ttlMs, -2);
  });
});

describe("D1 PrefetchCache — getAllPrefetchEntries", () => {
  it("returns mapped array with isExpired and ageMinutes", async () => {
    const now = Date.now();
    const db = makeDb({
      allRows: [
        {
          class: "gladiator",
          leaderboard: "nightmare",
          fetched_at: now - 600_000,
          expires_at: now + 1_000_000,
          source: "prefetch",
        },
        {
          class: "cleric",
          leaderboard: "abyss",
          fetched_at: now - 9_000_000,
          expires_at: now - 1000,
          source: "prefetch",
        },
      ],
    });
    const entries = await getAllPrefetchEntries(db);
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.class === "gladiator").isExpired).toBe(false);
    expect(entries.find((e) => e.class === "cleric").isExpired).toBe(true);
    expect(entries.find((e) => e.class === "gladiator").ageMinutes).toBeCloseTo(10, 0);
  });

  it("returns empty array (not throws) when D1 throws", async () => {
    const db = {
      prepare: vi.fn().mockReturnValue({ all: vi.fn().mockRejectedValue(new Error("D1")) }),
    };
    expect(await getAllPrefetchEntries(db)).toEqual([]);
  });
});

describe("D1 PrefetchCache — clearPrefetchCache", () => {
  it("issues DELETE FROM prefetch_cache", async () => {
    const db = makeDb();
    await clearPrefetchCache(db);
    expect(db.prepare).toHaveBeenCalledWith("DELETE FROM prefetch_cache");
    expect(db._stmt.run).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

describe("PrefetchConfig", () => {
  it("returns sensible defaults", () => {
    expect(loadConfig().enabled).toBe(true);
    expect(loadConfig().cacheTtlMinutes).toBe(45);
  });

  it("reads PREFETCH_ENABLED=false from env", () => {
    process.env.PREFETCH_ENABLED = "false";
    try {
      expect(loadConfig().enabled).toBe(false);
    } finally {
      delete process.env.PREFETCH_ENABLED;
    }
  });

  it("reads PREFETCH_CACHE_TTL_MINUTES from env", () => {
    process.env.PREFETCH_CACHE_TTL_MINUTES = "60";
    try {
      expect(loadConfig().cacheTtlMinutes).toBe(60);
    } finally {
      delete process.env.PREFETCH_CACHE_TTL_MINUTES;
    }
  });

  it("ignores invalid PREFETCH_CACHE_TTL_MINUTES — falls back to default", () => {
    process.env.PREFETCH_CACHE_TTL_MINUTES = "not-a-number";
    try {
      expect(loadConfig().cacheTtlMinutes).toBe(45);
    } finally {
      delete process.env.PREFETCH_CACHE_TTL_MINUTES;
    }
  });

  it("treats PREFETCH_ENABLED=1 as true", () => {
    process.env.PREFETCH_ENABLED = "1";
    try {
      expect(loadConfig().enabled).toBe(true);
    } finally {
      delete process.env.PREFETCH_ENABLED;
    }
  });

  it("config object is frozen", () => {
    expect(Object.isFrozen(loadConfig())).toBe(true);
  });
});
