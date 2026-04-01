import { getRequestContext } from "@cloudflare/next-on-pages";

export const runtime = "edge";

export async function GET() {
  const { env } = getRequestContext();
  const db = env.DB;

  try {
    const { results } = await db
      .prepare(
        "SELECT class, leaderboard, total_players, stigma_skills, active_skills, passive_skills, arcana_set_combos, updated_at FROM meta_snapshots ORDER BY class, leaderboard"
      )
      .all();

    const snapshots = (results || []).map((row) => ({
      className: row.class,
      leaderboard: row.leaderboard,
      totalPlayers: row.total_players,
      stigmaSkills: JSON.parse(row.stigma_skills),
      activeSkills: JSON.parse(row.active_skills),
      passiveSkills: JSON.parse(row.passive_skills),
      arcanaSetCombos: JSON.parse(row.arcana_set_combos),
      updatedAt: row.updated_at,
    }));

    return new Response(JSON.stringify({ snapshots }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300, s-maxage=300",
      },
    });
  } catch (err) {
    if (err?.message && /no such table/i.test(err.message)) {
      return new Response(JSON.stringify({ snapshots: [] }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "Failed to fetch meta snapshots." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
