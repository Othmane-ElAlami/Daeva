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
//   PREFETCH_CACHE_TTL_MINUTES (default: 420 for CP, 45 for mode-specific)
//     How long cached data is considered fresh. Should be > cron interval.
//   PREFETCH_MIN_REFRESH_MINUTES (default: 330 for CP, 25 otherwise)
//     Skip recently completed jobs, including retries and manual dispatches.
// ─────────────────────────────────────────────────────────────────────────────

import { getSourceMode, COMBAT_POWER } from "../discovery-config.js";

function envBool(key, fallback, env) {
  const val = env[key] ?? process.env[key];
  if (val === undefined || val === "") return fallback;
  return val === "true" || val === "1";
}

function envInt(key, fallback, env) {
  const val = parseInt(env[key] ?? process.env[key], 10);
  return Number.isFinite(val) && val > 0 ? val : fallback;
}

export function loadConfig(env = {}) {
  const sourceMode = getSourceMode(env);
  return Object.freeze({
    enabled: envBool("PREFETCH_ENABLED", true, env),
    sourceMode,
    cacheTtlMinutes: envInt(
      "PREFETCH_CACHE_TTL_MINUTES",
      sourceMode === COMBAT_POWER ? 420 : 45,
      env
    ),
    minRefreshMinutes: envInt(
      "PREFETCH_MIN_REFRESH_MINUTES",
      sourceMode === COMBAT_POWER ? 330 : 25,
      env
    ),
  });
}
