import { afterEach, describe, expect, it, vi } from "vitest";
import { createScheduledJSON } from "../src/lib/prefetch/upstream.js";
import { createBudget, fetchJSON, subrequestBudgetExhausted } from "../src/lib/scraper-shared.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function clocked(options = {}) {
  let time = 1000;
  const wait = vi.fn(async (ms) => {
    time += ms;
  });
  return { ...createScheduledJSON({ wait, now: () => time, ...options }), wait, now: () => time };
}

describe("scheduled upstream transport", () => {
  it("keeps request spacing with four item workers waiting for slow responses", async () => {
    vi.useFakeTimers();
    const starts = [];
    const request = vi.fn(async () => {
      starts.push(Date.now());
      await new Promise((resolve) => setTimeout(resolve, 1800));
      return { ok: true };
    });
    const transport = createScheduledJSON({ request });
    const pending = Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        transport.json(`https://example.com/item-${index}`, {})
      )
    );
    await vi.advanceTimersByTimeAsync(4000);
    await pending;
    expect(starts).toHaveLength(4);
    expect(starts.slice(1).every((time, index) => time - starts[index] >= 500)).toBe(true);
  });
  it("honors Retry-After and pauses queued requests to the same host", async () => {
    vi.useFakeTimers();
    const starts = [];
    let retryAt;
    const transport = createScheduledJSON({
      onRetry: ({ delayMs }) => {
        retryAt = Date.now() + delayMs;
      },
    });
    const request = vi.fn(async () => {
      starts.push(Date.now());
      return starts.length === 1
        ? new Response("rate limited", { status: 429, headers: { "Retry-After": "45" } })
        : Response.json({ id: 1 });
    });
    vi.stubGlobal("fetch", request);
    const budget = createBudget();
    const pending = Promise.all(
      ["info", "equipment"].map((path) =>
        transport.json(`https://aion2.plaync.com/api/character/${path}`, {}, "GET", null, budget)
      )
    );
    await vi.advanceTimersByTimeAsync(60000);
    await pending;
    expect(starts).toHaveLength(3);
    expect(starts.slice(1).every((time) => time >= retryAt)).toBe(true);
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(500);
    expect(budget.used).toBe(3);
    expect(transport.metrics).toEqual({ retries: 1, rateLimits: 1, transportFallbacks: 0 });
  });

  it("preserves HTTP-date Retry-After and keeps the timeout active while reading the body", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response("limited", {
            status: 429,
            headers: { "Retry-After": "Thu, 15 Oct 2026 12:01:00 GMT" },
          })
        )
        .mockImplementationOnce(async (_url, options) => ({
          ok: true,
          json: () =>
            new Promise((_resolve, reject) => {
              options.signal.addEventListener("abort", () =>
                reject(new DOMException("Aborted", "AbortError"))
              );
            }),
        }))
    );
    await expect(fetchJSON("https://example.com/limited", {})).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 60000,
    });
    const timed = expect(
      fetchJSON("https://example.com/body", {}, "GET", null, null, null, 1000)
    ).rejects.toMatchObject({
      name: "UpstreamTimeoutError",
      code: "UPSTREAM_TIMEOUT",
      message: "Request timed out after 1000ms",
    });
    await vi.advanceTimersByTimeAsync(1000);
    await timed;
  });

  it("retries incomplete JSON but never accepts a mismatched identity", async () => {
    const request = vi.fn().mockResolvedValueOnce({}).mockResolvedValue({ id: "expected" });
    const transport = clocked({ request });
    const validate = (data) => {
      if (!data.id) throw Object.assign(new Error("Profile unavailable"), { retryable: true });
    };
    expect(
      await transport.json("https://example.com/info", {}, "GET", null, null, null, 20000, validate)
    ).toEqual({ id: "expected" });
    expect(request).toHaveBeenCalledTimes(2);
    const mismatch = () => {
      throw Object.assign(new Error("Wrong ID"), { retryable: false });
    };
    await expect(
      transport.json("https://example.com/info", {}, "GET", null, null, null, 20000, mismatch)
    ).rejects.toThrow("Wrong ID");
    expect(request).toHaveBeenCalledTimes(3);
  });

  it.each([401, 403])("does not retry terminal HTTP %s", async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unavailable", { status }))
    );
    const transport = clocked();
    await expect(transport.json("https://example.com/item", {})).rejects.toMatchObject({ status });
    expect(fetch).toHaveBeenCalledOnce();
    expect(transport.metrics.retries).toBe(0);
  });

  it("retries transient official 404 responses before treating a resource as unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("not found", { status: 404 }))
        .mockResolvedValueOnce(Response.json({ id: 1 }))
        .mockResolvedValue(new Response("not found", { status: 404 }))
    );
    const transport = clocked();
    expect(await transport.json("https://example.com/item", {})).toEqual({ id: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
    await expect(transport.json("https://example.com/missing", {})).rejects.toMatchObject({
      status: 404,
      retryExhausted: true,
    });
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(transport.metrics.retries).toBe(3);
    expect(transport.wait.mock.calls.flat()).toContain(15000);
  });
  it.each(["404", "missing-stats"])(
    "hands an unavailable direct %s to its fallback without retry delays",
    async (failure) => {
      const request = vi.fn(async () => {
        throw Object.assign(
          new Error("Unavailable"),
          failure === "404" ? { status: 404 } : { code: "STATS_UNAVAILABLE", retryable: true }
        );
      });
      const transport = clocked({ request });
      await expect(
        transport.json("https://example.com/info", {}, "GET", null, null, null, 20000, undefined, {
          fallbackAvailable: true,
        })
      ).rejects.toThrow("Unavailable");
      expect(request).toHaveBeenCalledOnce();
      expect(transport.wait).not.toHaveBeenCalled();
      expect(transport.metrics).toEqual({ retries: 0, rateLimits: 0, transportFallbacks: 1 });
    }
  );

  it("fails bounded cooldowns without retrying before a long Retry-After", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("limited", {
            status: 429,
            headers: { "Retry-After": "900" },
          })
      )
    );
    const transport = clocked();
    await expect(transport.json("https://example.com/item", {})).rejects.toMatchObject({
      retryExhausted: true,
    });
    await expect(transport.json("https://example.com/next", {})).rejects.toMatchObject({
      retryExhausted: true,
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(transport.wait).not.toHaveBeenCalled();
  });
  it("keeps per-request recovery after ten minutes of unrelated 404 retry delays", async () => {
    const attempted = new Set();
    const request = vi.fn(async (url) => {
      if (url.endsWith("/too-long"))
        throw Object.assign(new Error("HTTP 429"), { status: 429, retryAfterMs: 900000 });
      if (!attempted.has(url)) {
        attempted.add(url);
        const status = url.endsWith("/limited") ? 429 : 404;
        throw Object.assign(new Error(`HTTP ${status}`), { status });
      }
      return { id: url };
    });
    const transport = clocked({ request });
    for (let index = 0; index < 130; index++) {
      const url = `https://example.com/item-${index}`;
      expect(await transport.json(url, {})).toEqual({ id: url });
    }
    expect(request).toHaveBeenCalledTimes(260);
    expect(transport.metrics.retries).toBe(130);
    expect(await transport.json("https://example.com/limited", {})).toEqual({
      id: "https://example.com/limited",
    });
    expect(transport.metrics.retries).toBe(131);
    await expect(transport.json("https://example.com/too-long", {})).rejects.toMatchObject({
      status: 429,
      retryExhausted: true,
    });
    expect(request).toHaveBeenCalledTimes(263);
  });
  it("stops every host at the job deadline without oversleeping or retrying", async () => {
    const request = vi.fn(async () => {
      throw Object.assign(new Error("HTTP 404"), { status: 404 });
    });
    const transport = clocked({ request, maxDurationMs: 2000 });
    await expect(transport.json("https://example.com/item", {})).rejects.toMatchObject({
      code: "PREFETCH_DEADLINE",
      retryable: false,
    });
    await expect(transport.json("https://shugo.gg/proxy", {})).rejects.toMatchObject({
      code: "PREFETCH_DEADLINE",
    });
    expect(request).toHaveBeenCalledOnce();
    expect(transport.now()).toBe(3000);
  });

  it("stops all transports after losing the population lease", async () => {
    const lost = Object.assign(new Error("Lease lost"), { code: "LEASE_LOST", retryable: false });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("limited", { status: 429 }))
    );
    const transport = clocked({
      onWait: async () => {
        throw lost;
      },
    });
    await expect(transport.json("https://example.com/item", {})).rejects.toBe(lost);
    await expect(transport.json("https://shugo.gg/api/proxy", {})).rejects.toBe(lost);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("never retries an exhausted subrequest budget", async () => {
    const budget = createBudget({ hardLimit: 1, safetyMargin: 0 });
    const request = vi.fn();
    const transport = clocked({ request });
    await expect(
      transport.json("https://example.com/item", {}, "GET", null, budget)
    ).rejects.toBeInstanceOf(subrequestBudgetExhausted);
    expect(request).not.toHaveBeenCalled();
  });
});
