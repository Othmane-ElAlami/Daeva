import { getRequestContext } from "@cloudflare/next-on-pages";
import { validateAdminRequest, unauthorizedResponse } from "@/lib/admin-auth";

export const runtime = "edge";

export async function GET(request) {
  const { env } = getRequestContext();

  const { authorized } = validateAdminRequest(request, env);
  if (!authorized) return unauthorizedResponse();

  const db = env.DB;

  try {
    // Get all table names
    const { results: tableRows } = await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
      )
      .all();

    const tables = [];

    for (const row of tableRows || []) {
      const tableName = row.name;

      // Get row count
      const countRow = await db.prepare(`SELECT COUNT(*) as count FROM "${tableName}"`).first();

      // Get column info
      const { results: columns } = await db.prepare(`PRAGMA table_info("${tableName}")`).all();

      tables.push({
        name: tableName,
        rowCount: countRow?.count ?? 0,
        columns: (columns || []).map((c) => ({
          name: c.name,
          type: c.type,
          pk: c.pk === 1,
        })),
      });
    }

    return new Response(JSON.stringify({ tables }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to fetch tables" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
