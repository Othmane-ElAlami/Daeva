import { describe, it, expect, vi } from "vitest";
import { readAnalysisStream, runAnalysis } from "../src/lib/analysis-stream.js";

const config = { cls: "chanter", lbType: "combat-power", region: "GLOBAL", limit: 100 };
const checkpoint = (count) => ({
  type: "continue",
  identity: "same-cp-population",
  sourceMeta: { source: "Shugo Combat Power", leaderboardType: "combat-power", region: "GLOBAL" },
  processedCount: count,
  processedPlayers: Array.from({ length: count }, (_, id) => ({ characterId: String(id) })),
  players: Array.from({ length: 100 - count }, (_, id) => ({ characterId: String(count + id) })),
});
const done = { type: "done", count: 100, stats: { total: 100 }, builds: [] };
const sse = (...events) =>
  new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
const interrupted = () => sse({ type: "progress", current: 2, total: 100 });

describe("analysis stream framing", () => {
  it("accepts a terminal checkpoint without reading a later broken socket", async () => {
    let reads = 0;
    const response = new Response(
      new ReadableStream({
        pull(controller) {
          if (reads++ === 0)
            controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(done)}\n\n`));
          else controller.error(new TypeError("network error"));
        },
      })
    );
    await expect(readAnalysisStream(response)).resolves.toEqual(done);
  });
  it("parses UTF-8 characters and CRLF split across chunks, including an undelimited last event", async () => {
    const event = { type: "log", message: "角色" };
    const bytes = new TextEncoder().encode(
      `: heartbeat\r\n\r\ndata: ${JSON.stringify(event)}\r\n\r\ndata: ${JSON.stringify(done)}`
    );
    const onEvent = vi.fn();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
          controller.close();
        },
      })
    );
    await expect(readAnalysisStream(response, onEvent)).resolves.toEqual(done);
    expect(onEvent).toHaveBeenCalledExactlyOnceWith(event);
  });
});

describe("analysis connection recovery", () => {
  it("retries the same continuation after an interrupted batch and retains player progress", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(sse(checkpoint(1)))
      .mockResolvedValueOnce(interrupted())
      .mockResolvedValueOnce(sse(done));
    const onEvent = vi.fn();
    const wait = vi.fn();
    await expect(runAnalysis(config, { fetcher, onEvent, wait })).resolves.toEqual(done);
    const bodies = fetcher.mock.calls.map(([, options]) => JSON.parse(options.body));
    expect(bodies[0]).not.toHaveProperty("continuation");
    expect(bodies[1]).toEqual(bodies[2]);
    expect(bodies[2].continuation.processedCount).toBe(1);
    expect(onEvent).toHaveBeenCalledWith({ type: "progress", current: 2, total: 100 });
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "retry" }));
    expect(wait).toHaveBeenCalledExactlyOnceWith(1000);
  });
  it.each([429, 502, 503])(
    "retries HTTP %i without changing the request population",
    async (status) => {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(Response.json({ error: "Please wait" }, { status }))
        .mockResolvedValueOnce(sse(done));
      await expect(runAnalysis(config, { fetcher, wait: vi.fn() })).resolves.toEqual(done);
      expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
    }
  );
  it.each([
    () => Promise.reject(new TypeError("network error")),
    () => Promise.resolve(interrupted()),
    () => Promise.resolve(new Response("data: {broken\n\n")),
  ])("bounds retries and keeps the last checkpoint for Resume Scan", async (failedResponse) => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(sse(checkpoint(2)))
      .mockImplementation(failedResponse);
    const wait = vi.fn();
    await expect(runAnalysis(config, { fetcher, wait })).rejects.toMatchObject({
      retryable: true,
      continuation: expect.objectContaining({ processedCount: 2 }),
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000]);
  });
  it("preserves an explicit provider failure rather than retrying or silently returning zero players", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        sse({ type: "error", message: "No matching historical snapshot exists." })
      );
    await expect(runAnalysis(config, { fetcher })).rejects.toMatchObject({
      message: "No matching historical snapshot exists.",
      retryable: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not retry invalid continuation/configuration requests", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json({ error: "Invalid continuation population." }, { status: 400 })
      );
    await expect(runAnalysis(config, { fetcher })).rejects.toThrow(
      "Invalid continuation population."
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects a non-advancing checkpoint instead of looping", async () => {
    const fetcher = vi.fn().mockImplementation(async () => sse(checkpoint(2)));
    await expect(runAnalysis(config, { fetcher })).rejects.toThrow("could not advance");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("rejects a different population in a later checkpoint", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(sse(checkpoint(1)))
      .mockResolvedValueOnce(sse({ ...checkpoint(2), identity: "nightmare" }));
    await expect(runAnalysis(config, { fetcher })).rejects.toThrow("could not advance");
  });
  it("completes a 100-player job across 100 advancing batches", async () => {
    let count = 0;
    const fetcher = vi
      .fn()
      .mockImplementation(async () => sse(++count < 100 ? checkpoint(count) : done));
    await expect(runAnalysis(config, { fetcher })).resolves.toEqual(done);
    expect(fetcher).toHaveBeenCalledTimes(100);
    expect(JSON.parse(fetcher.mock.calls[99][1].body).continuation.processedCount).toBe(99);
  });
  it("returns historical metadata without injecting live CP fields", async () => {
    const historical = {
      type: "done",
      count: 10,
      stats: { isHistorical: true, leaderboardType: "nightmare", updatedAt: 1234 },
      leaderboardType: "nightmare",
      builds: [],
    };
    const fetcher = vi.fn().mockResolvedValue(sse(historical));
    await expect(
      runAnalysis({ ...config, lbType: "nightmare", region: "all" }, { fetcher })
    ).resolves.toEqual(historical);
  });
});
