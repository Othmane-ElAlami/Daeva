import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import { rootCertificates } from "node:tls";
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
  it("supplies a public intermediate signed by an existing trusted root", () => {
    const certificate = new X509Certificate(
      readFileSync(new URL("../scripts/certs/sectigo-ov-r36.pem", import.meta.url))
    );
    expect(certificate.ca).toBe(true);
    expect(certificate.fingerprint256.replaceAll(":", "")).toBe(
      "6542D176BED50F193C0CE297AE44ECD8A0A86BEC2EDE682769344059B4E78530"
    );
    const issuer = rootCertificates
      .map((pem) => new X509Certificate(pem))
      .find((root) => certificate.checkIssued(root) && certificate.verify(root.publicKey));
    expect(issuer?.subject).toContain("Sectigo Public Server Authentication Root R46");
  });
  it.each(["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "ERR_TLS_CERT_ALTNAME_INVALID"])(
    "reports %s and stops retrying that host without weakening TLS",
    async (code) => {
      const fetch = vi.fn(async (url) => {
        if (new URL(url).host === "tw.ncsoft.com")
          throw new TypeError("fetch failed", { cause: Object.assign(new Error(code), { code }) });
        return Response.json({ id: 1 });
      });
      vi.stubGlobal("fetch", fetch);
      const transport = clocked();
      for (const path of ["equipment", "equipment/item"])
        await expect(transport.json(`https://tw.ncsoft.com/${path}`, {})).rejects.toMatchObject({
          code: "UPSTREAM_TLS",
          retryable: false,
          cause: { code },
          message: expect.stringContaining(code),
        });
      expect(fetch).toHaveBeenCalledOnce();
      expect(transport.metrics.retries).toBe(0);
      expect(await transport.json("https://shugo.gg/api/proxy", {})).toEqual({ id: 1 });
    }
  );
  it.each([502, 503])("shares HTTP %s Retry-After with queued item requests", async (status) => {
    vi.useFakeTimers();
    const starts = [];
    const transport = createScheduledJSON();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        starts.push({ url, time: Date.now() });
        return starts.length === 1
          ? new Response("temporarily unavailable", { status, headers: { "Retry-After": "60" } })
          : Response.json({ id: 1 });
      })
    );
    const started = Date.now();
    const first = transport.json("https://shugo.gg/failed-item", {});
    const queued = transport.json("https://shugo.gg/next-item", {});
    const independent = transport.json("https://aion2.plaync.com/info", {});
    const done = Promise.all([first, queued, independent]);
    await vi.advanceTimersByTimeAsync(100);
    expect(starts.map(({ url }) => url)).toEqual([
      "https://shugo.gg/failed-item",
      "https://aion2.plaync.com/info",
    ]);
    await vi.advanceTimersByTimeAsync(59000);
    expect(starts).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2000);
    await done;
    const retriedHost = starts.filter(({ url }) => new URL(url).host === "shugo.gg");
    expect(retriedHost).toHaveLength(3);
    expect(retriedHost.slice(1).every(({ time }) => time >= started + 60000)).toBe(true);
    expect(retriedHost[2].time - retriedHost[1].time).toBeGreaterThanOrEqual(500);
    expect(transport.metrics.rateLimits).toBe(0);
  });
  it("keeps the server cooldown after one request exhausts its retries", async () => {
    const starts = [];
    let transport;
    const request = vi.fn(async (url) => {
      starts.push(transport.now());
      if (url.endsWith("/failed"))
        throw Object.assign(new Error("HTTP 502"), { status: 502, retryAfterMs: 60000 });
      return { id: 1 };
    });
    transport = clocked({ request });
    await expect(transport.json("https://shugo.gg/failed", {})).rejects.toMatchObject({
      status: 502,
      retryExhausted: true,
    });
    expect(await transport.json("https://shugo.gg/next", {})).toEqual({ id: 1 });
    expect(starts[3] - starts[2]).toBeGreaterThanOrEqual(60000);
    expect(transport.metrics.retries).toBe(2);
  });
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
