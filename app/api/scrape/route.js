import { getRequestContext } from "@cloudflare/next-on-pages";
import { createWebLogger } from "@/lib/logger";
import { analyze, validateContinuation } from "@/lib/analyzer";
import { historicalSnapshot, saveMetaSnapshot } from "@/lib/meta-snapshots";
import { getPrefetchCache, setPrefetchCache } from "@/lib/prefetch/cache";
import { loadConfig } from "@/lib/prefetch/config";
import { getSourceMode, isHistoricalOnly, COMBAT_POWER, CP_SOURCE } from "@/lib/discovery-config";
import { normalizeRegion, normalizeFaction } from "@/lib/regions";
import { leaderboardTypes, classRankingIds, createWorkerBudget } from "@/lib/scraper-shared";

export const runtime = "edge";

function sanitizeErrorMessage(message) {
  if (
    /subrequest|worker invocation|cloudflare|wrangler|D1_ERROR|SQLITE|too many|binding|UnsafeEval/i.test(
      message
    )
  )
    return "The server is temporarily busy. Please try again with a smaller limit or wait a moment.";
  return "An unexpected error occurred. Please try again.";
}

async function logScrapeEvent(db, type, metadata) {
  if (!db) return;
  try {
    await db
      .prepare("INSERT INTO admin_events (event_type, metadata, created_at) VALUES (?, ?, ?)")
      .bind(type, JSON.stringify(metadata), Date.now())
      .run();
  } catch {
    /* Logging cannot fail an analysis. */
  }
}

