import { getRequestContext } from "@cloudflare/next-on-pages";
import { validateAdminRequest, unauthorizedResponse } from "@/lib/admin-auth";
import { getExpectedTableNames } from "@/lib/migrations-manifest";

export const runtime = "edge";

export async function GET(request) {
  const { env } = getRequestContext();

  const { authorized } = await validateAdminRequest(request, env);
  if (!authorized) return unauthorizedResponse();

  const db = env.DB;

  try {
    const analytics = {
      tables: {},
      scrapeActivity: {},
      rateLimits: {},
      metaSnapshots: {},
      dataHealth: {},
      adminEvents: [],
      lastReset: null,
    };

    // ─── Table Row Counts ───
    const { results: tableRows } = await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
      )
      .all();

    const existingTableNames = new Set();
    let totalRows = 0;

    for (const row of tableRows || []) {
      existingTableNames.add(row.name);
      const countRow = await db.prepare(`SELECT COUNT(*) as count FROM "${row.name}"`).first();
      const count = countRow?.count ?? 0;
      analytics.tables[row.name] = count;
      totalRows += count;
    }
    analytics.totalRows = totalRows;
    analytics.totalTables = existingTableNames.size;

    // ─── Scrape Activity (player_cache based on fetched_at) ───
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    if (existingTableNames.has("player_cache")) {
      const total = analytics.tables["player_cache"] || 0;
      const last24h = await db
        .prepare("SELECT COUNT(*) as c FROM player_cache WHERE fetched_at > ?")
        .bind(now - day)
        .first();
      const last7d = await db
        .prepare("SELECT COUNT(*) as c FROM player_cache WHERE fetched_at > ?")
        .bind(now - 7 * day)
        .first();
      const last30d = await db
        .prepare("SELECT COUNT(*) as c FROM player_cache WHERE fetched_at > ?")
        .bind(now - 30 * day)
        .first();

      analytics.scrapeActivity = {
        total,
        last24h: last24h?.c ?? 0,
        last7d: last7d?.c ?? 0,
        last30d: last30d?.c ?? 0,
      };

      // Daily scrape counts for last 30 days (for chart)
      const dailyCounts = [];
      for (let i = 29; i >= 0; i--) {
        const dayStart = now - (i + 1) * day;
        const dayEnd = now - i * day;
        const row = await db
          .prepare(
            "SELECT COUNT(*) as c FROM player_cache WHERE fetched_at > ? AND fetched_at <= ?"
          )
          .bind(dayStart, dayEnd)
          .first();
        dailyCounts.push({
          date: new Date(dayEnd).toISOString().slice(0, 10),
          count: row?.c ?? 0,
        });
      }
      analytics.scrapeActivity.daily = dailyCounts;
    }

    // ─── Rate Limit Hits ───
    if (existingTableNames.has("rate_limits")) {
      const total = analytics.tables["rate_limits"] || 0;
      analytics.rateLimits = { total };
    }

    if (existingTableNames.has("login_attempts")) {
      const loginTotal = analytics.tables["login_attempts"] || 0;
      analytics.rateLimits.loginAttemptIPs = loginTotal;
    }

    // ─── Meta Snapshots ───
    if (existingTableNames.has("meta_snapshots")) {
      const count = analytics.tables["meta_snapshots"] || 0;
      const latest = await db
        .prepare("SELECT MAX(updated_at) as latest FROM meta_snapshots")
        .first();
      analytics.metaSnapshots = {
        count,
        latestUpdate: latest?.latest ?? null,
      };
    }

    // ─── Data Health ───
    const expectedTables = getExpectedTableNames();
    const missingFromDB = [];
    const unexpectedInDB = [];
    const emptyExpected = [];

    for (const name of expectedTables) {
      if (!existingTableNames.has(name)) {
        missingFromDB.push(name);
      } else if ((analytics.tables[name] || 0) === 0) {
        emptyExpected.push(name);
      }
    }

    for (const name of existingTableNames) {
      if (!expectedTables.has(name)) {
        unexpectedInDB.push(name);
      }
    }

    analytics.dataHealth = {
      missingFromDB,
      unexpectedInDB,
      emptyExpected,
      healthy: missingFromDB.length === 0 && unexpectedInDB.length === 0,
    };

    // ─── Admin Events (last 20) ───
    if (existingTableNames.has("admin_events")) {
      const { results: events } = await db
        .prepare(
          "SELECT id, event_type, metadata, created_at FROM admin_events ORDER BY created_at DESC LIMIT 20"
        )
        .all();
      analytics.adminEvents = events || [];

      // Last reset
      const lastReset = await db
        .prepare(
          "SELECT metadata, created_at FROM admin_events WHERE event_type = 'reset' ORDER BY created_at DESC LIMIT 1"
        )
        .first();
      if (lastReset) {
        analytics.lastReset = {
          metadata: lastReset.metadata ? JSON.parse(lastReset.metadata) : null,
          createdAt: lastReset.created_at,
        };
      }
    }

    return new Response(JSON.stringify(analytics), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to fetch analytics" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
