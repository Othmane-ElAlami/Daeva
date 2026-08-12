# Daeva

A Next.js leaderboard and build analyzer for Aion 2. Leaderboards are sourced from [shugo.gg](https://shugo.gg/leaderboard), while player equipment and metadata are fetched from the official API. Deployed on Cloudflare Pages with a D1 database for player equipment caching.

## Prerequisites

- [Node.js](https://nodejs.org/) v25+
- A [Cloudflare](https://cloudflare.com) account (for D1 and Pages)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (included as a dev dependency)

## Local Development Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create the local D1 database table

The app uses a Cloudflare D1 database (`player-cache`) to cache player equipment data. On a fresh clone, the local SQLite database has no tables. Run this once to initialise it:

```bash
npx wrangler d1 execute player-cache --local --command="CREATE TABLE IF NOT EXISTS player_cache (character_id TEXT NOT NULL, server_id TEXT NOT NULL, region TEXT, equip_data TEXT NOT NULL, equip_details TEXT NOT NULL, fetched_at INTEGER NOT NULL, PRIMARY KEY (character_id, server_id))"
```

### 3. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

> The dev server uses `@cloudflare/next-on-pages/next-dev` to emulate the Cloudflare runtime (including D1 bindings) locally via `next.config.mjs`.

## Available Scripts

| Script                | Description                                      |
| --------------------- | ------------------------------------------------ |
| `npm run dev`         | Start the Next.js development server             |
| `npm run build`       | Build the Next.js app                            |
| `npm run pages:build` | Build for Cloudflare Pages using `next-on-pages` |
| `npm run preview`     | Build and preview locally with Wrangler          |
| `npm run deploy`      | Build and deploy to Cloudflare Pages             |
| `npm run lint`        | Run ESLint                                       |

## Deploying to Cloudflare Pages

### 1. Create the remote D1 database

```bash
npx wrangler d1 create player-cache
```

Copy the `database_id` from the output and update `wrangler.toml` if it differs.

### 2. Create the table in the remote database

```bash
npx wrangler d1 execute player-cache --remote --command="CREATE TABLE IF NOT EXISTS player_cache (character_id TEXT NOT NULL, server_id TEXT NOT NULL, region TEXT, equip_data TEXT NOT NULL, equip_details TEXT NOT NULL, fetched_at INTEGER NOT NULL, PRIMARY KEY (character_id, server_id))"
```

### 3. Deploy

```bash
npm run deploy
```

## Project Structure

```text
app/
  api/scrape/route.js     # Edge API route — scans shugo.gg leaderboards and fetches character data from official API
  api/prefetch/status/     # Prefetch system status endpoint (admin-gated)
  layout.js / page.js     # Root layout and main page
src/
  lib/db.js               # D1 helper functions (getCachedPlayer, setCachedPlayer)
  lib/prefetch/            # Background prefetching system (see below)
instrumentation.js         # Next.js server startup hook — starts the prefetch scheduler
wrangler.toml              # Cloudflare Workers / Pages + D1 binding config
next.config.mjs            # Next.js config with Cloudflare dev platform setup
```

## Background Prefetching

The background prefetching system runs entirely in-process on the Node.js server. On startup, it begins a cache warming pass — fetching the top 100 players for every class across every leaderboard from shugo.gg and the official Aion 2 API. Results are stored in an in-memory cache so that subsequent user-facing requests to the analyzer are served instantly from cache (typically <5ms) instead of making live upstream fetches. After warming, the system enters a scheduled cycle that refreshes data on a configurable interval (default: every 30 minutes) with jittered offsets to prevent thundering herd spikes. All upstream requests are governed by a concurrency limiter (max 2 simultaneous), per-minute/per-hour rate budgets, per-job circuit breakers with exponential backoff, and a server load health gate that pauses background work when the server is under heavy user-facing load.

### Data Flow

```text
┌─────────────────────────┐
│  Scheduler (+ Jitter)   │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│        Job Queue        │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ Concurrency Limiter (2) │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ Rate Limiter (+ Health) │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│      Upstream API       │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│     In-Memory Cache     │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ User Request (Cache Hit)│
└─────────────────────────┘
```

### Environment Variables

All values have sensible defaults and can be tuned without a code change or redeploy.

| Variable                              | Default                            | Description                                                                   |
| ------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------- |
| `PREFETCH_ENABLED`                    | `true`                             | Master switch. Set to `false` to disable all background activity immediately. |
| `PREFETCH_INTERVAL_MINUTES`           | `30`                               | How often the full refresh cycle runs.                                        |
| `PREFETCH_CONCURRENCY`                | `2`                                | Maximum simultaneous upstream fetch jobs.                                     |
| `PREFETCH_DELAY_BETWEEN_JOBS_MS`      | `1000`                             | Minimum delay (ms) between starting each job.                                 |
| `PREFETCH_JITTER_RANGE_MS`            | `5000`                             | Random offset (ms) added to each job's schedule.                              |
| `PREFETCH_MAX_REQUESTS_PER_MINUTE`    | `20`                               | Per-minute upstream request budget.                                           |
| `PREFETCH_MAX_REQUESTS_PER_HOUR`      | `600`                              | Per-hour upstream request budget.                                             |
| `PREFETCH_CIRCUIT_BREAKER_THRESHOLD`  | `3`                                | Consecutive failures before a job backs off exponentially.                    |
| `PREFETCH_CACHE_TTL_MINUTES`          | `90`                               | Cache entry lifetime. Should be > `PREFETCH_INTERVAL_MINUTES`.                |
| `PREFETCH_SERVER_LOAD_THRESHOLD`      | `0.7`                              | CPU load ratio (0–1) above which background jobs pause.                       |
| `PREFETCH_WARM_ON_STARTUP`            | `true`                             | Run a cache warming pass on server startup.                                   |
| `PREFETCH_WARM_PRIORITY_CLASSES`      | `gladiator,templar,cleric,chanter` | Classes warmed first on startup.                                              |
| `PREFETCH_WARM_PRIORITY_LEADERBOARDS` | `nightmare,abyss`                  | Leaderboards warmed first on startup.                                         |

### Emergency Disable

Set the environment variable and restart (or, for live config, the system checks on every job):

```bash
PREFETCH_ENABLED=false
```

This immediately stops all background fetching. The in-memory cache continues to serve stale data until it expires.

### Status Endpoint

`GET /api/prefetch/status` (requires admin authentication) returns:

```json
{
  "enabled": true,
  "status": "running",
  "pauseReason": null,
  "lastCycleStart": 1745092800000,
  "lastCycleEnd": 1745094600000,
  "nextCycleEstimate": 1745096400000,
  "totalCycles": 3,
  "currentQueueDepth": 0,
  "cache": {
    "hits": 142,
    "misses": 8,
    "hitRate": 94.7,
    "size": 56,
    "entries": {
      "prefetch:nightmare:gladiator:top100": { "lastFetchedAt": "...", "playerCount": 100 }
    }
  },
  "recentCycles": [{ "type": "scheduled", "succeeded": 54, "failed": 2 }],
  "recentJobs": [
    { "jobId": "pf-42-...", "cls": "gladiator", "lbType": "nightmare", "status": "success" }
  ]
}
```

- **status**: `"running"` | `"warming"` | `"paused"` | `"stopped"`
- **pauseReason**: Why the system paused (e.g. `"CPU load 85% exceeds threshold 70%"`)
- **cache.hitRate**: Percentage of user requests served from prefetch cache
- **currentQueueDepth**: Jobs remaining in the current cycle
- **nextCycleEstimate**: Unix timestamp of the next scheduled cycle
