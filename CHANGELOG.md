# Changelog

All notable changes to Daeva will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## Unreleased

### Fixed

- Recover scheduled enrichment when a failed item belongs to changed equipment: recheck the failed slot and rebuild that character once from fresh official data. Preserve strict item validation and the previous cache when equipment is unchanged or the replacement still fails.
- Validate official profile stats and equipment before selecting their response, so an HTTP-200 payload with unavailable Item Level, Combat Power or equipment can recover through the first-party proxy. Require matching character/server IDs and complete data on both transports; unresolved failures retain the previous full population.
- Filter stale player-cache rows in SQL during scheduled CP preparation. Recover invalid direct item responses through the validated first-party proxy and retry only failed items; retain complete datasets on unresolved failures. Report bounded stage/item/HTTP diagnostics in workflow logs and prefetch status with credential redaction.
- Ignore corrupt CP lookup duplicates only when a valid entry with the same official profile key and character metadata exists. Preserve the valid entry's ID, CP and rank, and continue bounded pagination to prepare 100 unique builds; standalone malformed IDs remain provider failures.
- Fetch scheduled CP character/item builds on the GitHub Actions runner using the shared official enrichment code, keeping discovery, authenticated upload validation, cache reuse and complete D1 publication on Cloudflare. Retry transient character failures once without restarting the population; preserve the last usable dataset on unresolved failures.
- Keep scheduled CP continuation work bounded, check freshness using cache metadata only, and publish aggregates in a separate invocation. Stop unhealthy refreshes early, report cumulative errors and allow one bounded retry using completed character caches.
- Encode large CP build snapshots losslessly in the existing D1 JSON column, retaining every gear/skill value while reducing repeated field names to fit row limits.
- Serve healthy Combat Power D1 datasets before live discovery/enrichment, coordinate concurrent cold requests in the existing cache row, and preserve complete populations when refreshes fail or return partial data.
- Require complete enriched populations and valid successful responses in scheduled prefetch; expose build counts, completeness, freshness and failed populations through authenticated status.
- Batch region-aware player-cache reads and reuse each batch's loaded builds, keeping top-100 scans below D1's per-invocation query limit without dropping official item details.
- Reuse versioned normalized build projections and bound cached-player processing on Free-plan Workers, reducing repeated raw equipment parsing in long scans while retaining the original cache timestamps and official data.
- Retry interrupted analysis connections from the last completed checkpoint, accept complete SSE results before socket closure, and retain completed builds with a Resume Scan action if retries are exhausted.

### Changed

- Shorten analyzer headers and move source explanations and detailed freshness metadata into collapsible sections. Combat Power and historical game-mode labels remain explicit.
- Label retained results from an interrupted scan as partial, with a concise class/count/basis summary.

## 0.11.0-beta - 2026-10-09

### Added

- Distinct Shugo.GG Combat Power discovery provider with strict JSON/schema validation and upstream class/region/server/faction filters.
- Combat Power analysis across Global, Korea and Taiwan, preserving discovery CP separately from official profile CP.
- Shared official character/item build fetching, bounded continuation batches, and a working representative-player Quick Build.
- Sanitized public response fixtures and provider, cache, historical semantics, region isolation and continuation tests.

### Changed

- Temporarily default to Combat Power while NCSOFT's mode-specific ranking API remains unavailable. Combat Power is explicitly **not** a Nightmare/Abyss/Arena/Raid or other game-mode ranking.
- Mark old game-mode selections as historical-only, keep their original snapshots separate, and retain the Official/legacy Shugo implementations behind `LEADERBOARD_SOURCE_MODE=mode-specific` for restoration.
- Credit [Shugo.GG's public leaderboard](https://shugo.gg/leaderboard) in the analyzer and report conservative source/freshness metadata, including the actual top-500 refresh timestamp.
- Namespace CP full-build/aggregate caches by source, type and region; namespace official character IDs by region without a schema migration.
- Replace the 30-minute mode traversal with six-hour region/class prefetch, refresh guards and reusable discovery across continuation batches.

### Fixed

- Missing region in character cache identity; cache-first responses dropping builds/source metadata; duplicated prefetch fetching with incorrect shared function arguments; discovery scope leaking into pagination/error handling.
- Prevent empty/error/challenge/schema-changed CP responses from masquerading as valid zero-player analyses, and prevent filtered populations from overwriting unfiltered aggregates.
- Use Worker-compatible manual redirect handling for Combat Power requests while explicitly rejecting unexpected redirects.
- Default Worker routes to the 50-subrequest cap, complete players before continuing, and prevent continuation loops with no progress. Prefetch uses bounded region/class jobs with at most three active jobs and a 120-batch guard for top-100 populations.

### Security

- Update Next.js and its ESLint configuration from `15.5.23` to `15.5.27` within the existing patch line. The direct dependency path `daeva → next` no longer has the critical Windows server RCE ([GHSA-p293-qw3h-jr36](https://github.com/advisories/GHSA-p293-qw3h-jr36)) or AVIF image optimization RCE ([GHSA-2xp9-vwfh-vxw4](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4)).
- Production dependency audit still reports four high and one moderate finding involving transitive `nanoid`, `postcss`, `sharp` and `source-map-js`. These remain for a separate dependency review; no forced or major upgrade was applied. The audit's suggested Next.js 16 upgrade for nested PostCSS is outside this patch update.

### Release status

- Package and displayed version are `0.11.0-beta`. This remains a beta release using a temporary Combat Power discovery source.
- The `1.0.0` gate remains unchanged: intended official mode-specific live analysis must return and be validated. This temporary source does not satisfy that gate.

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

## 0.9.0-beta - 2026-04-20

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
