// ─────────────────────────────────────────────────────────────────────────────
// Prefetch System — Public API
// ─────────────────────────────────────────────────────────────────────────────
// Re-exports the D1-backed cache, runner, and config for use by route handlers.
// ─────────────────────────────────────────────────────────────────────────────

export {
  getPrefetchCache,
  setPrefetchCache,
  getAllPrefetchEntries,
  clearPrefetchCache,
} from "./cache.js";
export { loadConfig } from "./config.js";
export { runPrefetchJob } from "./runner.js";
