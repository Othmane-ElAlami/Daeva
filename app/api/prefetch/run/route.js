// ─────────────────────────────────────────────────────────────────────────────
// POST /api/prefetch/run — Trigger a Single Prefetch Job
// ─────────────────────────────────────────────────────────────────────────────
// Fetches the top 100 players for one class×leaderboard combination from
// upstream APIs and stores the aggregated result in the D1 prefetch_cache.
//
// This endpoint is called by a GitHub Actions cron workflow every 30 minutes,
// once per class×leaderboard combo (56 total). It can also be triggered
// manually for testing or cache warming.
//
// Authentication: Bearer token (ADMIN_SECRET) required.
// ─────────────────────────────────────────────────────────────────────────────

import { getRequestContext } from "@cloudflare/next-on-pages";
import { validateAdminRequest, unauthorizedResponse } from "@/lib/admin-auth";
import { setPrefetchCache } from "@/lib/prefetch/cache";
import { loadConfig } from "@/lib/prefetch/config";
import { runPrefetchJob } from "@/lib/prefetch/runner";
import { classes, leaderboardTypes } from "@/lib/scraper-shared";

export const runtime = "edge";

export async function POST(request) {
  const { env } = getRequestContext();

  const { authorized } = await validateAdminRequest(request, env);
  if (!authorized) return unauthorizedResponse();

  const config = loadConfig();
  if (!config.enabled) {
    return Response.json(
      { error: "Prefetch system is disabled via PREFETCH_ENABLED=false" },
      { status: 503 }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { cls, leaderboard } = body;

  if (!cls || !classes.includes(cls)) {
    return Response.json(
      { error: `Invalid class: ${cls}. Expected one of: ${classes.join(", ")}` },
      { status: 400 }
    );
  }
  if (!leaderboard || !leaderboardTypes[leaderboard]) {
    return Response.json(
      {
        error: `Invalid leaderboard: ${leaderboard}. Expected one of: ${Object.keys(leaderboardTypes).join(", ")}`,
      },
      { status: 400 }
    );
  }

  const startTime = Date.now();

  try {
    const result = await runPrefetchJob(cls, leaderboard);

    if (result.stats && result.builds.length > 0) {
      const ttlMs = config.cacheTtlMinutes * 60_000;
      await setPrefetchCache(env.DB, cls, leaderboard, result.stats, result.builds, ttlMs);
    }

    return Response.json({
      success: true,
      class: cls,
      leaderboard,
      playerCount: result.playerCount,
      errorCount: result.errors.length,
      budgetUsed: result.budgetUsed,
      durationMs: Date.now() - startTime,
      errors: result.errors.slice(0, 10),
    });
  } catch (err) {
    return Response.json(
      {
        success: false,
        class: cls,
        leaderboard,
        error: err.message,
        durationMs: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}
