import {
  fetchJSON,
  fetchWithRetry,
  runPool,
  subrequestBudgetExhausted,
} from "../../scraper-shared.js";
import { ProviderError, calculateHealth } from "./base.js";

const MAX_RETRIES = 5;
const RETRY_BASE_MS = 600;
const SOURCE_NAME = "Shugo";

export async function getLeaderboard(config, budget) {
  const { baseUrl, lbInfo, rankingType, limit, isFiltered, startPage = 1, maxPages } = config;

  // Estimate pages needed (100 per page)
  const pagesNeeded =
    maxPages !== undefined
      ? maxPages
      : Math.min(Math.ceil((limit * (isFiltered ? 8 : 1.5)) / 100), 20);
  let lbSeasonMeta = null;
  let expectedServers = 0;
  let successfulServers = 0;

  const lbPageTasks = Array.from({ length: pagesNeeded }, (_, i) => {
    const pg = startPage + i;
    return async () => {
      const url = `${baseUrl}/api/leaderboard?contentType=${lbInfo.contentType}&rankingType=${rankingType}&page=${pg}&limit=100`;
      try {
        const data = await fetchWithRetry(
          () => fetchJSON(url, {}, "GET", null, budget),
          MAX_RETRIES,
          RETRY_BASE_MS,
          budget
        );

        if (pg === 1) {
          if (data?.season) lbSeasonMeta = data.season;
          expectedServers = data?.expectedServers || 0;
          successfulServers = data?.successfulServers || 0;
        }

        const health = calculateHealth(data?.successfulServers || 0, data?.expectedServers || 0);
        if (health === "unavailable") {
          throw new ProviderError(
            `Upstream leaderboard API failed (${data?.successfulServers || 0}/${data?.expectedServers || 0} servers successful).`,
            SOURCE_NAME
          );
        }

        return data?.rankings || [];
      } catch (err) {
        if (err instanceof subrequestBudgetExhausted) throw err;
        return err; // Return error object to avoid swallowing in runPool
      }
    };
  });

  const lbResults = await runPool(lbPageTasks, 5, budget);

  // Check if any page threw a fatal error
  for (const res of lbResults) {
    if (res instanceof Error) {
      if (res instanceof ProviderError) throw res;
      throw new ProviderError(res.message, SOURCE_NAME);
    }
  }

  const rawPlayers = lbResults.flat().filter(Boolean);

  return {
    rankings: rawPlayers,
    meta: {
      source: SOURCE_NAME,
      health: calculateHealth(successfulServers, expectedServers),
      expectedServers,
      successfulServers,
      season: lbSeasonMeta,
      ageMs: 0,
      pagesFetched: pagesNeeded,
    },
  };
}
