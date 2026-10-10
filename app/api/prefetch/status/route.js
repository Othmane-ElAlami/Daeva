// ─────────────────────────────────────────────────────────────────────────────
// GET /api/prefetch/status — Prefetch Cache Status
// ─────────────────────────────────────────────────────────────────────────────
// Returns current state of the D1 prefetch cache: how many class×leaderboard
// combos are cached, which are fresh vs stale, and per-entry details.
//
// This endpoint is gated behind admin authentication.
// ─────────────────────────────────────────────────────────────────────────────

import { getRequestContext } from "@cloudflare/next-on-pages";
import { validateAdminRequest, unauthorizedResponse } from "@/lib/admin-auth";
import { getAllPrefetchEntries } from "@/lib/prefetch/cache";
import { loadConfig } from "@/lib/prefetch/config";
import { classes, leaderboardTypes } from "@/lib/scraper-shared";
import { COMBAT_POWER } from "@/lib/discovery-config";
import { regions } from "@/lib/regions";

export const runtime = "edge";

export async function GET(request) {
  const { env } = getRequestContext();

  const { authorized } = await validateAdminRequest(request, env);
  if (!authorized) return unauthorizedResponse();

  try {
    const config = loadConfig(env);
    const entries = await getAllPrefetchEntries(env.DB);

    const active = entries.filter((entry) =>
      config.sourceMode === COMBAT_POWER
        ? entry.leaderboard === COMBAT_POWER
        : entry.leaderboard !== COMBAT_POWER
    );
    const totalCombos =
      classes.length *
      (config.sourceMode === COMBAT_POWER
        ? Object.keys(regions).length
        : Object.keys(leaderboardTypes).length - 1);
    const freshCount = active.filter((e) => !e.isExpired).length;
    const staleCount = active.filter((e) => e.isExpired).length;
    const cached =
      config.sourceMode === COMBAT_POWER ? active.filter((e) => e.buildCount > 0) : active;
    const complete = cached.filter((e) => config.sourceMode !== COMBAT_POWER || e.complete);
    const now = Date.now();
    const nextScheduledRunAt = Array.from({ length: 8 }, (_, index) => {
      const date = new Date(now);
      date.setUTCHours(3 + index * 6, 17, 0, 0);
      return date.getTime();
    }).find((time) => time > now);
    const populations =
      config.sourceMode === COMBAT_POWER
        ? Object.keys(regions).flatMap((region) =>
            classes.map((cls) => {
              const entry = active.find((e) => e.region === region && e.class === cls);
              const state =
                entry?.refreshStatus === "failed" ||
                (entry?.refreshStatus === "running" && entry.refreshLeaseExpiresAt <= now)
                  ? "failed"
                  : entry?.refreshStatus === "running" && entry.refreshLeaseExpiresAt > now
                    ? "warming"
                    : !entry?.buildCount
                      ? "missing"
                      : !entry.complete
                        ? "incomplete"
                        : entry.isExpired
                          ? "stale"
                          : "fresh";
              return {
                ...entry,
                region,
                class: cls,
                state,
                buildCount: entry?.buildCount || 0,
                expectedCount: entry?.expectedCount || 100,
                complete: entry?.complete || false,
                freshness: !entry?.buildCount ? "unavailable" : entry.isExpired ? "stale" : "fresh",
                refreshEligibleAt: entry?.fetchedAt
                  ? entry.fetchedAt + config.minRefreshMinutes * 60000
                  : now,
                nextScheduledRunAt,
              };
            })
          )
        : active;

    return Response.json(
      {
        enabled: config.enabled,
        sourceMode: config.sourceMode,
        cacheTtlMinutes: config.cacheTtlMinutes,
        totalCombinations: totalCombos,
        cachedCombinations: cached.length,
        retainedOtherPopulations: entries.length - active.length,
        freshEntries:
          config.sourceMode === COMBAT_POWER
            ? complete.filter((e) => !e.isExpired).length
            : freshCount,
        staleEntries:
          config.sourceMode === COMBAT_POWER
            ? complete.filter((e) => e.isExpired).length
            : staleCount,
        completeCombinations: complete.length,
        incompleteCombinations: cached.length - complete.length,
        lastSuccessfulRun:
          Math.max(0, ...complete.map((e) => e.lastSuccessfulRun || e.fetchedAt)) || null,
        nextScheduledRunAt,
        failedPopulations: populations.filter((e) => e.state === "failed"),
        populations,
        coveragePercent: totalCombos > 0 ? +((complete.length / totalCombos) * 100).toFixed(1) : 0,
        entries,
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (err) {
    return Response.json(
      { error: "Failed to fetch prefetch status" },
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
