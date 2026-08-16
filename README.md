# Daeva

[![License: 0BSD](https://img.shields.io/badge/License-0BSD-blue.svg)](https://opensource.org/licenses/0BSD)
[![Deployed on Cloudflare Pages](https://img.shields.io/badge/Deployed-Cloudflare%20Pages-f38020.svg)](https://daeva.pages.dev)

Open-source AION 2 build and meta analyzer that studies leaderboard data to identify popular skills, stigmas, equipment patterns, and other build trends.

> **Beta**
>
> Daeva is currently in beta. The core analyzer and fallback systems are production-deployed, but the upstream AION 2 leaderboard API is currently unavailable, preventing full live-data validation.
>
> See the [Changelog](CHANGELOG.md) for recent updates.

## What Daeva Does

Daeva helps you understand the meta by analyzing high-ranking players across all leaderboards. It provides data-driven recommendations on:

- Top active and passive skills
- Must-have stigma combinations
- Popular equipment and substats
- Arcana choices and synergy patterns
- Quick Build analysis for current trends

By aggregating configurations from the official APIs and community platforms, Daeva reports observed build trends rather than claiming to mathematically determine the "perfect" build.

## How It Works

Daeva uses a resilient scraping and aggregation architecture:

`Leaderboard Provider` → `Player Build Fetch` → `Aggregation` → `Analyzer`

Because upstream APIs can be unreliable, Daeva follows a resilience ladder to ensure you always have access to data:

1. **Official**: Live data directly from the official AION 2 API.
2. **Shugo Fallback**: Alternative provider if official APIs are constrained.
3. **Full-Build D1 Cache**: Cloudflare D1 cache serving instantly from background prefetch.
4. **Historical Meta Snapshot**: Stored aggregate snapshot if all live data is unavailable.
5. **Explicit Unavailable State**: If there's truly no data, Daeva tells you, rather than fabricating player builds.

## Data Freshness

The UI clearly indicates the health of the data source you are viewing:

- **Live Data**: Full live synchronization.
- **Partial Data**: Live synchronization with some servers failing.
- **Cached Data**: Cache under 2 days old.
- **Stale Cache**: Cache 2–7 days old.
- **Historical Snapshot**: Cached aggregate data >7 days old, used as an ultimate fallback.

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
npx wrangler d1 execute player-cache --local --command="CREATE TABLE IF NOT EXISTS player_cache (character_id TEXT NOT NULL, server_id TEXT NOT NULL, region TEXT, equip_data TEXT NOT NULL, equip_details TEXT NOT NULL, fetched_at INTEGER NOT NULL, PRIMARY KEY (character_id, server_id))"
```

### 3. Environment Variables

Create `.env.local` for the Next.js app and `.dev.vars` for the Wrangler local environment. Use these placeholders (do not commit real secrets):

```env
# .dev.vars / .env.local
ADMIN_SECRET=your-secret-here
API_URL=http://localhost:3000
```

Note: `CLOUDFLARE_API_TOKEN` is used exclusively for CI/CD deployment via GitHub Actions. Never commit it.

### 4. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Background Prefetching

Daeva includes a background prefetch system that runs entirely in-process on the Node.js server. On startup, it warms the cache by fetching the top 100 players for every class and leaderboard.

This is governed by a scheduled workflow that calls the `POST /api/prefetch/run` endpoint (authenticated via `ADMIN_SECRET`) every 30 minutes, storing results in the D1 cache. This ensures instant load times for users. During upstream outages, Daeva gracefully falls back to the latest cached data.

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

## Disclaimer

Daeva is an independent community project and is not affiliated with, maintained, or endorsed by NCSoft.
