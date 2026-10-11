# Discovery sources and Combat Power contract

## Audit of master before this change

Audited `master` at `e8ab4cf` (`0.10.0-beta`), including the local workflow retry
changes. The analyzer posted class, game mode, limit and filters to `/api/scrape`.
That route first read `prefetch_cache` by class/mode, then selected Official →
legacy Shugo → full-build D1 cache. Both live providers queried the old
`/api/leaderboard?contentType=…&rankingType=…&page=…&limit=100` API. Discovery
rows were deduplicated by character/server, then filtered by region/server/race.

Equipment and info came from NCSOFT, with Shugo's transport proxy as fallback.
Shugo batch endpoints resolved item/arcana details. `extractBuild` and `aggregate`
produced SSE results for the analyzer. The prefetch runner duplicated that fetch
logic, and its `fetchJSON` arguments did not match the shared function signature.
Scheduled jobs traversed 8 classes × 7 game modes every 30 minutes.

`player_cache` stored raw official equipment/details using a character/server
primary key despite having a region column. `prefetch_cache` stored normalized
full builds and aggregates under class/mode. `meta_snapshots` stored only summary
skills/arcana combinations under class/mode. Aggregate fallback ran only after
typed provider exhaustion. The cache-first SSE path omitted player builds and
source health. Quick Build was disabled for historical aggregates, but its
enabled button had no action. Discovery metadata also escaped its local scope
in extra-page/continuation error handling. The README's server-startup prefetch
description did not match the actual authenticated scheduled endpoint.

## Live source inspection, 2026-10-09

Public page: <https://shugo.gg/leaderboard>. Its published JavaScript calls a
structured endpoint; production does not parse leaderboard HTML.

```text
GET https://shugo.gg/api/leaderboard/combat-power
    ?region=GLOBAL&class=Chanter&sort=combatPower&page=1&limit=100
```

Observed request parameters:

