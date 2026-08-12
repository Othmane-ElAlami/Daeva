import { getPrefetchCache } from "../../prefetch/cache.js";
import { ProviderError } from "./base.js";

const SOURCE_NAME = "Cache";

export async function getLeaderboard(config, budget) {
  const { db, cls, lbType } = config;

  if (!db) {
    throw new ProviderError("Database connection not provided for cache lookup.", SOURCE_NAME);
  }

  const cached = await getPrefetchCache(db, cls, lbType, true); // true = allowStale
  if (!cached || !cached.builds || cached.builds.length === 0) {
    throw new ProviderError("No healthy cached leaderboard data available.", SOURCE_NAME);
  }

  const { startPage = 1 } = config;

  if (startPage > 1) {
    return {
      rankings: [],
      meta: {
        source: SOURCE_NAME,
        health: "complete",
        expectedServers: 78,
        successfulServers: 78,
        season: null,
        ageMs: Date.now() - cached.fetchedAt,
        pagesFetched: 0,
      },
    };
  }

  const ageMs = Date.now() - cached.fetchedAt;
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

  if (ageMs > SEVEN_DAYS_MS) {
    throw new ProviderError("Cache expired (older than 7 days).", SOURCE_NAME);
  }

  const health = ageMs > TWO_DAYS_MS ? "stale" : "complete";

  const rawPlayers = cached.builds.map((b) => ({
    characterId: b.characterId,
    characterName: b.characterName,
    classId: b.classId,
    serverId: b.serverId,
    score: b.score,
    rank: b.rank,
    _isFromCache: true, // internal flag
    _equip: b.equipData,
    _equipDetails: b.equipDetails,
    _itemLevel: b.itemLevel,
    _combatPower: b.equipData?.profile?.combatPower,
  }));

  return {
    rankings: rawPlayers,
    meta: {
      source: SOURCE_NAME,
      health: health,
      expectedServers: 78,
      successfulServers: 78,
      season: null,
      ageMs: ageMs,
      pagesFetched: 0,
    },
  };
}
