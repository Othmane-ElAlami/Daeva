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

    return Response.json(
      {
        enabled: config.enabled,
        sourceMode: config.sourceMode,
        cacheTtlMinutes: config.cacheTtlMinutes,
        totalCombinations: totalCombos,
        cachedCombinations: active.length,
        retainedOtherPopulations: entries.length - active.length,
        freshEntries: freshCount,
        staleEntries: staleCount,
        coveragePercent: totalCombos > 0 ? +((active.length / totalCombos) * 100).toFixed(1) : 0,
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
