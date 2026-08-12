// ─────────────────────────────────────────────────────────────────────────────
// Prefetch System — Configuration
// ─────────────────────────────────────────────────────────────────────────────
// Reads tunable values from environment variables with sensible defaults.
// Set PREFETCH_ENABLED=false to reject all prefetch/run requests.
//
// Environment Variables:
//
//   PREFETCH_ENABLED          (default: true)
//     Master switch. Set to "false" to disable prefetch run endpoint.
//
//   PREFETCH_CACHE_TTL_MINUTES (default: 45)
//     How long cached data is considered fresh. Should be > cron interval.
// ─────────────────────────────────────────────────────────────────────────────

function envBool(key, fallback) {
  const val = process.env[key];
  if (val === undefined || val === "") return fallback;
  return val === "true" || val === "1";
}

function envInt(key, fallback) {
  const val = parseInt(process.env[key], 10);
  return Number.isFinite(val) ? val : fallback;
}

export function loadConfig() {
  return Object.freeze({
    enabled: envBool("PREFETCH_ENABLED", true),
    cacheTtlMinutes: envInt("PREFETCH_CACHE_TTL_MINUTES", 45),
  });
}
