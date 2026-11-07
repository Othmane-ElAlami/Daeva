import { APP_VERSION } from "./release.js";

// Keep the current release complete: tests compare every item with CHANGELOG.md.
export const CURRENT_RELEASE = {
  version: APP_VERSION,
  label: `Beta ${APP_VERSION.replace(/-beta$/, "")}`,
  date: "Nov 7, 2026",
  latest: true,
  groups: [
    {
      type: "new",
      typeLabel: "Added",
      items: [
        {
          title: "Paired equipment regression coverage",
          desc: "Regression coverage for both numbered slots of every paired accessory, mixed fresh/cached builds, complete item/substat totals, and all supported regions' equipment fixtures.",
        },
        {
          title: "Complete in-app release notes",
          desc: "Complete current release notes in the in-app changelog, with an automated consistency check against the Markdown changelog and package metadata.",
        },
      ],
    },
    {
      type: "improved",
      typeLabel: "Changed",
      items: [
        {
          title: `Version ${APP_VERSION}`,
          desc: `Set the app and package version to ${APP_VERSION}.`,
        },
        {
          title: "Concise analyzer headers",
          desc: "Shorten analyzer headers and move source explanations and detailed freshness metadata into collapsible sections. Combat Power and historical game-mode labels remain explicit.",
        },
        {
          title: "Accurate partial scan labels",
          desc: "Label retained results from an interrupted scan as partial, with a concise class/count/basis summary.",
        },
      ],
    },
    {
      type: "fixed",
      typeLabel: "Fixed",
      items: [
        {
          title: "Accessory and Arcana grouping",
          desc: "Keep Brooch, Seal and Pendant under Accessories in both equipment panels. Recognize Chalice and the newer Key, Hourglass, Dice and Lantern Arcana types, and keep unrecognized slots visible under Other Equipment instead of misplacing or hiding them.",
        },
        {
          title: "One card per paired accessory",
          desc: "Combine paired rings, earrings, bracelets, brooches, seals and runes into one card per accessory type, including numbered entries in older cached results. Preserve item counts, substat values, maximum enchantments and item levels when combining slots.",
        },
        {
          title: "Item recovery after transport exhaustion",
          desc: "Keep the bounded item retry available after transient transport retries are exhausted, preserving successful item details instead of failing an otherwise enriched population immediately. Add typed timeout errors, keep authentication/rate-limit/lease/deadline stops, and propagate equipment-recheck transport failures rather than hiding them behind earlier missing-item errors. Unresolved builds remain unpublished and the last complete cache is retained.",
        },
        {
          title: "Prepare cached players within CPU limits",
          desc: "Acknowledge scheduled build uploads before preparing the next cached players, and read/normalize at most one cached character per preparation call, reducing peak Worker CPU work that can exhaust Cloudflare resource limits mid-population. Preserve strict upload validation, idempotent retries, cache reuse and complete-only publication; keep older runners compatible and bound the additional preparation checkpoints to 320 API batches.",
        },
        {
          title: "Temporary prefetch API recovery",
          desc: "Allow 30/60-second recovery for temporary prefetch API server errors, including non-JSON 503 responses during final publication. Retry the same checkpoint without repeating successful discovery/enrichment, honor bounded Retry-After, and retain redacted response diagnostics and Cloudflare Ray IDs. Exhausted recovery preserves the last complete dataset and prepared character caches.",
        },
        {
          title: "Temporary discovery recovery",
          desc: "Allow 30/60-second recovery for temporary discovery exhaustion during scheduled prefetch. Preserve the redacted upstream error in retry/failure logs and refresh status instead of reporting only UPSTREAM_UNAVAILABLE; keep provider exhaustion explicit and retain the last complete cache.",
        },
        {
          title: "Complete discovery configuration",
          desc: "Retry incomplete discovery configuration responses during scheduled prefetch startup, including truncated HTTP-200 JSON. Validate the selected mode/class/region before enrichment and fail explicitly after bounded recovery; keep cache data and refresh safeguards unchanged.",
        },
        {
          title: "Immediate validated proxy fallback",
          desc: "Try the validated official-JSON proxy immediately when scheduled direct requests return HTTP 404 or unavailable data, avoiding repeated direct-request delays that exhausted Global prefetch's deadline. Use four scheduled item workers to absorb response latency under the unchanged per-host request-rate cap. Keep bounded retries for unresolved proxy requests, strict build validation and the last complete cache. Count immediate fallbacks for unavailable responses in runner summaries.",
        },
        {
          title: "Settled parallel character requests",
          desc: "Settle parallel profile/equipment requests before returning a failed character. Stop omitted profiles from continuing upstream retries, and preserve hard rate-limit/authentication failures when a simultaneous profile lookup is unavailable.",
        },
        {
          title: "Continue from cached to live builds",
          desc: "Accept the scheduled handoff from a cached checkpoint to the next uncached player without requiring its build count to increase first. Keep progress checks for repeated checkpoints and unaccepted uploads, preventing duplicate enrichment.",
        },
        {
          title: "Separate rate limit wait budgets",
          desc: "Separate HTTP-429 wait limits from ordinary per-request retries so long Global populations retain item recovery after ten minutes of accumulated 404 delays. Bound upstream work to 80 minutes and retain the last complete dataset on deadline/failure.",
        },
        {
          title: "Paced upstream requests and lease renewal",
          desc: "Pace scheduled upstream requests and honor HTTP-429 Retry-After with shared, bounded cooldowns. Retry individual requests while retaining successful item details and completed players, renew continuation leases during waits, and prevent overlapping jobs for the same population. Distinguish unavailable profiles from real ID mismatches and keep response-body reads within their timeout.",
        },
        {
          title: "Backfill individually unavailable profiles",
          desc: "Backfill individually unavailable CP profiles/items from the next ranks to prepare 100 complete available builds. Preserve actual ranks, disclose omissions in source details/status and stop on widespread failures; rate limits and authentication/transport failures cannot be skipped. Keep the last complete cache on unsuccessful refreshes.",
        },
        {
          title: "Transient profile and item recovery",
          desc: "Retry transient official HTTP 404 responses before declaring a character/item unavailable; retain successful item details while retrying.",
        },
        {
          title: "Changed equipment recovery",
          desc: "Recover scheduled enrichment when a failed item belongs to changed equipment: recheck the failed slot and rebuild that character once from fresh official data. Preserve strict item validation and the previous cache when equipment is unchanged or the replacement still fails.",
        },
        {
          title: "Validated official profile fallback",
          desc: "Validate official profile stats and equipment before selecting their response, so an HTTP-200 payload with unavailable Item Level, Combat Power or equipment can recover through the first-party proxy. Require matching character/server IDs and complete data on both transports; unresolved failures retain the previous full population.",
        },
        {
          title: "Bounded cache reads and item diagnostics",
          desc: "Filter stale player-cache rows in SQL during scheduled CP preparation. Recover invalid direct item responses through the validated first-party proxy and retry only failed items; retain complete datasets on unresolved failures. Report bounded stage/item/HTTP diagnostics in workflow logs and prefetch status with credential redaction.",
        },
        {
          title: "Verified duplicate lookup recovery",
          desc: "Ignore corrupt CP lookup duplicates only when a valid entry with the same official profile key and character metadata exists. Preserve the valid entry's ID, CP and rank, and continue bounded pagination to prepare 100 unique builds; standalone malformed IDs remain provider failures.",
        },
        {
          title: "Scheduled enrichment on the runner",
          desc: "Fetch scheduled CP character/item builds on the GitHub Actions runner using the shared official enrichment code, keeping discovery, authenticated upload validation, cache reuse and complete D1 publication on Cloudflare. Retry transient character failures once without restarting the population; preserve the last usable dataset on unresolved failures.",
        },
        {
          title: "Bounded continuation and publication",
          desc: "Keep scheduled CP continuation work bounded, check freshness using cache metadata only, and publish aggregates in a separate invocation. Stop unhealthy refreshes early, report cumulative errors and allow one bounded retry using completed character caches.",
        },
        {
          title: "Lossless compact build snapshots",
          desc: "Encode large CP build snapshots losslessly in the existing D1 JSON column, retaining every gear/skill value while reducing repeated field names to fit row limits.",
        },
        {
          title: "Read the cache before coordinated refreshes",
          desc: "Serve healthy Combat Power D1 datasets before live discovery/enrichment, coordinate concurrent cold requests in the existing cache row, and preserve complete populations when refreshes fail or return partial data.",
        },
        {
          title: "Publish complete prefetched builds",
          desc: "Require complete enriched populations and valid successful responses in scheduled prefetch; expose build counts, completeness, freshness and failed populations through authenticated status.",
        },
        {
          title: "Batch player caches by region",
          desc: "Batch region-aware player-cache reads and reuse each batch's loaded builds, keeping top-100 scans below D1's per-invocation query limit without dropping official item details.",
        },
        {
          title: "Reusable normalized build projections",
          desc: "Reuse versioned normalized build projections and bound cached-player processing on Free-plan Workers, reducing repeated raw equipment parsing in long scans while retaining the original cache timestamps and official data.",
        },
        {
          title: "Interrupted analysis recovery",
          desc: "Retry interrupted analysis connections from the last completed checkpoint, accept complete SSE results before socket closure, and retain completed builds with a Resume Scan action if retries are exhausted.",
        },
      ],
    },
    {
      type: "infra",
      typeLabel: "Release status",
      items: [
        {
          title: "Beta status and official rankings",
          desc: `Version ${APP_VERSION} uses temporary Combat Power discovery. The 1.0.0 gate requires the official mode-specific live analysis to return and be validated.`,
        },
      ],
    },
  ],
};
