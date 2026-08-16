# Changelog

All notable changes to Daeva will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.10.0-beta] - 2026-08-16

### Added

- Resilient leaderboard provider abstraction
- Official/Shugo provider fallback logic
- Full-build Cloudflare D1 cache
- Historical aggregate snapshot fallback
- Source-health indicators
- Cached/stale/historical state handling
- Open-source contributor/security documentation
- Public repository metadata and 0BSD licensing
- Automated deployment and scheduled prefetch infrastructure
- Trace events for scraping, scan logs, and admin UI/dashboard
- Race and rune filter UI and client-side re-aggregation
- Unit and integration test suite (Vitest + Husky)

### Changed

- Improved analyzer reliability during upstream outages
- More transparent data-source/freshness messaging
- Better distinction between live, partial, cached, stale, and historical data
- Public project branding, cinematic theme, and documentation
- Transitioned to a public open-source project

### Fixed

- Empty leaderboard responses being incorrectly treated as valid 0-player results for new seasons
- Provider failover and partial outage handling bugs
- Quick Build disabled state when only aggregate historical data is available
- Re-fetches during aggregation and progress calculation accuracy
- Animation performance on Chromium Android
- ESLint config issues and dependency lockfile sync

### Security

- Added Cloudflare Secrets Store support for admin authentication
- Secured admin dashboard with analytics and guards
- Dependency security updates and lockfile regeneration
- Added Security Policy (`SECURITY.md`) and responsible disclosure guidelines

### Known Limitations

- The upstream official AION 2 leaderboard API is currently unavailable.
- Shugo's leaderboard data is also affected because it depends on the upstream source.
- Live leaderboard analysis therefore cannot currently be fully exercised.
- Daeva falls back to cached or historical data when possible.
- This is the primary reason the project remains in beta and is not yet `1.0.0`.

## [0.9.0-beta] - 2026-04-20

### Added

- In-app changelog page
- Searchable server dropdown
- Item enchant levels and stone usage tracking
- Item usage stats and deduplicated leaderboard fetching
- Cloudflare D1 meta-snapshot API and DB migrations

### Changed

- Removed 'Raid', reordered servers, and restyled substat UI
- Simplified slot categorization and normalized weapon categories
- Standardized scan logs
- Moved metadata files to `public/` for Cloudflare Pages

### Fixed

- Completeness checks and arcana fetching with `itemDetailsMap`

## Pre-0.9 Development

Notable development prior to the formal 0.9.0-beta release included:

- Initial Next.js app wired for Cloudflare Pages
- Shared scraper logic extraction
- UI layout and theme foundation

[0.10.0-beta]: https://github.com/Othmane-ElAlami/Daeva/releases/tag/v0.10.0-beta
[0.9.0-beta]: https://github.com/Othmane-ElAlami/Daeva/releases/tag/v0.9.0-beta
