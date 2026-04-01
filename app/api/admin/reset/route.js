import { getRequestContext } from "@cloudflare/next-on-pages";

export const runtime = "edge";

export async function POST() {
  const { env } = getRequestContext();
  const db = env.DB;

  try {
    // Get all user-created tables
    const { results: tableRows } = await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
      )
      .all();

    const deleted = [];

    for (const row of tableRows || []) {
      await db.prepare(`DELETE FROM "${row.name}"`).run();
      deleted.push(row.name);
    }

    return new Response(JSON.stringify({ success: true, cleared: deleted }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to reset database" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
