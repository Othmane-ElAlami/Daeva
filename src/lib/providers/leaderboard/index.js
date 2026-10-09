import { getLeaderboard as officialProvider } from "./official.js";
import { getLeaderboard as shugoProvider } from "./shugo.js";
import { getLeaderboard as cacheProvider } from "./cache.js";
import { getLeaderboard as combatPowerProvider } from "./shugo-combat-power.js";
import { COMBAT_POWER, CP_SOURCE, getSourceMode } from "../../discovery-config.js";
import { ProviderError, AllProvidersFailedError } from "./base.js";

// CP discovery has its own population; the preserved legacy chain is selected
// only when mode-specific ranking is restored through centralized configuration.
const PROVIDERS = {
  "Official AION 2": officialProvider,
  Shugo: shugoProvider,
  Cache: cacheProvider,
  [CP_SOURCE]: combatPowerProvider,
};

export async function getLeaderboard(config, budget) {
  const errors = [];
  const mode = config.sourceMode || getSourceMode();
  const order =
    config.lbType === COMBAT_POWER
      ? [CP_SOURCE, ...(config.liveOnly ? [] : ["Cache"])]
      : mode === COMBAT_POWER
        ? config.liveOnly
          ? []
          : ["Cache"]
        : ["Official AION 2", "Shugo", ...(config.liveOnly ? [] : ["Cache"])];
  const withPopulation = (result) => ({
    ...result,
    meta: {
      ...result.meta,
      leaderboardType: config.lbType,
      basis: result.meta.basis || config.lbInfo?.label,
      page: result.meta.page || config.startPage || 1,
      hasMore: result.meta.hasMore ?? result.rankings.length >= 100,
    },
  });

  if (config.forceProvider) {
    const provider = PROVIDERS[config.forceProvider];
    if (!provider) {
      throw new Error(`Unknown provider: ${config.forceProvider}`);
    }
    if (!order.includes(config.forceProvider))
      throw new ProviderError(
        "Provider does not match this discovery population.",
        config.forceProvider
      );
    return withPopulation(await provider(config, budget));
  }

  for (const name of order) {
    const provider = PROVIDERS[name];
    try {
      return withPopulation(await provider(config, budget));
    } catch (err) {
      // If it's a budget exhaustion, we shouldn't continue retrying next providers
      if (err.name === "SubrequestBudgetExhausted") throw err;

      errors.push(err);
    }
  }

  // If all providers failed, throw an aggregate error
  const details = errors.map((e) => e.message).join(" | ");
  throw new AllProvidersFailedError(`All leaderboard providers failed: ${details}`);
}
