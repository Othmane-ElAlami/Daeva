import { test, expect } from "vitest";
import { calculateHealth, ProviderError } from "../src/lib/providers/leaderboard/base.js";
import { getLeaderboard } from "../src/lib/providers/leaderboard/index.js";

// Mock the providers module
import * as official from "../src/lib/providers/leaderboard/official.js";
import * as shugo from "../src/lib/providers/leaderboard/shugo.js";
import * as cache from "../src/lib/providers/leaderboard/cache.js";

test("calculateHealth works correctly", () => {
  expect(calculateHealth(78, 78)).toBe("complete");
  expect(calculateHealth(0, 78)).toBe("unavailable");
  expect(calculateHealth(71, 78)).toBe("complete"); // >= 90%
  expect(calculateHealth(55, 78)).toBe("partial"); // >= 70%
  expect(calculateHealth(50, 78)).toBe("unavailable"); // < 70%
});

test("ProviderError behaves correctly", () => {
  const err = new ProviderError("test message", "TestSource");
  expect(err.message).toBe("test message");
  expect(err.source).toBe("TestSource");
  expect(err.name).toBe("ProviderError");
});

test("Orchestrator falls back through providers", async () => {
  const originalFetch = global.fetch;
  global.fetch = () => Promise.reject(new Error("Network Error"));

  const mockBudget = {
    canAfford: () => true,
    consume: () => {},
  };

  const config = {
    lbInfo: { contentType: 1 },
    rankingType: 1,
    limit: 10,
    isFiltered: false,
    baseUrl: "http://invalid",
    db: null,
  };

  try {
    await getLeaderboard(config, mockBudget);
    expect.fail("Should have thrown an aggregate error");
  } catch (err) {
    expect(err.message).toMatch(/All leaderboard providers failed/);
    expect(err.message).toMatch(/Database connection not provided for cache lookup/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("Orchestrator respects forceProvider", async () => {
  const originalFetch = global.fetch;
  global.fetch = () => Promise.reject(new Error("Network Error"));

  const mockBudget = {
    canAfford: () => true,
    consume: () => {},
  };

  const config = {
    lbInfo: { contentType: 1 },
    rankingType: 1,
    limit: 10,
    isFiltered: false,
    baseUrl: "http://invalid",
    db: null,
    forceProvider: "Shugo",
  };

  try {
    await getLeaderboard(config, mockBudget);
    expect.fail("Should have thrown an error");
  } catch (err) {
    // If it falls back it would throw AggregateError about all providers.
    // If it respects forceProvider, it throws only the Shugo error.
    expect(err.source).toBe("Shugo");
  } finally {
    global.fetch = originalFetch;
  }
});
