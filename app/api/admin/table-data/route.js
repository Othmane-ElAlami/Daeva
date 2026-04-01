import { getRequestContext } from "@cloudflare/next-on-pages";

export const runtime = "edge";

export async function GET(request) {
  const { env } = getRequestContext();
  const db = env.DB;
  const { searchParams } = new URL(request.url);
  const table = searchParams.get("table");

  if (!table) {
    return new Response(JSON.stringify({ error: "Missing table parameter" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Validate table name against actual tables to prevent injection
  const { results: tableRows } = await db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .bind(table)
    .all();

  if (!tableRows || tableRows.length === 0) {
    return new Response(JSON.stringify({ error: "Table not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const { results: rows } = await db
      .prepare(`SELECT * FROM "${table}" LIMIT 500`)
      .all();

    return new Response(JSON.stringify({ rows: rows || [] }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Failed to fetch table data" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
