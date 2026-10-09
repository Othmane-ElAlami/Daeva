import { analyze } from "../analyzer.js";
import { getSourceMode, COMBAT_POWER } from "../discovery-config.js";
import { createWorkerBudget } from "../scraper-shared.js";

// Same discovery/official-build pipeline as interactive analysis. The caller
// resumes authenticated continuation batches before publishing a full cache.
export async function runPrefetchJob(cls, lbType, db, options = {}) {
  return await analyze(
    {
      cls,
      lbType,
      limit: 100,
      region: options.region || (lbType === COMBAT_POWER ? "GLOBAL" : "all"),
      sourceMode: options.sourceMode || getSourceMode(),
      continuation: options.continuation,
      serverId: "all",
      race: "all",
      runeFilter: "all",
    },
    { db, refresh: true, liveOnly: true, budget: createWorkerBudget(options.env) }
  );
}