export async function POST(req) {
  const { env } = getRequestContext();
  const db = env.DB;
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!body || !Object.hasOwn(leaderboardTypes, body.lbType))
    return Response.json({ error: "Invalid leaderboard type." }, { status: 400 });
  if (!Object.hasOwn(classRankingIds, body.cls))
    return Response.json({ error: "Invalid class." }, { status: 400 });
  const sourceMode = getSourceMode(env);
  const historicalOnly = isHistoricalOnly(body.lbType, sourceMode);
  const region =
    body.lbType === COMBAT_POWER ? normalizeRegion(body.region || "GLOBAL") : body.region || "all";
  if (!region || (region !== "all" && !normalizeRegion(region)))
    return Response.json(
      { error: "Invalid region. Select Global, Korea or Taiwan separately." },
      { status: 400 }
    );
  if (body.lbType !== COMBAT_POWER && region === "GLOBAL")
    return Response.json({ error: "Global supports Combat Power analysis only." }, { status: 400 });
  const race = body.race && body.race !== "all" ? normalizeFaction(body.race) : "all";
  if (!race) return Response.json({ error: "Invalid faction." }, { status: 400 });
  const serverId = body.serverId || "all";
  if (serverId !== "all" && !/^\d{4}$/.test(String(serverId)))
    return Response.json({ error: "Invalid server." }, { status: 400 });
  const runeFilter = body.runeFilter || "all";
  if (!["all", "pve", "pvp"].includes(runeFilter))
    return Response.json({ error: "Invalid rune filter." }, { status: 400 });
  if (
    historicalOnly &&
    (region !== "all" || serverId !== "all" || race !== "all" || runeFilter !== "all")
  )
    return Response.json(
      { error: "Historical aggregates cannot be filtered by region, server, faction or rune." },
      { status: 400 }
    );
  const config = {
    lbType: body.lbType,
    cls: body.cls,
    limit: Math.max(1, Math.min(parseInt(body.limit, 10) || 10, 100)),
    region,
    race,
    serverId,
    runeFilter,
    sourceMode,
    continuation: body.continuation,
  };
  if (config.continuation && !validateContinuation(config.continuation, config))
    return Response.json({ error: "Invalid continuation population." }, { status: 400 });

  if (!config.continuation && db) {
    const ip = req.headers.get("cf-connecting-ip") || "unknown";
    const now = Date.now();
    try {
      const row = await db
        .prepare("SELECT last_request_at FROM rate_limits WHERE ip = ?")
        .bind(ip)
        .first();
      if (row && now - row.last_request_at < 1000)
        return Response.json(
          { error: "Rate limit exceeded. Please wait 1s before starting another analysis." },
          { status: 429, headers: { "Retry-After": "1" } }
        );
      await db
        .prepare(
          "INSERT INTO rate_limits (ip, last_request_at) VALUES (?, ?) ON CONFLICT(ip) DO UPDATE SET last_request_at = excluded.last_request_at"
        )
        .bind(ip, now)
        .run();
    } catch (error) {
      if (!/no such table/i.test(error.message))
        console.error("[rate-limit] DB error:", error.message);
    }
  }

  const encoder = new TextEncoder();
  let active = true;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event) => {
        if (!active) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          active = false;
        }
      };
      const log = createWebLogger(send);
      const done = (result) => {
        send({ type: "source_health", meta: result.sourceMeta });
        send({ type: "done", ...result });
      };
      try {
        await logScrapeEvent(db, "analysis_start", {
          cls: config.cls,
          lbType: config.lbType,
          region,
          limit: config.limit,
        });
        if (historicalOnly) {
          const snapshot = await historicalSnapshot(db, config);
          if (snapshot) done(snapshot);
          else
            send({
              type: "error",
              message: `No historical ${leaderboardTypes[config.lbType].label} snapshot is available. Live mode-specific rankings remain unavailable.`,
            });
          return;
        }
        log.info(
          "leaderboard",
          `Discovering top ${config.limit} ${config.cls} players by ${leaderboardTypes[config.lbType].label} (${region})...`
        );
        const result = await analyze(config, {
          db,
          budget: createWorkerBudget(env),
          onEvent: (event) => {
            if (event.type === "player") {
              const build = event.build;
              log.success(
                "scan",
                `${build.name} · ${build.serverName} · ${build.region} · CP ${build.combatPower.toLocaleString()} · GS ${build.gearScore}`
              );
            } else send(event);
          },
        });
        if (result.continuation) {
          await logScrapeEvent(db, "analysis_continue", {
            cls: config.cls,
            lbType: config.lbType,
            region,
            processed: result.builds.length,
          });
          send({ type: "continue", ...result.continuation });
          return;
        }
        if (result.errors.length)
          log.warn(
            "build",
            `${result.errors.length} character/item fetches were incomplete. Showing ${result.count} available builds.`
          );
        if (result.sourceMeta.source !== "Cache") {
          try {
            if (
              serverId === "all" &&
              race === "all" &&
              runeFilter === "all" &&
              (config.lbType === COMBAT_POWER || region === "all")
            ) {
              await saveMetaSnapshot(db, config, result.stats);
              const existing = await getPrefetchCache(db, config.cls, config.lbType, true, region);
              if (!existing || existing.builds.length <= result.builds.length) {
                await setPrefetchCache(
                  db,
                  config.cls,
                  config.lbType,
                  result.stats,
                  result.builds,
                  loadConfig(env).cacheTtlMinutes * 60000,
                  config.lbType === COMBAT_POWER ? CP_SOURCE : result.sourceMeta.source,
                  region
                );
              }
            }
          } catch (error) {
            console.error("[analysis-cache] Save failed:", error.message);
          }
        }
        await logScrapeEvent(db, "analysis_done", {
          cls: config.cls,
          lbType: config.lbType,
          region,
          count: result.count,
          source: result.sourceMeta.source,
        });
        done(result);
      } catch (error) {
        if (error.name === "AllProvidersFailedError") {
          let snapshot;
          try {
            snapshot = await historicalSnapshot(db, config);
          } catch {
            /* Cache may also be unavailable. */
          }
          if (snapshot) {
            done(snapshot);
            return;
          }
          send({
            type: "source_health",
            meta: {
              source: config.lbType === COMBAT_POWER ? CP_SOURCE : "Unavailable",
              leaderboardType: config.lbType,
              region,
              health: "unavailable",
              basis: leaderboardTypes[config.lbType].label,
            },
          });
        }
        const message =
          error.name === "AllProvidersFailedError"
            ? "Live discovery and matching cached builds are unavailable. No historical snapshot exists for this population. You can select a historical game mode separately."
            : sanitizeErrorMessage(error.message || "");
        log.error("analysis", message);
        await logScrapeEvent(db, "analysis_error", {
          cls: config.cls,
          lbType: config.lbType,
          region,
          message,
          raw: error.message?.slice(0, 300),
        });
        send({ type: "error", message });
      } finally {
        if (active) {
          controller.close();
          active = false;
        }
      }
    },
    cancel() {
      active = false;
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
