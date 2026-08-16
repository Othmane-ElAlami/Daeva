import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import "./changelog.css";

export const metadata = {
  title: "Changelog — Daeva Analyzer",
  description: "Version history and release notes for Daeva Analyzer.",
};

const CHANGELOG = [
  {
    version: "0.10",
    label: "Beta 0.10.0",
    date: "Aug 16, 2026",
    latest: true,
    groups: [
      {
        type: "new",
        typeLabel: "New",
        items: [
          {
            title: "Resilient leaderboard provider",
            desc: "Abstracted leaderboard fetching with Shugo/Official provider failovers and historical snapshot fallback.",
          },
          {
            title: "Full-build Cloudflare D1 cache",
            desc: "Improved analyzer reliability and cache coverage for live and historical data.",
          },
          {
            title: "Open-source transition",
            desc: "Added contributor/security documentation, public repository metadata, and 0BSD licensing.",
          },
        ],
      },
      {
        type: "improved",
        typeLabel: "Improved",
        items: [
          {
            title: "Source-health indicators",
            desc: "More transparent data-source messaging separating live, cached, stale, and historical data.",
          },
        ],
      },
      {
        type: "infra",
        typeLabel: "Infrastructure",
        items: [
          {
            title: "Testing & CI",
            desc: "Added unit and integration test suite, and automated deployment with scheduled prefetch.",
          },
        ],
      },
    ],
  },
  {
    version: "0.9",
    label: "Beta 0.9.0",
    date: "Apr 20, 2026",
    groups: [
      {
        type: "new",
        typeLabel: "New",
        items: [
          {
            title: "Searchable server dropdown",
            desc: "Replaced the flat server list with a filterable dropdown so you can jump straight to any of the 42 servers by name.",
          },
          {
            title: "Enchant & item level tracking",
            desc: "Scraper now records enchant levels and stone usage per item, enabling gear progression analysis alongside build data.",
          },
        ],
      },
      {
        type: "improved",
        typeLabel: "Improved",
        items: [
          {
            title: "Build completeness checks",
            desc: "Switched to a numeric character key for deduplication; completeness scoring is now significantly more accurate.",
          },
          {
            title: "Substat UI restyle",
            desc: "Reordered server list, cleaned up the substat panel layout, and removed lingering hover effects that caused visual noise.",
          },
          {
            title: "Retry & progress tracking",
            desc: "Prevented redundant re-fetches on resume; scrape progress reporting is now consistent across partial and full runs.",
          },
        ],
      },
      {
        type: "fixed",
        typeLabel: "Fixed",
        items: [
          {
            title: "Empty leaderboard crash",
            desc: "Gracefully handled leaderboards with zero entries, which occur at the start of new seasons.",
          },
        ],
      },
    ],
  },
  {
    version: "0.8",
    label: "Beta 0.8",
    date: "Apr 6, 2026",
    groups: [
      {
        type: "new",
        typeLabel: "New",
        items: [
          {
            title: "Stone usage stats",
            desc: "Enchantment stone consumption tracked and aggregated per class, surfaced in the analyzer UI.",
          },
          {
            title: "Cinematic homepage",
            desc: "Full visual overhaul of the landing page with an indigo accent theme, animated hero, stats band, and feature grid.",
          },
        ],
      },
      {
        type: "improved",
        typeLabel: "Improved",
        items: [
          {
            title: "Arcana fetch reliability",
            desc: "Consolidated to a single itemDetailsMap to eliminate duplicate requests and cache misses during arcana aggregation.",
          },
          {
            title: "Retry / backoff",
            desc: "Overhauled the exponential backoff strategy with jitter; log colors updated for clearer scan output.",
          },
          {
            title: "Richer player data",
            desc: "processedPlayers now includes extra fields (weapon type, race, server name) for downstream filtering.",
          },
        ],
      },
      {
        type: "infra",
        typeLabel: "Infrastructure",
        items: [
          {
            title: "Prettier & pre-commit hooks",
            desc: "Added Prettier with a cross-platform Husky pre-commit hook; entire codebase formatted on merge.",
          },
          {
            title: "Dependency bump",
            desc: "All packages updated; lockfile regenerated.",
          },
        ],
      },
    ],
  },
  {
    version: "0.7",
    label: "Beta 0.7",
    date: "Apr 1, 2026",
    groups: [
      {
        type: "new",
        typeLabel: "New",
        items: [
          {
            title: "Race & rune filters",
            desc: "Added Elyos / Asmodian race filter and rune-type filter to both the scrape API and the analyzer UI, with client-side re-aggregation so switching filters is instant.",
          },
          {
            title: "Test suite",
            desc: "Full unit and integration test coverage added with Vitest; tests cover scraper logic, API routes, DB helpers, and the analysis pipeline.",
          },
        ],
      },
      {
        type: "improved",
        typeLabel: "Improved",
        items: [
          {
            title: "Weapon slot normalization",
            desc: "Removed over-restrictive weapon validation; slot categorization simplified to handle edge-case weapon types returned by the API.",
          },
          {
            title: "Weapon category mapping",
            desc: "Standardized weapon category strings in extractBuild so two-handed and off-hand slots are consistently grouped.",
          },
        ],
      },
      {
        type: "fixed",
        typeLabel: "Fixed",
        items: [
          {
            title: "Chromium Android animation stutter",
            desc: "Resolved a will-change / compositor layer issue causing dropped frames on mobile Chromium.",
          },
        ],
      },
      {
        type: "infra",
        typeLabel: "Infrastructure",
        items: [
          {
            title: "Vitest & Husky",
            desc: "Added to the project; test runner wired into the CI pipeline.",
          },
        ],
      },
    ],
  },
  {
    version: "0.6",
    label: "Beta 0.6",
    date: "Mar 29, 2026",
    groups: [
      {
        type: "new",
        typeLabel: "New",
        items: [
          {
            title: "Landing page",
            desc: "Public homepage added at /; analyzer moved to /analyzer. Includes feature highlights, animated stats counter, and a hero section.",
          },
          {
            title: "Meta Snapshot API",
            desc: "New endpoint captures and stores a timestamped snapshot of the current meta state to D1 for historical comparison.",
          },
          {
            title: "Scan continuation & resume",
            desc: "Long scrape runs can now be paused and resumed without losing progress; budget exhaustion is handled gracefully with a partial result.",
          },
          {
            title: "UI theme redesign",
            desc: "Dark navy/red design system introduced with consistent CSS custom properties across all pages.",
          },
        ],
      },
      {
        type: "improved",
        typeLabel: "Improved",
        items: [
          {
            title: "Scraper modularization",
            desc: "Shared scraper logic extracted into src/lib/scraper-shared.js so the API route and the standalone CLI script share a single source of truth.",
          },
          {
            title: "Scan logging",
            desc: "Normalized log format across all scan phases; log-context styling improved for readability in the terminal.",
          },
        ],
      },
      {
        type: "infra",
        typeLabel: "Infrastructure",
        items: [
          {
            title: "Static asset routing",
            desc: "Moved manifest.json and other metadata files to public/ to satisfy Cloudflare Pages static asset routing.",
          },
        ],
      },
    ],
  },
  {
    version: "0.5",
    label: "Beta 0.5",
    date: "Mar 20, 2026",
    groups: [
      {
        type: "new",
        typeLabel: "New",
        items: [
          {
            title: "Structured logging",
            desc: "Replaced ad-hoc console calls with a structured logger (src/lib/logger.js) emitting JSON-compatible log entries.",
          },
          {
            title: "Item Level (GS) support",
            desc: "Gear score derived from item levels is now scraped, stored, and displayed alongside build data.",
          },
          {
            title: "Item usage stats",
            desc: "Per-item usage frequency aggregated across leaderboard builds; duplicate leaderboard entries deduplicated at fetch time.",
          },
          {
            title: "Initial deployment",
            desc: "Next.js app bootstrapped and wired for Cloudflare Pages with a D1 database, GitHub Actions CI, and Node 24.",
          },
        ],
      },
      {
        type: "fixed",
        typeLabel: "Fixed",
        items: [
          {
            title: "ESLint flat config",
            desc: "Resolved incompatibilities with the new ESLint flat config format introduced in ESLint v9.",
          },
        ],
      },
      {
        type: "infra",
        typeLabel: "Infrastructure",
        items: [
          {
            title: "GitHub Actions upgrade",
            desc: "Upgraded to Node 24 and latest action versions; deploy branch fixed to master.",
          },
          {
            title: "Favicons & PWA manifest",
            desc: "Added favicons and web app manifest; metadata icons wired through Next.js app router.",
          },
        ],
      },
    ],
  },
];

