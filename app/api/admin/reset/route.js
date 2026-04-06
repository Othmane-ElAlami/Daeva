import { getRequestContext } from "@cloudflare/next-on-pages";
import { validateAdminRequest, unauthorizedResponse } from "@/lib/admin-auth";
import { migrations, getExpectedTableNames } from "@/lib/migrations-manifest";

export const runtime = "edge";

export async function POST(request) {
  const { env } = getRequestContext();

  const { authorized } = validateAdminRequest(request, env);
  if (!authorized) return unauthorizedResponse();

  const db = env.DB;

  const result = { reset: [], created: [], skipped: [], errors: [] };

  try {
    // Get all existing user-created tables
    const { results: tableRows } = await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
      )
      .all();

    const existingTables = new Set((tableRows || []).map((r) => r.name));
    const expectedTables = getExpectedTableNames();

    // Create missing tables from manifest
    for (const migration of migrations) {
      if (!existingTables.has(migration.tableName)) {
        try {
          await db.prepare(migration.createSQL).run();
          result.created.push(migration.tableName);
        } catch (err) {
          result.errors.push({
            table: migration.tableName,
            action: "create",
            message: err.message || "Unknown error",
          });
        }
      }
    }

    // Clear rows from all expected tables that exist (including just-created ones)
    for (const migration of migrations) {
      try {
        await db.prepare(`DELETE FROM "${migration.tableName}"`).run();
        result.reset.push(migration.tableName);
      } catch (err) {
        result.errors.push({
          table: migration.tableName,
          action: "reset",
          message: err.message || "Unknown error",
        });
      }
    }

    // Identify unknown tables (exist in DB but not in manifest)
    for (const tableName of existingTables) {
      if (!expectedTables.has(tableName)) {
        result.skipped.push(tableName);
      }
    }

    // Log the reset event
    try {
      await db
        .prepare(
          "CREATE TABLE IF NOT EXISTS admin_events (id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, metadata TEXT, created_at INTEGER NOT NULL)"
        )
        .run();
      await db
        .prepare("INSERT INTO admin_events (event_type, metadata, created_at) VALUES (?, ?, ?)")
        .bind("reset", JSON.stringify(result), Date.now())
        .run();
    } catch {
      // non-critical — don't fail the reset
    }

    return new Response(JSON.stringify(result), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to reset database" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