| Parameter   | Contract                                                     |
| ----------- | ------------------------------------------------------------ |
| `region`    | `GLOBAL`, `KR`, `TW`; independent ranking populations        |
| `class`     | Class name, e.g. `Chanter`; filtering occurs upstream        |
| `serverId`  | Numeric server identifier                                    |
| `faction`   | `elyos`, `asmodian`                                          |
| `sort`      | `combatPower` (Daeva) or `gearScore` (Shugo's optional sort) |
| `page`      | 1-based                                                      |
| `limit`     | Observed `3` clamps to `10`; Daeva uses a consistent `100`   |
| `subRegion` | Global's `nae`, `naw`, `eu`, `la`, `as`; Daeva uses servers  |
| `q`, `ids`  | Search/favorites scope in Shugo; unused by Daeva             |

Plain requests without the expected page headers returned HTTP 403 and
`{"success":false,"error":"Forbidden"}`. GET with the existing Shugo-style
`Origin: https://shugo.gg` / `Referer: https://shugo.gg/leaderboard` headers returned
JSON without credentials. Unexpected redirects, non-JSON/login/challenge
responses, malformed data, missing IDs and unhealthy empty first pages are typed
`ShugoCombatPowerError`s. A consistently exhausted later page may be empty.

The response envelope contains `region`, `subRegion`, `sort`, `page`, `limit`,
`total`, `totalPages`, `hasMore`, `generatedAt`, `topRefreshedAt`, and `entries`.

| Entry field              | Daeva field / meaning                                            |
| ------------------------ | ---------------------------------------------------------------- |
| `characterId`            | Encrypted official character ID, retained exactly                |
| `name`                   | `characterName`                                                  |
| `serverId`, `serverName` | Official server identity; no synthetic identifiers               |
| `region`, `subRegion`    | Region and Global API subregion                                  |
| `className`              | Original class name plus normalized lowercase `class`            |
| `faction`                | `elyos` / `asmodian`                                             |
| `rank`                   | Rank within the requested filters; class rank is not global rank |
| `combatPower`            | NCSOFT Combat Power used for discovery order                     |
| `gearScore`              | ItemLevel/gear score; never substituted for CP                   |
| `profileImg`             | `profileImage`; no numeric ID needs to be invented               |
| `level`                  | Character level, currently not needed for aggregation            |
| `lastSeen`               | When Shugo last observed the profile                             |

Class-filtered responses do not expose an additional region-wide/global CP
rank; Daeva keeps `globalRank` null and preserves `rank`/`rankScope`. Neither
Shugo Power nor a competitive mode score is used.

Shugo documents that looked-up characters enter the dataset, profile lookups
update CP, and each region's top 500 is refreshed nightly. `generatedAt` records
response generation, not every character's refresh. `topRefreshedAt` applies to
that top population, not every entry. Source health states that individual
freshness varies. Profile CP is retained separately from discovery CP.

## Pipeline and restoration

```text
Combat Power UI → /api/scrape → Shugo Combat Power discovery
  → official info/equipment/equipment-item APIs → normalized builds → aggregation
  → SSE results/source health → representative real-player Quick Build
```

`LEADERBOARD_SOURCE_MODE=combat-power` is the centralized default. CP discovery
uses Shugo → matching fresh/stale full-build cache → same-population historical
aggregate → explicit unavailable. The Official and legacy Shugo implementations
remain intact and are never queried as the normal temporary discovery path.
Old mode choices are labeled historical-only and read their own aggregates.
No CP request falls back to a Nightmare aggregate. Filtered requests cannot
overwrite unfiltered snapshots or silently display unfiltered history.

`LEADERBOARD_SOURCE_MODE=mode-specific` restores Official → legacy Shugo → cache
for mode-specific analysis. Public configuration drives UI and scheduled jobs,
so no analyzer rewrite or separate public environment switch is required.
CP remains a distinct selectable provider/type and can be demoted later.

Global, Korea and Taiwan are supported end to end. Global uses
`https://aion2.plaync.com/api/character/*`, `lang=en-US`, and a server-derived
`region=nae|naw|eu|la|as`. Korea uses that host with `lang=en` and no Global
subregion. Taiwan uses `https://tw.ncsoft.com/aion2/api/character/*?lang=en`.
Each region's info, equipment and actual item-detail requests were verified
against public characters. The eight existing supported classes are Gladiator,
Templar, Ranger, Assassin, Spiritmaster, Sorcerer, Cleric and Chanter. Additional
upstream classes are outside this change.

Character builds prefer direct official JSON. Only failed direct requests use
Shugo's proxy for that same official URL. Item-specific requests preserve arcana
main stats/sets, runes and stones; they do not scrape Shugo build pages. The
interactive analyzer and prefetch share this implementation. Ranked waves keep
cached lower-ranked players from jumping ahead of higher-ranked live players.
Extra pages remain with the successful provider, capped at three CP pages.

## D1 and prefetch

No migration is required. Existing TEXT fields carry explicit namespaces:

- Raw official character cache: `character_id = REGION:originalId`, with server
  ID as the other existing key component. Old rows are reused only when their
  stored region matches. Official raw data can be shared between discovery
  modes because it carries no ranking population.
- CP full-build and aggregate rows: class plus
  `leaderboard = combat-power:shugo-cp:GLOBAL|KR|TW`. Builds retain original
  character/server/region, class, source, rank, scores and build timestamps.
- Legacy full-build and historical rows: original mode keys unchanged.

Interactive CP analysis checks these full-build rows before live discovery.
Fresh complete datasets are returned directly; complete stale datasets are
served for at most seven days and refreshed by the existing schedule. Recent
healthy smaller samples may satisfy a smaller request, but retain explicit
incomplete-population metadata. Cache health describes the stored build snapshot's age, not exact
upstream CP freshness. Historical aggregates retain their original mode and
timestamp; they provide no player-level Quick Build.

Scheduled CP prefetch runs every six hours at 03:17, 09:17, 15:17 and 21:17 UTC,
with one query per region/class (24 populations). A top-100 unfiltered region
response cannot supply the top 100 of each of eight classes. Region/class jobs
run with at most three active jobs. Discovery is reused across
authenticated continuation requests. Only completed jobs publish the full
snapshot. An explicit completeness record in the existing `data` JSON includes
the actual build count, target count (100 or a genuinely smaller available
population), and preparation origin. SQL guards prevent incomplete or malformed
results from replacing a complete dataset. Healthy official character caches
younger than six hours are reused during scheduled enrichment.

The scheduled CP workflow performs missing official enrichment on the GitHub
Actions runner using `scripts/prefetch-combat-power.mjs` and the shared
`fetchCharacterBuild` implementation. Worker invocations perform discovery,
bounded cache reads, authenticated build admission and final publication. This
removes repeated official-response parsing from Worker CPU-limited requests;
the analyzer and D1 cache architecture remain the same. No extra service, table
or migration is required. Manual prefetch retains the original Worker path.

The API accepts a complete runner build only for the next discovered character,
with matching region, class, IDs, CP rank/score and a recent original timestamp.
Uploads populate the existing versioned player cache, preserving every
normalized equipment/skill/arcana/rune/stone field. Only the complete final
population replaces the full-build snapshot. One retry per failed character
handles transient official responses without restarting discovery or refetching
earlier builds; unresolved mismatches remain failures. API requests also have
bounded retries, progress guards and a 125-batch limit.

A refresh lease in that same row coordinates cold interactive requests and
scheduled jobs, expires after ten minutes without a renewed continuation, and
never changes the last usable build snapshot or its freshness. Waiting browser
requests retry for up to ten minutes instead of duplicating enrichment.
Admin status lists all 24 populations and reports completeness, freshness,
expiry, nominal next scheduled run, failed attempts and expired leases. It omits
lease tokens and credentials. Upstream 503s and empty/malformed/incomplete final
responses now fail the workflow; only an explicit disabled-prefetch response
is skipped.

Scheduled enrichment batches keep completed identities in their checkpoint and
read only the next player-cache wave. This avoids repeatedly parsing an increasing
completed prefix on Workers with tight CPU limits. A separate publication phase
loads the full completed population once, aggregates it and saves the dataset
without fetching another character. Admission checks read freshness and
completeness metadata instead of transferring all cached builds. An unresolved
build failure stops the job immediately, includes cumulative error counts, and
permits one bounded population restart that reuses complete character caches.
Large snapshots share repeated object field schemas inside the existing builds
JSON column to stay within D1 row limits. This lossless encoding preserves every
build value; ordinary array snapshots remain supported. Counts, freshness checks
and replacement guards understand both formats.

A real local top-100 run took about 150 seconds per 970-fetch-budget batch.
Scheduled requests allow four minutes, with a 90-minute region/class-job timeout.
The 120-batch cap accommodates one full build per Free/Bundled-plan invocation;
continuations must advance and never publish an incomplete prefetch snapshot.

The default fresh TTL is 420 minutes; jobs completed in the last 330 minutes
are skipped only if the cache contains a complete top-100 sample (or all of a
smaller available population). Small interactive or partial samples do not
suppress scheduled warming. This tracks profile lookups between nightly top-500 refreshes
without the previous 30-minute mode traversal. Worker routes default to a
50-subrequest cap with five requests reserved, completing one player at a time.
Set `WORKER_SUBREQUEST_LIMIT=1000` only when the deployment permits the paid
budget (970 fetches); that setting retains up to six concurrent official calls.
D1 has a separate query limit (50 per Free-plan invocation). Region-aware player
cache reads are grouped into SQL queries of at most 100 bound parameters, and
loaded builds are reused within a batch. Browser connection failures retry the
last completed checkpoint up to three attempts. On low-limit Workers, cached
players are processed in waves of at most five. Complete character caches retain
a versioned normalized build alongside the raw official JSON, so continuation
reads avoid reconstructing every earlier character's equipment and skills.
Legacy caches are upgraded as they are used, without changing their timestamp
or region identity and without a database migration. Browser retries use the
same discovery population. Complete SSE checkpoints are
accepted before socket closure; exhausted retries retain completed builds and
offer Resume Scan. Requests that cannot complete a
character cannot return a repeating continuation. Review cadence/TTL when
official modes return.

## Attribution and release status

Leaderboard discovery is credited to **[Shugo.GG](https://shugo.gg/leaderboard)**.
Build data comes from NCSOFT. Daeva is independent of both organizations and
implies no affiliation or endorsement. This is temporary Combat Power analysis,
not restoration of official game-mode leaderboards. The `1.0.0` gate remains:
the intended live mode-specific pipeline must return and be validated first.
