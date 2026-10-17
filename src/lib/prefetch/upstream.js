import { fetchJSON, sleep, subrequestBudgetExhausted } from "../scraper-shared.js";

// One instance per scheduled population, shared by its profile/item workers.
// This is transport scheduling only; all build caching remains in existing D1.
export function createScheduledJSON({
  request = fetchJSON,
  wait = sleep,
  now = Date.now,
  onRetry = () => {},
  onWait = async () => {},
  intervalMs = 500,
  maxCooldownMs = 10 * 60000,
  maxDurationMs = 80 * 60000,
} = {}) {
  const hosts = new Map();
  const metrics = { retries: 0, rateLimits: 0 };
  let rateLimitWaitSpent = 0;
  let fatal = null;
  const deadline = now() + maxDurationMs;

  function checkDeadline() {
    if (!fatal && now() >= deadline)
      fatal = Object.assign(
        new Error("Scheduled upstream time limit reached; previous dataset retained."),
        {
          code: "PREFETCH_DEADLINE",
          retryable: false,
        }
      );
    if (fatal) throw fatal;
  }

  async function pause(until) {
    while (now() < until) {
      checkDeadline();
      try {
        await onWait();
      } catch (error) {
        fatal = error;
        throw error;
      }
      checkDeadline();
      const remaining = until - now();
      if (remaining > 0) await wait(Math.min(30000, remaining, deadline - now()));
    }
  }

  async function enter(host) {
    if (!hosts.has(host))
      hosts.set(host, { queue: Promise.resolve(), next: 0, cooldown: 0, interval: intervalMs });
    const state = hosts.get(host);
    const previous = state.queue;
    let release;
    state.queue = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      checkDeadline();
      if (state.blocked) throw state.blocked;
      while (now() < Math.max(state.next, state.cooldown))
        await pause(Math.max(state.next, state.cooldown));
      if (state.blocked) throw state.blocked;
      checkDeadline();
      state.next = now() + state.interval;
    } finally {
      release();
    }
    return state;
  }

  async function json(url, headers, method, body, budget, logger, timeoutMs, validate = () => {}) {
    checkDeadline();
    const host = new URL(url).host;
    for (let attempt = 0; ; attempt++) {
      if (budget && !budget.canAfford())
        throw new subrequestBudgetExhausted(budget.used, budget.hardLimit);
      const state = await enter(host);
      try {
        const data = await request(url, headers, method, body, budget, logger, timeoutMs);
        validate(data);
        return data;
      } catch (error) {
        if (error instanceof subrequestBudgetExhausted || error.retryable === false) throw error;
        const limited = error.status === 429;
        if (limited) {
          metrics.rateLimits++;
          state.interval = Math.max(state.interval, 1000);
        }
        const retryable =
          limited ||
          error.status === 408 ||
          error.status === 404 ||
          error.status >= 500 ||
          (!error.status && error.retryable !== false);
        const attempts = limited ? 4 : 2;
        const delay = Math.max(
          error.retryAfterMs || 0,
          limited ? 30000 * 2 ** attempt : 5000 * 3 ** attempt
        );
        if (
          !retryable ||
          attempt >= attempts ||
          (limited && rateLimitWaitSpent + delay > maxCooldownMs)
        ) {
          error.retryExhausted = true;
          if (limited) state.blocked = error;
          throw error;
        }
        // A 429 pauses every worker using that host, including queued requests.
        if (limited) state.cooldown = Math.max(state.cooldown, now() + delay);
        // Ordinary per-request retries must not exhaust rate-limit recovery
        // for the remainder of a 2,500+ request population. They remain bounded
        // by two retries per request and the overall job deadline.
        if (limited) rateLimitWaitSpent += delay;
        metrics.retries++;
        onRetry({ host, error, delayMs: delay, attempt: attempt + 1 });
        await pause(now() + delay);
      }
    }
  }
  return { json, metrics };
}
