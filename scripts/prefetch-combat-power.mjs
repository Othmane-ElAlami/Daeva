import { pathToFileURL } from "node:url";
import { fetchCharacterBuild } from "../src/lib/character-builds.js";
import { classes, createBudget, sleep } from "../src/lib/scraper-shared.js";
import { characterKey, normalizeRegion } from "../src/lib/regions.js";
import { COMBAT_POWER, CP_SOURCE } from "../src/lib/discovery-config.js";

// Only official build fetching runs here. The authenticated API owns discovery,
// freshness, leases, cache reuse, completeness checks and final D1 publication.
export async function runCombatPowerPrefetch({
  apiUrl,
  secret,
  cls,
  region,
  request = fetch,
  enrich = fetchCharacterBuild,
  wait = sleep,
  log = console.log,
}) {
  const url = new URL(apiUrl);
  if (
    !secret ||
    !classes.includes(cls) ||
    !normalizeRegion(region) ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  )
    throw new Error("Valid API_URL, ADMIN_SECRET, REGION and PREFETCH_CLASS are required.");
  region = normalizeRegion(region);
  const endpoint = `${apiUrl.replace(/\/$/, "")}/api/prefetch/run`;
  const base = { cls, region, leaderboard: COMBAT_POWER, execution: "runner" };
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${secret}` };
  let continuation;
  let enrichedBuild;
  let previousCount = -1;
  let waiting = 0;
  let requests = 0;
  let enrichedCount = 0;
  let phase = "api";
  let target = null;
  const safeText = (value, limit = 500) =>
    String(value).replaceAll(secret, "[redacted]").slice(0, limit);

  async function post(body) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let response;
      let data;
      let text = "";
      try {
        response = await request(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          redirect: "error",
          signal: AbortSignal.timeout(60000),
        });
        text = await response.text();
        data = JSON.parse(text);
      } catch {
        const code = text.match(/error code:\s*(\d{4})\b/i)?.[1];
        const status = response ? `HTTP ${response.status}` : "network/timeout";
        const detail = `${status}${code ? `, Cloudflare ${code}` : ""}`;
        if (attempt === 2 || [400, 401, 403, 404].includes(response?.status))
          throw new Error(
            `Prefetch API returned an unavailable or malformed response (${detail}).`
          );
        log(`${region}/${cls}: retrying API response (${detail}, attempt ${attempt + 1}/3)`);
        await wait(2000 * (attempt + 1));
        continue;
      }
      if (response.status === 202 && data?.inProgress === true) return { waiting: true };
      if (response.status === 503 && data?.code === "PREFETCH_DISABLED") return { disabled: true };
      if (!response.ok) {
        if ([500, 502, 503, 504].includes(response.status) && attempt < 2) {
          await wait(2000 * (attempt + 1));
          continue;
        }
        throw new Error(
          `Prefetch API failed (HTTP ${response.status}, ${safeText(data?.code || "unknown", 80)}).`
        );
      }
      if (
        data?.success !== true ||
        data.class !== cls ||
        data.region !== region ||
        data.leaderboard !== COMBAT_POWER ||
        data.errorCount !== 0 ||
        !Number.isInteger(data.playerCount) ||
        (data.complete !== true && !data.continuation)
      )
        throw new Error("Prefetch API returned an incomplete or invalid population.");
      return data;
    }
  }

  try {
    while (requests < 125) {
      phase = "api";
      const data = await post({
        ...base,
        continuation,
        ...(enrichedBuild ? { enrichedBuild } : {}),
      });
      if (data.disabled) {
        log(`${region}/${cls}: prefetch disabled`);
        return { skipped: true };
      }
      if (data.waiting) {
        if (++waiting >= 360) throw new Error("Population preparation wait limit reached.");
        await wait(5000);
        continue;
      }
      requests++;
      log(`${region}/${cls}: ${data.playerCount} builds prepared`);
      if (data.complete === true) {
        if (data.continuation || data.playerCount < 1)
          throw new Error("Prefetch API did not publish a complete population.");
        return { complete: true, buildCount: data.playerCount, enrichedCount, requests };
      }
      if (data.playerCount <= previousCount)
        throw new Error("Population preparation made no progress.");
      previousCount = data.playerCount;
      continuation = data.continuation;
      enrichedBuild = undefined;
      const player = data.enrichPlayer;
      if (!player) continue;
      phase = "enrichment";
      target = player;
      if (
        player.source !== CP_SOURCE ||
        player.region !== region ||
        player.class !== cls ||
        characterKey(player) !== characterKey(continuation.players?.[0] || {})
      )
        throw new Error("Enrichment target does not match the discovered population.");
      // Retry this character once, keeping all previously prepared characters.
      // Missing/mismatched profiles and incomplete item details never get uploaded.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const result = await enrich(player, null, createBudget(), { retryItemDetails: true });
          if (!result?.build || result.warnings?.length) {
            const error = new Error(
              `Official build details are incomplete: ${safeText(result?.warnings?.slice(0, 3).join("; ") || "missing build")}`
            );
            error.code = "ITEM_DETAILS_INCOMPLETE";
            throw error;
          }
          enrichedBuild = result.build;
          break;
        } catch (error) {
          // Item retries already retained the successful details; do not fetch
          // an entire character again for an unresolved item failure.
          if (attempt || error.code === "ITEM_DETAILS_INCOMPLETE") throw error;
          await wait(2000);
        }
      }
      enrichedCount++;
    }
    throw new Error("Population preparation batch limit reached.");
  } catch (error) {
    const context = `${region}/${cls} ${phase} at ${Math.max(previousCount, 0)} builds${target ? ` (${target.characterName || target.characterId}, rank ${target.rank})` : ""}`;
    const problem = new Error(safeText(`${context}: ${error.message}`));
    // Release the existing population lease without touching its last-good data.
    if (continuation?.refreshToken) {
      try {
        const response = await request(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({
            ...base,
            continuation,
            failed: true,
            failure: { phase, message: problem.message },
          }),
          redirect: "error",
          signal: AbortSignal.timeout(30000),
        });
        await response.body?.cancel();
      } catch {
        // If the API is unreachable, the bounded lease still expires normally.
      }
    }
    throw problem;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await runCombatPowerPrefetch({
      apiUrl: process.env.API_URL,
      secret: process.env.ADMIN_SECRET,
      cls: process.env.PREFETCH_CLASS,
      region: process.env.REGION,
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
