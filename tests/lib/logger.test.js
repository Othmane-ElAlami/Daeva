// ─────────────────────────────────────────────────────────────────────────────
// Tests for src/lib/logger.js
// Covers: LEVELS, createCliLogger, createWebLogger
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  LEVELS,
  createCliLogger,
  createWebLogger,
} from "../../src/lib/logger.js";

describe("LEVELS", () => {
  it("has all four levels", () => {
    expect(LEVELS.SUCCESS).toBe("SUCCESS");
    expect(LEVELS.INFO).toBe("INFO");
    expect(LEVELS.WARN).toBe("WARN");
    expect(LEVELS.ERROR).toBe("ERROR");
  });

  it("has exactly 4 levels", () => {
    expect(Object.keys(LEVELS)).toHaveLength(4);
  });
});

describe("createCliLogger", () => {
  let consoleSpy, consoleErrorSpy;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("returns an object with success, info, warn, error methods", () => {
    const log = createCliLogger();
    expect(typeof log.success).toBe("function");
    expect(typeof log.info).toBe("function");
    expect(typeof log.warn).toBe("function");
    expect(typeof log.error).toBe("function");
  });

  it("success logs to console.log", () => {
    const log = createCliLogger();
    log.success("test", "message");
    expect(consoleSpy).toHaveBeenCalledOnce();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain("SUCCESS");
    expect(output).toContain("message");
    expect(output).toContain("test");
  });

  it("info logs to console.log", () => {
    const log = createCliLogger();
    log.info("ctx", "info message");
    expect(consoleSpy).toHaveBeenCalledOnce();
    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain("INFO");
    expect(output).toContain("info message");
  });

  it("warn logs to console.log", () => {
    const log = createCliLogger();
    log.warn("ctx", "warning message");
    expect(consoleSpy).toHaveBeenCalledOnce();
    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain("WARN");
    expect(output).toContain("warning message");
  });

  it("error logs to console.error", () => {
    const log = createCliLogger();
    log.error("ctx", "error message");
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    expect(consoleSpy).not.toHaveBeenCalled();
    const output = consoleErrorSpy.mock.calls[0][0];
    expect(output).toContain("ERROR");
    expect(output).toContain("error message");
  });

  it("includes ISO timestamp in output", () => {
    const log = createCliLogger();
    log.info("ctx", "msg");
    const output = consoleSpy.mock.calls[0][0];
    // ISO 8601 pattern like 2026-03-31T...
    expect(output).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("includes context in parentheses", () => {
    const log = createCliLogger();
    log.info("myContext", "msg");
    const output = consoleSpy.mock.calls[0][0];
    expect(output).toContain("(myContext)");
  });

  it("handles empty context", () => {
    const log = createCliLogger();
    log.info("", "no context");
    expect(consoleSpy).toHaveBeenCalled();
  });
});

describe("createWebLogger", () => {
  it("returns an object with success, info, warn, error methods", () => {
    const sendEvent = vi.fn();
    const log = createWebLogger(sendEvent);
    expect(typeof log.success).toBe("function");
    expect(typeof log.info).toBe("function");
    expect(typeof log.warn).toBe("function");
    expect(typeof log.error).toBe("function");
  });

  it("success emits SSE event with correct structure", () => {
    const sendEvent = vi.fn();
    const log = createWebLogger(sendEvent);
    log.success("scan", "Player found");

    expect(sendEvent).toHaveBeenCalledOnce();
    const event = sendEvent.mock.calls[0][0];
    expect(event.type).toBe("log");
    expect(event.level).toBe("SUCCESS");
    expect(event.context).toBe("scan");
    expect(event.message).toBe("Player found");
    expect(event.timestamp).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("info emits SSE event with level INFO", () => {
    const sendEvent = vi.fn();
    const log = createWebLogger(sendEvent);
    log.info("cache", "Cache hit");

    const event = sendEvent.mock.calls[0][0];
    expect(event.level).toBe("INFO");
    expect(event.context).toBe("cache");
  });

  it("warn emits SSE event with level WARN", () => {
    const sendEvent = vi.fn();
    const log = createWebLogger(sendEvent);
    log.warn("fetch", "Retry needed");

    const event = sendEvent.mock.calls[0][0];
    expect(event.level).toBe("WARN");
  });

  it("error emits SSE event with level ERROR", () => {
    const sendEvent = vi.fn();
    const log = createWebLogger(sendEvent);
    log.error("POST", "Fatal error");

    const event = sendEvent.mock.calls[0][0];
    expect(event.level).toBe("ERROR");
    expect(event.message).toBe("Fatal error");
  });

  it("handles empty context as empty string", () => {
    const sendEvent = vi.fn();
    const log = createWebLogger(sendEvent);
    log.info("", "no context");

    const event = sendEvent.mock.calls[0][0];
    expect(event.context).toBe("");
  });

  it("sends multiple events independently", () => {
    const sendEvent = vi.fn();
    const log = createWebLogger(sendEvent);
    log.info("ctx1", "msg1");
    log.success("ctx2", "msg2");
    log.error("ctx3", "msg3");

    expect(sendEvent).toHaveBeenCalledTimes(3);
    expect(sendEvent.mock.calls[0][0].level).toBe("INFO");
    expect(sendEvent.mock.calls[1][0].level).toBe("SUCCESS");
    expect(sendEvent.mock.calls[2][0].level).toBe("ERROR");
  });
});
