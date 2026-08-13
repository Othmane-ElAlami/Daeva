import {
  fetchJSON,
  fetchWithRetry,
  runPool,
  makeDirectHeaders,
  subrequestBudgetExhausted,
} from "../../scraper-shared.js";
import { ProviderError, calculateHealth } from "./base.js";

const MAX_RETRIES = 5;
const RETRY_BASE_MS = 600;
const SOURCE_NAME = "Official AION 2";

export async function getLeaderboard(config, budget) {
  const { lbInfo, rankingType, limit, isFiltered, startPage = 1, maxPages } = config;

  // We don't know the exact pagination behavior of the official API, but assume it matches Shugo (since Shugo proxies it)
  const pagesNeeded =
    maxPages !== undefined
      ? maxPages
      : Math.min(Math.ceil((limit * (isFiltered ? 8 : 1.5)) / 100), 20);
  const baseUrl = "https://aion2.plaync.com";

  const headers = makeDirectHeaders();

  let expectedServers = 0;
  let successfulServers = 0;
  let lbSeasonMeta = null;

  const lbPageTasks = Array.from({ length: pagesNeeded }, (_, i) => {
    const pg = startPage + i;
    return async () => {
      const url = `${baseUrl}/api/leaderboard?contentType=${lbInfo.contentType}&rankingType=${rankingType}&page=${pg}&limit=100`;
      try {
        const data = await fetchWithRetry(
          () => fetchJSON(url, headers, "GET", null, budget),
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
        // If HTTP 404, we want to immediately fail the provider
        return new ProviderError(err.message, SOURCE_NAME);
      }
    };
  });

  const lbResults = await runPool(lbPageTasks, 5, budget);

  for (const res of lbResults) {
    if (res instanceof Error) throw res;
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
