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

| Script | Description |
| --- | --- |
| `npm run dev` | Start the Next.js development server |
| `npm run build` | Build the Next.js app |
| `npm run pages:build` | Build for Cloudflare Pages using `next-on-pages` |
| `npm run preview` | Build and preview locally with Wrangler |
| `npm run deploy` | Build and deploy to Cloudflare Pages |
| `npm run lint` | Run ESLint |

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
  api/scrape/route.js   # Edge API route — scans shugo.gg leaderboards and fetches character data from official API
  layout.js / page.js   # Root layout and main page
src/
  lib/db.js             # D1 helper functions (getCachedPlayer, setCachedPlayer)
wrangler.toml           # Cloudflare Workers / Pages + D1 binding config
next.config.mjs         # Next.js config with Cloudflare dev platform setup
```
