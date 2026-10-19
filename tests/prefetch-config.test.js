import { describe, expect, it, vi } from "vitest";
import { loadPrefetchConfig } from "../scripts/prefetch-config.mjs";
import { discoveryConfig } from "../src/lib/discovery-config.js";

const config = discoveryConfig({ LEADERBOARD_SOURCE_MODE: "combat-power" });
const truncated = JSON.stringify(config).slice(0, 4096);
const options = {
  apiUrl: "https://example.com",
  cls: "ranger",
  region: "GLOBAL",
  wait: async () => {},
  log: () => {},
};
const json = (text) => new Response(text, { headers: { "Content-Type": "application/json" } });

describe("prefetch configuration startup", () => {
  it.each(["truncated", "html", "network", "503"])(
    "retries an unavailable %s response before accepting validated configuration",
    async (failure) => {
      const request = vi.fn().mockResolvedValue(Response.json(config));
      if (failure === "network") request.mockRejectedValueOnce(new TypeError("fetch failed"));
      else
        request.mockResolvedValueOnce(
          failure === "truncated"
            ? json(truncated)
            : failure === "html"
              ? new Response("<html>unavailable</html>", {
                  headers: { "Content-Type": "text/html" },
                })
              : new Response("busy", { status: 503 })
        );
      const wait = vi.fn(async () => {});
      const result = await loadPrefetchConfig({ ...options, request, wait });
      expect(result.sourceMode).toBe("combat-power");
      expect(result.classes).toContain("ranger");
      expect(result.servers).toBeUndefined();
      expect(request).toHaveBeenCalledTimes(2);
      expect(wait).toHaveBeenCalledExactlyOnceWith(2000);
      expect(request.mock.calls[0][0]).toBe("https://example.com/api/leaderboard/config");
      expect(request.mock.calls[0][1]).toMatchObject({ method: "GET", redirect: "error" });
    }
  );
  it("fails after three truncated HTTP-200 responses without selecting a default mode", async () => {
    expect(truncated).toHaveLength(4096);
    expect(() => JSON.parse(truncated)).toThrow();
    const request = vi.fn(async () => json(truncated));
    const wait = vi.fn(async () => {});
    await expect(loadPrefetchConfig({ ...options, request, wait })).rejects.toMatchObject({
      code: "PREFETCH_CONFIG_UNAVAILABLE",
      message: expect.stringContaining("HTTP 200, malformed or incomplete JSON"),
    });
    expect(request).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls.map(([delay]) => delay)).toEqual([2000, 4000]);
  });
  it.each(["mode", "class", "region"])(
    "rejects a complete but unsupported %s configuration",
    async (field) => {
      const invalid = {
        ...config,
        [field === "mode" ? "sourceMode" : field === "class" ? "classes" : "regions"]:
          field === "mode" ? "unknown" : [],
      };
      const request = vi.fn(async () => Response.json(invalid));
      const wait = vi.fn();
      await expect(loadPrefetchConfig({ ...options, request, wait })).rejects.toMatchObject({
        code: "PREFETCH_CONFIG_INVALID",
      });
      expect(request).toHaveBeenCalledOnce();
      expect(wait).not.toHaveBeenCalled();
    }
  );
  it("preserves the mode-specific restoration path", async () => {
    const legacy = discoveryConfig({ LEADERBOARD_SOURCE_MODE: "mode-specific" });
    const result = await loadPrefetchConfig({
      ...options,
      request: async () => Response.json(legacy),
    });
    expect(result.sourceMode).toBe("mode-specific");
    expect(result.leaderboards.some(({ id }) => id === "nightmare")).toBe(true);
  });
  it("honors Retry-After without starting a refresh during configuration recovery", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("busy", { status: 429, headers: { "Retry-After": "10" } })
      )
      .mockResolvedValueOnce(Response.json(config));
    const wait = vi.fn(async () => {});
    await loadPrefetchConfig({ ...options, request, wait });
    expect(wait).toHaveBeenCalledExactlyOnceWith(10000);
    expect(request.mock.calls.every(([url]) => url.endsWith("/api/leaderboard/config"))).toBe(true);
  });
  it("fails authentication errors without retrying or logging the response body", async () => {
    const request = vi.fn(async () => new Response("private details", { status: 403 }));
    const log = vi.fn();
    await expect(loadPrefetchConfig({ ...options, request, log })).rejects.toThrow("HTTP 403");
    expect(request).toHaveBeenCalledOnce();
    expect(log).not.toHaveBeenCalled();
  });
});
