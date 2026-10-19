import { pathToFileURL } from "node:url";

function invalidConfig() {
  return Object.assign(
    new Error("Prefetch configuration does not support this mode/class/region."),
    {
      code: "PREFETCH_CONFIG_INVALID",
      retryable: false,
    }
  );
}

function validateConfig(data, cls, region) {
  if (
    !["combat-power", "mode-specific"].includes(data?.sourceMode) ||
    !Array.isArray(data.classes) ||
    !data.classes.every((value) => typeof value === "string" && value) ||
    !data.classes.includes(cls) ||
    !Array.isArray(data.leaderboards) ||
    !data.leaderboards.every((value) => typeof value?.id === "string" && value.id) ||
    !data.leaderboards.some((value) =>
      data.sourceMode === "combat-power" ? value.id === "combat-power" : value.id !== "combat-power"
    ) ||
    (data.sourceMode === "combat-power" &&
      (!Array.isArray(data.regions) || !data.regions.some((value) => value?.id === region)))
  )
    throw invalidConfig();
  // Prefetch does not use the analyzer's server catalog.
  return {
    sourceMode: data.sourceMode,
    classes: data.classes,
    leaderboards: data.leaderboards,
    regions: data.regions,
  };
}

export async function loadPrefetchConfig({
  apiUrl,
  cls,
  region,
  request = fetch,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = console.error,
}) {
  let base;
  try {
    base = new URL(apiUrl);
  } catch {
    throw new Error("Valid API_URL, PREFETCH_CLASS and REGION are required.");
  }
  if (
    !cls ||
    !region ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    (base.protocol !== "https:" &&
      !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)))
  )
    throw new Error("Valid API_URL, PREFETCH_CLASS and REGION are required.");
  const url = `${base.href.replace(/\/$/, "")}/api/leaderboard/config`;
  for (let attempt = 0; attempt < 3; attempt++) {
    let detail = "network/timeout or interrupted response";
    let delay = 2000 * (attempt + 1);
    try {
      const response = await request(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
      detail = `HTTP ${response.status}`;
      if ([400, 401, 403, 404].includes(response.status)) {
        await response.body?.cancel();
        throw Object.assign(new Error(`Prefetch configuration unavailable (${detail}).`), {
          code: "PREFETCH_CONFIG_UNAVAILABLE",
          retryable: false,
        });
      }
      const retryAfter = response.headers.get("retry-after");
      if (retryAfter) {
        const requested = /^\d+$/.test(retryAfter)
          ? Number(retryAfter) * 1000
          : Date.parse(retryAfter) - Date.now();
        if (Number.isFinite(requested)) delay = Math.max(delay, requested);
      }
      if (
        !response.ok ||
        response.redirected ||
        !response.headers.get("content-type")?.includes("application/json")
      ) {
        if (response.ok) detail += ", unexpected content type or redirect";
        await response.body?.cancel();
        throw new Error();
      }
      detail += ", malformed or incomplete JSON";
      return validateConfig(await response.json(), cls, region);
    } catch (error) {
      if (error.retryable === false) throw error;
      if (attempt === 2 || delay > 60000)
        throw Object.assign(
          new Error(
            `Prefetch configuration unavailable after ${attempt + 1} attempt(s) (${detail}).`
          ),
          {
            code: "PREFETCH_CONFIG_UNAVAILABLE",
          }
        );
      log(
        `Prefetch configuration: ${detail}; retry ${attempt + 1}/2 in ${Math.ceil(delay / 1000)}s`
      );
      await wait(delay);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = await loadPrefetchConfig({
      apiUrl: process.env.API_URL,
      cls: process.env.PREFETCH_CLASS,
      region: process.env.REGION,
    });
    console.log(JSON.stringify(config));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