export default function ChangelogPage() {
  return (
    <div className="cl-page">
      <div className="cl-bg" aria-hidden="true" />

      {/* ═══ NAV ═══ */}
      <nav className="cl-nav" role="navigation" aria-label="Changelog navigation">
        <div className="cl-nav-inner">
          <Link href="/" className="cl-nav-logo" aria-label="Daeva Analyzer home">
            <span className="cl-nav-logo-mark">◈</span>
            <span>DAEVA</span>
          </Link>
          <Link href="/" className="cl-nav-back">
            <ArrowLeft size={14} />
            Back to home
          </Link>
        </div>
      </nav>

      {/* ═══ CONTENT ═══ */}
      <main className="cl-content">
        {/* Header */}
        <header className="cl-header">
          <div className="cl-header-eyebrow">
            <span className="cl-header-dot" aria-hidden="true" />
            Release Notes
          </div>
          <h1 className="cl-header-title">Changelog</h1>
          <p className="cl-header-sub">
            A running history of every version, feature, and fix shipped to Daeva Analyzer.
          </p>
        </header>

        {/* Timeline */}
        <div className="cl-timeline">
          {CHANGELOG.map((entry) => (
            <article
              key={entry.version}
              className="cl-version"
              aria-label={`Version ${entry.label}`}
            >
              {/* Left — meta */}
              <div className="cl-version-meta">
                <div>
                  <span
                    className={`cl-version-tag${entry.latest ? " cl-version-tag--latest" : ""}`}
                  >
                    {entry.latest ? "Latest" : entry.label}
                  </span>
                </div>
                <p className="cl-version-name">{entry.label}</p>
                <p className="cl-version-date">{entry.date}</p>
              </div>

              {/* Right — changes */}
              <div className="cl-version-node">
                <div className="cl-changes">
                  {entry.groups.map((group) => (
                    <div key={group.type} className="cl-change-group">
                      <div className="cl-change-group-header">
                        <span className={`cl-change-type cl-change-type--${group.type}`}>
                          {group.typeLabel}
                        </span>
                      </div>
                      <ul className="cl-change-items" role="list">
                        {group.items.map((item, i) => (
                          <li key={i} className="cl-change-item">
                            <div className="cl-change-item-body">
                              <span className="cl-change-item-title">{item.title}</span>
                              <span className="cl-change-item-desc">{item.desc}</span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      </main>

      {/* ═══ FOOTER ═══ */}
      <footer className="cl-footer" role="contentinfo">
        <div className="cl-footer-inner">
          <p className="cl-footer-text">Daeva Analyzer &middot; Aion 2 Build Intelligence</p>
          <span className="cl-footer-version">v0.10.0-beta</span>
        </div>
      </footer>
    </div>
  );
}
