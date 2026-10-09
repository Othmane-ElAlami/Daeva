# Daeva

[![License: 0BSD](https://img.shields.io/badge/License-0BSD-blue.svg)](https://opensource.org/licenses/0BSD)
[![Deployed on Cloudflare Pages](https://img.shields.io/badge/Deployed-Cloudflare%20Pages-f38020.svg)](https://daeva.pages.dev)

Open-source AION 2 build and meta analyzer that studies leaderboard data to identify popular skills, stigmas, equipment patterns, and other build trends.

> **Beta**
>
> Daeva remains in beta. NCSOFT's mode-specific ranking API is unavailable. Daeva temporarily discovers high-Combat-Power characters through [Shugo.GG's public Combat Power leaderboard](https://shugo.gg/leaderboard) and fetches their builds from official character APIs. Combat Power is not a Nightmare, Abyss, Arena, Raid or other game-mode ranking. This temporary source does not satisfy the `1.0.0` gate.
>
> See the [Changelog](CHANGELOG.md) for recent updates.

## What Daeva Does

Daeva currently analyzes the highest-Combat-Power available characters of a selected class and region. Historical game-mode snapshots remain separately viewable. It provides data-driven recommendations on:

- Top active and passive skills
- Must-have stigma combinations
- Popular equipment and substats
- Arcana choices and synergy patterns
- Quick Build analysis for current trends

By aggregating configurations from the official APIs and community platforms, Daeva reports observed build trends rather than claiming to mathematically determine the "perfect" build.

## How It Works

Daeva uses a resilient scraping and aggregation architecture:

`Leaderboard Provider` → `Player Build Fetch` → `Aggregation` → `Analyzer`

The temporary discovery strategy is:

1. **Shugo Combat Power**: Public CP-ranked characters, with upstream class, region, server and faction filtering.
2. **Full-build D1 cache**: Fresh or stale snapshots of the same CP region/class population, retained for up to seven days.
3. **Historical aggregate snapshot**: The same population's stored aggregates, with Quick Build disabled.
4. **Explicit unavailable state**: No fabricated or silently substituted players.

Build data (equipment, active/stigma/passive skills, arcana, runes, stones, ItemLevel and CP) comes from NCSOFT's character and item APIs. A transport proxy is used only if direct official requests fail. The old Official and mode-specific Shugo providers remain intact. Set `LEADERBOARD_SOURCE_MODE=mode-specific` when official rankings return to restore the original discovery strategy and selectors.

## Data Freshness

Shugo includes characters whose profiles have been opened there. CP updates on profile lookups; the top 500 of each region is refreshed nightly. This is a discovery sample, not a census of every character. Global, Korea and Taiwan run different game versions and are analyzed separately.

The analyzer credits **Shugo.GG** and labels the basis **Combat Power**. It shows the known top-500 refresh timestamp and states that individual entry freshness varies. Response `generatedAt` is not treated as the time every score updated. Official profile CP can differ from the stored discovery CP; rank order uses discovery CP. Cache timestamps describe when builds were fetched, not when the whole leaderboard updated.

Historical Nightmare/Abyss/Arena/etc. aggregates keep their original mode and timestamp. They are never merged into current CP results. Historical aggregates cannot provide player-level Quick Build templates. See [the source contract and pipeline audit](docs/data-sources.md).

## Local Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) v25+
- A [Cloudflare](https://cloudflare.com) account (for D1 and Pages)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

### 1. Install dependencies

```bash
npm install
```

### 2. Database Setup

The app uses a Cloudflare D1 database (`player-cache`) for caching player equipment. To set up the local SQLite database, run this once:

```bash
npx wrangler d1 execute player-cache --local --command="CREATE TABLE IF NOT EXISTS player_cache (character_id TEXT NOT NULL, server_id TEXT NOT NULL, region TEXT, equip_data TEXT NOT NULL, equip_details TEXT NOT NULL, item_level REAL, fetched_at INTEGER NOT NULL, PRIMARY KEY (character_id, server_id))"
npx wrangler d1 execute player-cache --local --file=migrations/add_prefetch_cache.sql
npx wrangler d1 execute player-cache --local --file=migrations/add_meta_snapshots.sql
npx wrangler d1 execute player-cache --local --file=migrations/add_rate_limits.sql
npx wrangler d1 execute player-cache --local --file=migrations/add_admin_events.sql
npx wrangler d1 execute player-cache --local --file=migrations/add_login_attempts.sql
```

For an existing `player_cache` without `item_level`, apply `migrations/add_item_level.sql` once. CP cache namespaces use the existing schema; no CP migration is needed.

### 3. Environment Variables

Create `.env.local` for the Next.js app and `.dev.vars` for the Wrangler local environment. Use these placeholders (do not commit real secrets):

```env
# .dev.vars / .env.local
ADMIN_SECRET=your-secret-here
API_URL=http://localhost:3000
LEADERBOARD_SOURCE_MODE=combat-power
WORKER_SUBREQUEST_LIMIT=50
PREFETCH_CACHE_TTL_MINUTES=420
PREFETCH_MIN_REFRESH_MINUTES=330
```

Note: `CLOUDFLARE_API_TOKEN` is used exclusively for CI/CD deployment via GitHub Actions. Never commit it.

Worker fetch budgets default to the 50-subrequest Free/Bundled plan cap, with five requests reserved. Set `WORKER_SUBREQUEST_LIMIT=1000` only for a deployment with a sufficient paid-plan limit. Lower-cap invocations complete one player's official item details at a time and resume from complete D1 builds.

Player-cache reads use bounded SQL batches to stay below D1's separate 50-query Free-plan limit. Interrupted browser connections retry the same analysis checkpoint up to three attempts; completed builds remain available with a Resume Scan action if the connection cannot recover. Source explanations and freshness details are available in collapsible analyzer sections.

### 4. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Background Prefetching

A GitHub Actions workflow calls the authenticated `POST /api/prefetch/run` endpoint every six hours (03:17, 09:17, 15:17 and 21:17 UTC). It runs 8 classes × 3 supported regions, using direct upstream class filtering. A region-wide top 100 cannot supply the top 100 of each class, so those queries are intentionally distinct.

There is no server-startup prefetch loop. Region/class jobs run with at most three active jobs and delays between batches. Official item requests are budgeted, and authenticated continuation batches reuse the original discovery list. A complete job publishes its D1 snapshot; continuation work never overwrites the previous full snapshot. Recently completed jobs are skipped for 330 minutes; cached builds are fresh for 420 minutes and available as stale fallback for up to seven days.

Requests have a four-minute timeout and each region/class job a 90-minute timeout. At most 120 batches are allowed for a top-100 job, accommodating one complete player per invocation on 50-subrequest plans. Continuations must advance, and the interactive analyzer also has a batch cap; a request that cannot complete a build falls back or returns an explicit unavailable state.

Six-hour refreshes track profile lookups between Shugo's nightly top-500 checks without the old 30-minute, 56-mode-job traffic. Prefetch can be disabled with `PREFETCH_ENABLED=false`. Source configuration also controls future mode-specific jobs. Reassess cadence/cache TTL when official rankings return.

## Scripts & Testing

| Script                | Description                          |
| --------------------- | ------------------------------------ |
| `npm run dev`         | Start the Next.js development server |
| `npm run build`       | Build the Next.js app                |
| `npm run pages:build` | Build for Cloudflare Pages           |
| `npm run test`        | Run Vitest unit/integration tests    |
| `npm run lint`        | Run ESLint                           |

## Contributing

We welcome contributions! Please read our [Contributing Guidelines](CONTRIBUTING.md) to learn how to propose features, report bugs, and submit pull requests.

## Security

Please review our [Security Policy](SECURITY.md) for information on supported versions and how to privately report vulnerabilities. Do not file public issues for security exploits.

## Data attribution

Player discovery uses [Shugo.GG](https://shugo.gg/leaderboard). Daeva is an independent community project; Shugo.GG does not endorse or maintain it. Official character/build data is provided by NCSOFT.

## Disclaimer

Daeva is an independent community project and is not affiliated with, maintained, or endorsed by NCSoft.
