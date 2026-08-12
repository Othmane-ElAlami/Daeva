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

export const runtime = "edge";

export async function GET(request) {
  const { env } = getRequestContext();

  const { authorized } = await validateAdminRequest(request, env);
  if (!authorized) return unauthorizedResponse();

  try {
    const config = loadConfig();
    const entries = await getAllPrefetchEntries(env.DB);

    const totalCombos = classes.length * Object.keys(leaderboardTypes).length;
    const freshCount = entries.filter((e) => !e.isExpired).length;
    const staleCount = entries.filter((e) => e.isExpired).length;

    return Response.json(
      {
        enabled: config.enabled,
        cacheTtlMinutes: config.cacheTtlMinutes,
        totalCombinations: totalCombos,
        cachedCombinations: entries.length,
        freshEntries: freshCount,
        staleEntries: staleCount,
        coveragePercent: totalCombos > 0 ? +((entries.length / totalCombos) * 100).toFixed(1) : 0,
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
