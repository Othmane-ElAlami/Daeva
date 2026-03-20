// ─────────────────────────────────────────────────────────────────────────────
// Structured Logger — shared between CLI (scraper.mjs) and Web (route.js)
// Levels: SUCCESS | INFO | WARN | ERROR
// Every entry includes: timestamp (ISO 8601 ms), context, level, message
// ─────────────────────────────────────────────────────────────────────────────

const LEVELS = {
  SUCCESS: "SUCCESS",
  INFO: "INFO",
  WARN: "WARN",
  ERROR: "ERROR",
};

// ── ANSI color codes for terminal output ─────────────────────────────────────
const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  // Level colors
  green: "\x1b[32m",
  blue: "\x1b[34m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  // Extras
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

const CLI_LEVEL_CONFIG = {
  SUCCESS: { icon: "✅", color: ANSI.green, label: "SUCCESS" },
  INFO: { icon: "ℹ️ ", color: ANSI.blue, label: "INFO   " },
  WARN: { icon: "⚠️ ", color: ANSI.yellow, label: "WARN   " },
  ERROR: { icon: "❌", color: ANSI.red, label: "ERROR  " },
};

function timestamp() {
  return new Date().toISOString();
}

// ── CLI Logger ───────────────────────────────────────────────────────────────
// Prints color-coded, icon-tagged log lines to the terminal.
//
//   ✅ SUCCESS [2026-03-19T02:52:00.123Z] (fetchLeaderboard) 100 players found
//   ℹ️  INFO    [2026-03-19T02:52:00.123Z] (main) Starting scan...
//
function createCliLogger() {
  function log(level, context, message) {
    const cfg = CLI_LEVEL_CONFIG[level];
    const ts = timestamp();
    const ctx = context ? `${ANSI.cyan}(${context})${ANSI.reset} ` : "";
    const line = `  ${cfg.icon} ${cfg.color}${ANSI.bold}${cfg.label}${ANSI.reset} ${ANSI.gray}[${ts}]${ANSI.reset} ${ctx}${message}`;
    if (level === LEVELS.ERROR) {
      console.error(line);
    } else {
      console.log(line);
    }
  }

  return {
    success: (context, message) => log(LEVELS.SUCCESS, context, message),
    info: (context, message) => log(LEVELS.INFO, context, message),
    warn: (context, message) => log(LEVELS.WARN, context, message),
    error: (context, message) => log(LEVELS.ERROR, context, message),
  };
}

// ── Web Logger ───────────────────────────────────────────────────────────────
// Emits structured SSE events via the provided `sendEvent` callback.
// The payload extends the existing { type: 'log', message } contract with
// additional fields: level, context, timestamp.
//
function createWebLogger(sendEvent) {
  function log(level, context, message) {
    const ts = timestamp();
    sendEvent({
      type: "log",
      level,
      context: context || "",
      timestamp: ts,
      message,
    });
  }

  return {
    success: (context, message) => log(LEVELS.SUCCESS, context, message),
    info: (context, message) => log(LEVELS.INFO, context, message),
    warn: (context, message) => log(LEVELS.WARN, context, message),
    error: (context, message) => log(LEVELS.ERROR, context, message),
  };
}

export { LEVELS, createCliLogger, createWebLogger };
