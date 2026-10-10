// ─────────────────────────────────────────────────────────────────────────────
// POST /api/prefetch/run — Trigger a Single Prefetch Job
// ─────────────────────────────────────────────────────────────────────────────
// Fetches the top 100 players for one class×leaderboard combination from
// upstream APIs and stores the aggregated result in the D1 prefetch_cache.
//
// This endpoint is called by a GitHub Actions cron workflow every six hours,
// once per supported region/class in CP mode (24 jobs). It can also be triggered
// manually for testing or cache warming.
//
// Authentication: Bearer token (ADMIN_SECRET) required.
// ─────────────────────────────────────────────────────────────────────────────

import { getRequestContext } from "@cloudflare/next-on-pages";
import { validateAdminRequest, unauthorizedResponse } from "@/lib/admin-auth";
import { getPrefetchCache, setPrefetchCache } from "@/lib/prefetch/cache";
import { loadConfig } from "@/lib/prefetch/config";
import { runPrefetchJob } from "@/lib/prefetch/runner";
import { classes, leaderboardTypes } from "@/lib/scraper-shared";
import { COMBAT_POWER, CP_SOURCE, isHistoricalOnly } from "@/lib/discovery-config";
import { normalizeRegion } from "@/lib/regions";
import { validateContinuation } from "@/lib/analyzer";
import { saveMetaSnapshot } from "@/lib/meta-snapshots";
import { inspectPopulation } from "@/lib/prefetch/population";
import { claimRefresh, updateRefresh } from "@/lib/prefetch/refresh";

export const runtime = "edge";

export async function POST(request) {
  const { env } = getRequestContext();

  const { authorized } = await validateAdminRequest(request, env);
  if (!authorized) return unauthorizedResponse();

  const config = loadConfig(env);
  if (!config.enabled) {
    return Response.json(
      {
        error: "Prefetch system is disabled via PREFETCH_ENABLED=false",
        code: "PREFETCH_DISABLED",
      },
      { status: 503 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { cls, leaderboard } = body || {};

  if (!cls || !classes.includes(cls)) {
    return Response.json(
      { error: `Invalid class: ${cls}. Expected one of: ${classes.join(", ")}` },
      { status: 400 }
    );
  }
  if (!leaderboard || !Object.hasOwn(leaderboardTypes, leaderboard)) {
    return Response.json(
      {
        error: `Invalid leaderboard: ${leaderboard}. Expected one of: ${Object.keys(leaderboardTypes).join(", ")}`,
      },
      { status: 400 }
    );
  }
  if (isHistoricalOnly(leaderboard, config.sourceMode))
    return Response.json(
      { error: "Mode-specific prefetch is unavailable in Combat Power mode." },
      { status: 503 }
    );
  const region = leaderboard === COMBAT_POWER ? normalizeRegion(body.region || "GLOBAL") : "all";
  if (!region) return Response.json({ error: "Invalid region." }, { status: 400 });
  const analysisConfig = {
    cls,
    lbType: leaderboard,
    region,
    limit: 100,
    serverId: "all",
    race: "all",
    runeFilter: "all",
  };
  if (body.continuation && !validateContinuation(body.continuation, analysisConfig))
    return Response.json({ error: "Invalid continuation population." }, { status: 400 });

  const startTime = Date.now();
  let refreshToken = null;

  try {
    if (!body.continuation) {
      const cached = await getPrefetchCache(env.DB, cls, leaderboard, false, region);
      const complete =
        leaderboard !== COMBAT_POWER ||
        inspectPopulation(cached, cls, leaderboard, region).complete;
      // A small interactive sample must not suppress the scheduled top-100 job.
      if (cached && complete && Date.now() - cached.fetchedAt < config.minRefreshMinutes * 60000)
        return Response.json({
          success: true,
          complete: true,
          skipped: true,
          reason: "Recently refreshed",
          class: cls,
          leaderboard,
          region,
          playerCount: cached.builds.length,
          errorCount: 0,
          durationMs: Date.now() - startTime,
        });
    }
    const lease = await claimRefresh(
      env.DB,
      analysisConfig,
      body.continuation?.refreshToken,
      "scheduled"
    );
    if (!lease.acquired)
      return Response.json(
        { success: false, inProgress: true, class: cls, leaderboard, region, retryAfterMs: 5000 },
        { status: 202 }
      );
    refreshToken = lease.token;
    const result = await runPrefetchJob(cls, leaderboard, env.DB, {
      region,
      sourceMode: config.sourceMode,
      continuation: body.continuation,
      env,
    });

    if (result.continuation) {
      await updateRefresh(env.DB, analysisConfig, refreshToken, "running", {
        buildCount: result.builds.length,
      });
    } else {
      const population = inspectPopulation(
        {
          data: result.stats,
          builds: result.builds,
          source: leaderboard === COMBAT_POWER ? CP_SOURCE : result.sourceMeta?.source,
        },
        cls,
        leaderboard,
        region
      );
      if (leaderboard === COMBAT_POWER && (!population.complete || result.errors.length)) {
        await updateRefresh(env.DB, analysisConfig, refreshToken, "failed", {
          buildCount: population.buildCount,
          error: "Incomplete population; previous dataset retained.",
        });
        return Response.json(
          {
            success: false,
            complete: false,
            code: "INCOMPLETE_POPULATION",
            class: cls,
            leaderboard,
            region,
            playerCount: population.buildCount,
            expectedCount: population.expectedCount,
            errorCount: result.errors.length,
            error:
              "Prefetch did not prepare a complete population. The previous dataset is retained.",
          },
          { status: 502 }
        );
      }
    }
    if (!result.continuation && result.stats && result.builds.length > 0) {
      const ttlMs = config.cacheTtlMinutes * 60_000;
      await setPrefetchCache(
        env.DB,
        cls,
        leaderboard,
        result.stats,
        result.builds,
        ttlMs,
        leaderboard === COMBAT_POWER ? CP_SOURCE : result.sourceMeta?.source || "prefetch",
        region,
        { preparedBy: "scheduled" }
      );
      await saveMetaSnapshot(env.DB, { cls, lbType: leaderboard, region }, result.stats);
      await updateRefresh(env.DB, analysisConfig, refreshToken, "complete", {
        buildCount: result.builds.length,
      });
    }

    return Response.json({
      success: true,
      complete: !result.continuation && result.builds.length > 0,
      class: cls,
      leaderboard,
      region,
      continuation: result.continuation
        ? { ...result.continuation, ...(refreshToken ? { refreshToken } : {}) }
        : null,
      playerCount: result.playerCount ?? result.builds.length,
      errorCount: result.errors.length,
      budgetUsed: result.budgetUsed,
      durationMs: Date.now() - startTime,
      errors: result.errors.slice(0, 10),
      sourceMeta: result.sourceMeta,
    });
  } catch (err) {
    const isUpstreamFailure = err.name === "AllProvidersFailedError";
    await updateRefresh(env.DB, analysisConfig, refreshToken, "failed", {
      error: "Upstream preparation failed; previous dataset retained.",
    }).catch(() => {});
    return Response.json(
      {
        success: false,
        class: cls,
        leaderboard,
        region,
        code: isUpstreamFailure ? "UPSTREAM_UNAVAILABLE" : "PREFETCH_FAILED",
        error: err.message,
        durationMs: Date.now() - startTime,
      },
      { status: isUpstreamFailure ? 503 : 500 }
    );
  }
}
