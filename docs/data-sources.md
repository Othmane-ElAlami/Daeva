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

Full snapshots expire according to their TTL and remain usable for at most
seven days. Cache health describes the stored build snapshot's age, not exact
upstream CP freshness. Historical aggregates retain their original mode and
timestamp; they provide no player-level Quick Build.

Scheduled CP prefetch runs every six hours at 03:17, 09:17, 15:17 and 21:17 UTC,
with one query per region/class (24 populations). A top-100 unfiltered region
response cannot supply the top 100 of each of eight classes. Region jobs run
independently; classes run sequentially with delays. Discovery is reused across
authenticated continuation requests. Only completed jobs publish the full
snapshot. Retry handling, admin authentication, disabled/upstream-down 503s,
bounded continuations and failure thresholds remain in place.

A real local top-100 run took about 150 seconds per 970-fetch-budget batch.
Scheduled requests therefore allow four minutes, with a 90-minute region-job
timeout. These remain bounded and avoid retrying healthy enrichment just
because the previous two-minute request timeout expired.

The default fresh TTL is 420 minutes; jobs completed in the last 330 minutes
are skipped only if the cache contains a complete top-100 sample (or all of a
smaller available population). Small interactive or partial samples do not
suppress scheduled warming. This tracks profile lookups between nightly top-500 refreshes
without the previous 30-minute mode traversal. Daeva retains its conservative
970-fetch invocation budget and limits enrichment to six concurrent official
requests. The deployment's existing paid-Worker assumption remains; Free-plan
limits require a smaller budget. Review cadence/TTL when official modes return.

## Attribution and release status

Leaderboard discovery is credited to **[Shugo.GG](https://shugo.gg/leaderboard)**.
Build data comes from NCSOFT. Daeva is independent of both organizations and
implies no affiliation or endorsement. This is temporary Combat Power analysis,
not restoration of official game-mode leaderboards. The `1.0.0` gate remains:
the intended live mode-specific pipeline must return and be validated first.
