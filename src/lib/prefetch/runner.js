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
    // Discovery is always live. Reuse complete official character caches younger
    // than six hours, including builds a recent interactive scan already fetched.
    {
      db,
      liveOnly: true,
      checkpointOnly: lbType === COMBAT_POWER && !!db,
      budget: createWorkerBudget(options.env),
    }
  );
}
