import { getLeaderboard as officialProvider } from "./official.js";
import { getLeaderboard as shugoProvider } from "./shugo.js";
import { getLeaderboard as cacheProvider } from "./cache.js";
import { ProviderError, AllProvidersFailedError } from "./base.js";

// Priority order: Official -> Shugo -> Cache
const PROVIDERS = {
  "Official AION 2": officialProvider,
  Shugo: shugoProvider,
  Cache: cacheProvider,
};

export async function getLeaderboard(config, budget) {
  const errors = [];

  if (config.forceProvider) {
    const provider = PROVIDERS[config.forceProvider];
    if (!provider) {
      throw new Error(`Unknown provider: ${config.forceProvider}`);
    }
    return await provider(config, budget);
  }

  for (const [name, provider] of Object.entries(PROVIDERS)) {
    try {
      return await provider(config, budget);
    } catch (err) {
      // If it's a budget exhaustion, we shouldn't continue retrying next providers
      if (err.name === "subrequestBudgetExhausted") throw err;

      errors.push(err);

      // Stop and don't fallback if the provider successfully fetched but returned a partial health outage
      // No, wait, if a provider fails because of partial health (throws ProviderError), we SHOULD try the next provider
      // (e.g. Official failed, try Shugo. If Shugo failed, try Cache).
    }
  }

  // If all providers failed, throw an aggregate error
  const details = errors.map((e) => e.message).join(" | ");
  throw new AllProvidersFailedError(`All leaderboard providers failed: ${details}`);
}
