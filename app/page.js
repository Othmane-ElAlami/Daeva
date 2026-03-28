"use client";

import "./homepage.css";
import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { ArrowRight, Menu, X } from "lucide-react";

/* ═══════════════════════════════════════════
   DATA
   ═══════════════════════════════════════════ */

const SCRAMBLE_GLYPHS = "αβγδεζηθλμξπστφχψωᚠᚢᚦᚨᚱᚲᛃᛈᛉᛊᛏ∑∆∏≈∞⊕⊗∇";

const STATS = [
  { value: "7", label: "Leaderboards" },
  { value: "42", label: "Servers" },
  { value: "8", label: "Classes" },
  { value: "2", label: "Regions" },
];

// Map arcana set names to CSS tag classes
const ARCANA_TAG_COLORS = {
  "pure blood": "cin-widget-arcana-tag--red",
  frenzy: "cin-widget-arcana-tag--orange",
  "primal vigor": "cin-widget-arcana-tag--green",
  "magic armor": "cin-widget-arcana-tag--blue",
};

function arcanaTagClass(name) {
  const lower = name.toLowerCase();
  for (const [key, cls] of Object.entries(ARCANA_TAG_COLORS)) {
    if (lower.includes(key)) return cls;
  }
  return "cin-widget-arcana-tag--red";
}

function formatTimeAgo(timestamp) {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function snapshotToDisplay(snap) {
  const topCombo = snap.arcanaSetCombos[0];
  const arcana = topCombo
    ? topCombo.combo.split(" + ").map((part) => ({
        name: part.replace(/\((\d+)\)/, " ×$1"),
        class: arcanaTagClass(part),
      }))
    : [];

  const leaderboardLabels = {
    nightmare: "Nightmare",
    abyss: "Abyss",
    "arena-solo": "Arena Solo",
    "arena-coop": "Arena Coop",
    transcendence: "Transcendence",
    ascension: "Ascension",
    raid: "Raid",
  };

  return {
    className: snap.className.charAt(0).toUpperCase() + snap.className.slice(1),
    mode: leaderboardLabels[snap.leaderboard] || snap.leaderboard,
    usage: `${snap.stigmaSkills[0]?.pct ?? 0}%`,
    totalPlayers: snap.totalPlayers,
    stigmas: snap.stigmaSkills
      .slice(0, 6)
      .map((s) => ({ name: s.name, icon: "St" })),
    skills: snap.activeSkills
      .slice(0, 6)
      .map((s) => ({ name: s.name, icon: "Sk" })),
    passives: snap.passiveSkills
      .slice(0, 6)
      .map((s) => ({ name: s.name, icon: "Ps" })),
    arcana,
    arcanaUsage: topCombo ? `${topCombo.pct}%` : "—",
    updatedAt: snap.updatedAt,
  };
}

/* ═══════════════════════════════════════════
   HOOKS
   ═══════════════════════════════════════════ */

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);
  return reduced;
}

/* ═══════════════════════════════════════════
   CINEMATIC HEADLINE
   ═══════════════════════════════════════════ */

function CinematicHeadline({ text, startDelay = 1200, className = "" }) {
  const charsRef = useRef([]);
  const [started, setStarted] = useState(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced) {
      setStarted(true);
      return;
    }
    const timer = setTimeout(() => setStarted(true), startDelay);
    return () => clearTimeout(timer);
  }, [startDelay, reduced]);

  useEffect(() => {
    if (!started || reduced) return;

    charsRef.current.forEach((el, i) => {
      if (!el) return;
      const finalChar = text[i];
      const delay = i * 80;
      const scrambleFrames = 10;
      let frame = 0;

      const timer = setTimeout(() => {
        el.classList.add("cin-hero-char--visible");

        const interval = setInterval(() => {
          if (frame < scrambleFrames) {
            el.textContent =
              SCRAMBLE_GLYPHS[
                Math.floor(Math.random() * SCRAMBLE_GLYPHS.length)
              ];
            el.classList.add("cin-hero-char--scramble");
            frame++;
          } else {
            el.textContent = finalChar;
            el.classList.remove("cin-hero-char--scramble");
            clearInterval(interval);
          }
        }, 40);
      }, delay);

      return () => clearTimeout(timer);
    });
  }, [started, text, reduced]);

  if (reduced) {
    return <span className={`cin-hero-headline ${className}`}>{text}</span>;
  }

  return (
    <span className={`cin-hero-headline ${className}`} aria-label={text}>
      {text.split("").map((char, i) => (
        <span
          key={i}
          ref={(el) => (charsRef.current[i] = el)}
          className="cin-hero-char"
          aria-hidden="true"
        >
          {"\u00A0"}
        </span>
      ))}
    </span>
  );
}

/* ═══════════════════════════════════════════
   TEXT SCRAMBLE ON HOVER
   ═══════════════════════════════════════════ */

function ScrambleText({ text, as: Tag = "span", className = "" }) {
  const elRef = useRef(null);
  const isScrambling = useRef(false);

  const scramble = useCallback(() => {
    const el = elRef.current;
    if (!el || isScrambling.current) return;
    isScrambling.current = true;

    const length = text.length;
    const maxFrames = length + 12;
    let frame = 0;

    const tick = () => {
      let output = "";
      for (let i = 0; i < length; i++) {
        if (frame >= maxFrames - length + i) {
          output += text[i];
        } else {
          output +=
            SCRAMBLE_GLYPHS[Math.floor(Math.random() * SCRAMBLE_GLYPHS.length)];
        }
      }
      el.textContent = output;
      frame++;
      if (frame <= maxFrames) {
        requestAnimationFrame(tick);
      } else {
        isScrambling.current = false;
      }
    };
    tick();
  }, [text]);

  return (
    <Tag ref={elRef} className={className} onMouseEnter={scramble}>
      {text}
    </Tag>
  );
}

/* ═══════════════════════════════════════════
   META WIDGET
   ═══════════════════════════════════════════ */

function MetaWidget({ active }) {
  const [metaData, setMetaData] = useState([]);
  const [classIndex, setClassIndex] = useState(0);
  const [sectionsVisible, setSectionsVisible] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/meta-snapshot")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const entries = (data.snapshots || [])
          .filter((s) => s.stigmaSkills.length > 0)
          .map(snapshotToDisplay);
        setMetaData(entries);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!active || metaData.length === 0) return;

    const initTimers = [
      setTimeout(() => setSectionsVisible((p) => [...p, 0]), 150),
      setTimeout(() => setSectionsVisible((p) => [...p, 1]), 300),
      setTimeout(() => setSectionsVisible((p) => [...p, 2]), 450),
    ];

    const intervalId = setInterval(() => {
      setSectionsVisible([]);
      setTimeout(() => {
        setClassIndex((prev) => (prev + 1) % metaData.length);
        setTimeout(() => setSectionsVisible((p) => [...p, 0]), 150);
        setTimeout(() => setSectionsVisible((p) => [...p, 1]), 300);
        setTimeout(() => setSectionsVisible((p) => [...p, 2]), 450);
      }, 500);
    }, 6000);

    return () => {
      initTimers.forEach(clearTimeout);
      clearInterval(intervalId);
    };
  }, [active, metaData.length]);

  if (!loading && metaData.length === 0) {
    return (
      <div
        className={`cin-widget ${active ? "cin-widget--visible" : ""}`}
        aria-label="Live meta snapshot preview"
      >
        <div className="cin-widget-header">
          <div className="cin-widget-title">
            <div className="cin-sonar">
              <div className="cin-sonar-dot" />
              <div className="cin-sonar-ring" />
            </div>
            LIVE META SNAPSHOT
          </div>
        </div>
        <div
          className="cin-widget-body cin-widget-body--meta"
          style={{ textAlign: "center", padding: "40px 20px" }}
        >
          <div
            className="cin-meta-label"
            style={{ color: "var(--text-secondary)" }}
          >
            No snapshot data yet — run an analysis in the{" "}
            <Link
              href="/analyzer"
              style={{ color: "var(--accent)", textDecoration: "underline" }}
            >
              Analyzer
            </Link>{" "}
            to populate live data.
          </div>
        </div>
        <div className="cin-widget-footer">
          <div className="cin-widget-updated">
            <span
              className="cin-widget-updated-dot"
              style={{ background: "var(--text-secondary)" }}
            />
            Awaiting Data
          </div>
        </div>
      </div>
    );
  }

  if (loading || metaData.length === 0) return null;

  const currentData = metaData[classIndex % metaData.length];
  const timeAgo = currentData.updatedAt
    ? formatTimeAgo(currentData.updatedAt)
    : null;

  return (
    <div
      className={`cin-widget ${active ? "cin-widget--visible" : ""}`}
      aria-label="Live meta snapshot preview"
    >
      <div className="cin-widget-header">
        <div className="cin-widget-title">
          <div className="cin-sonar">
            <div className="cin-sonar-dot" />
            <div className="cin-sonar-ring" />
          </div>
          LIVE META SNAPSHOT
        </div>
        <span className="cin-widget-mode">
          <ScrambleText
            text={`${currentData.mode} · ${currentData.className}`}
            key={currentData.className}
          />
        </span>
      </div>

      <div className="cin-widget-body cin-widget-body--meta">
        <div
          className={`cin-meta-section ${sectionsVisible.includes(0) ? "cin-meta-section--visible" : ""}`}
        >
          <div className="cin-meta-label">
            Top Stigma Usage
            <span className="cin-meta-highlight">{currentData.usage}</span>
          </div>
          <div
            className="cin-meta-label"
            style={{
              marginTop: "4px",
              fontSize: "0.65rem",
              color: "var(--text-secondary)",
            }}
          >
            Based on {currentData.totalPlayers} top players
          </div>
          <div
            className="cin-meta-label"
            style={{ marginTop: "12px", color: "var(--text-secondary)" }}
          >
            Stigmas
          </div>
          <div className="cin-meta-skills">
            {currentData.stigmas.map((stigma, i) => (
              <div key={i} className="cin-meta-skill">
                <span className="cin-meta-skill-icon cin-meta-skill-icon--stigma">
                  {stigma.icon}
                </span>
                <span className="cin-meta-skill-name">{stigma.name}</span>
              </div>
            ))}
          </div>
        </div>

        <div
          className={`cin-meta-section ${sectionsVisible.includes(1) ? "cin-meta-section--visible" : ""}`}
        >
          <div
            className="cin-meta-label"
            style={{ color: "var(--text-secondary)" }}
          >
            Skills
          </div>
          <div className="cin-meta-skills">
            {currentData.skills.map((skill, i) => (
              <div key={i} className="cin-meta-skill">
                <span className="cin-meta-skill-icon cin-meta-skill-icon--skill">
                  {skill.icon}
                </span>
                <span className="cin-meta-skill-name">{skill.name}</span>
              </div>
            ))}
          </div>
        </div>

        <div
          className={`cin-meta-section ${sectionsVisible.includes(2) ? "cin-meta-section--visible" : ""}`}
        >
          <div
            className="cin-meta-label"
            style={{ color: "var(--text-secondary)" }}
          >
            Passives
          </div>
          <div className="cin-meta-skills">
            {currentData.passives.map((passive, i) => (
              <div key={i} className="cin-meta-skill">
                <span className="cin-meta-skill-icon cin-meta-skill-icon--passive">
                  {passive.icon}
                </span>
                <span className="cin-meta-skill-name">{passive.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="cin-widget-footer">
        <div className="cin-widget-arcana">
          <span className="cin-widget-arcana-label">Top Arcana Synergy</span>
          <div className="cin-widget-arcana-combo">
            {currentData.arcana.map((arc, i) => (
              <span key={i} className={`cin-widget-arcana-tag ${arc.class}`}>
                {arc.name}
              </span>
            ))}
            <span className="cin-widget-usage">{currentData.arcanaUsage}</span>
          </div>
        </div>
        <div className="cin-widget-updated">
          <span className="cin-widget-updated-dot" />
          {timeAgo ? `Updated ${timeAgo}` : "Live Server Sync"}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   MAIN HOMEPAGE — Single-screen layout
   ═══════════════════════════════════════════ */

export default function HomePage() {
  const [introPhase, setIntroPhase] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const reduced = useReducedMotion();

  /* ── Intro Sequence ── */
  useEffect(() => {
    if (reduced) {
      setIntroPhase(10);
      return;
    }

    const timers = [
      setTimeout(() => setIntroPhase(1), 100),
      setTimeout(() => setIntroPhase(2), 400),
      setTimeout(() => setIntroPhase(3), 800),
      setTimeout(() => setIntroPhase(4), 1000),
      setTimeout(() => setIntroPhase(5), 1200),
      setTimeout(() => setIntroPhase(6), 1600),
      setTimeout(() => setIntroPhase(7), 1900),
      setTimeout(() => setIntroPhase(8), 2100),
      setTimeout(() => setIntroPhase(9), 2500),
    ];
    return () => timers.forEach(clearTimeout);
  }, [reduced]);

  return (
    <div className="cin-page">
      {/* ═══ BACKGROUND SYSTEM ═══ */}
      <div
        className={`cin-bg-void ${introPhase >= 1 ? "cin-bg-void--active" : ""}`}
        aria-hidden="true"
      />
      <div
        className={`cin-bg-stars ${introPhase >= 1 ? "cin-bg-stars--active" : ""}`}
        aria-hidden="true"
      />
      <div
        className={`cin-bg-wisps ${introPhase >= 2 ? "cin-bg-wisps--active" : ""}`}
        aria-hidden="true"
      />
      <div
        className={`cin-bg-geo ${introPhase >= 3 ? "cin-bg-geo--active" : ""}`}
        aria-hidden="true"
      >
        <div className="cin-sigil cin-sigil--1" />
        <div className="cin-sigil cin-sigil--2" />
        <div className="cin-sigil cin-sigil--3" />
        <div className="cin-sigil-cross--1" />
      </div>
      <div
        className={`cin-lights ${introPhase >= 2 ? "cin-lights--active" : ""}`}
        aria-hidden="true"
      >
        <div className="cin-light cin-light--1" />
        <div className="cin-light cin-light--2" />
        <div className="cin-light cin-light--3" />
      </div>
      <div className="cin-grain" aria-hidden="true" />
      <div className="cin-vignette" aria-hidden="true" />

      {/* ═══ NAVIGATION ═══ */}
      <nav
        className={`cin-nav ${introPhase >= 4 ? "cin-nav--visible" : ""}`}
        role="navigation"
        aria-label="Main navigation"
      >
        <div className="cin-nav-inner">
          <Link
            href="/"
            className="cin-nav-logo"
            aria-label="Daeva Analyzer home"
          >
            <span className="cin-nav-logo-mark">◈</span>
            <span className="cin-nav-logo-text">DAEVA</span>
          </Link>

          <Link href="/analyzer" className="cin-nav-cta">
            Launch Analyzer
            <ArrowRight size={14} />
          </Link>

          <button
            className="cin-nav-mobile-btn"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        <div
          className={`cin-nav-mobile-menu ${mobileMenuOpen ? "cin-nav-mobile-menu--open" : ""}`}
          role="menu"
        >
          <Link
            href="/analyzer"
            className="cin-mobile-link cin-mobile-link--cta"
            role="menuitem"
            onClick={() => setMobileMenuOpen(false)}
          >
            Launch Analyzer <ArrowRight size={14} />
          </Link>
        </div>
      </nav>

      {/* ═══ HERO — Full viewport ═══ */}
      <section className="cin-hero" aria-labelledby="hero-heading">
        <div className="cin-hero-grid">
          {/* ── Left column ── */}
          <div className="cin-hero-left">
            <div
              className={`cin-hero-badge ${introPhase >= 5 ? "cin-hero-badge--visible" : ""}`}
            >
              <div className="cin-sonar">
                <div className="cin-sonar-dot" />
                <div className="cin-sonar-ring" />
              </div>
              <span>AION 2 BUILD INTELLIGENCE</span>
            </div>

            <h1 id="hero-heading" className="cin-hero-title">
              <CinematicHeadline text="DAEVA" startDelay={1200} />
              <span className="cin-hero-line2">
                <span
                  className={`cin-hero-line2-inner ${introPhase >= 6 ? "cin-hero-line2-inner--visible" : ""}`}
                >
                  ANALYZER
                </span>
              </span>
            </h1>

            <p
              className={`cin-hero-tagline ${introPhase >= 6 ? "cin-hero-tagline--visible" : ""}`}
            >
              Decode the meta from top-ranked players across Atreia. Real-time
              leaderboard analysis and competitive intelligence for every class.
            </p>

            <div
              className={`cin-hero-actions ${introPhase >= 7 ? "cin-hero-actions--visible" : ""}`}
            >
              <Link href="/analyzer" className="cin-cta-primary">
                <span>Launch Analyzer</span>
                <ArrowRight size={18} />
              </Link>
            </div>

            <div
              className={`cin-hero-trust ${introPhase >= 9 ? "cin-hero-trust--visible" : ""}`}
            >
              {STATS.map((s) => (
                <div key={s.label} className="cin-trust-item">
                  <span className="cin-trust-value">{s.value}</span>
                  <span className="cin-trust-label">{s.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Right column — Meta Widget ── */}
          <MetaWidget active={introPhase >= 8} />
        </div>
      </section>

      {/* ═══ FOOTER — inline at bottom ═══ */}
      <footer className="cin-footer" role="contentinfo">
        <div className="cin-footer-inner">
          <p className="cin-footer-text">
            Aion 2 Build Intelligence &middot; Leaderboards from{" "}
            <a
              href="https://shugo.gg/leaderboard"
              target="_blank"
              rel="noopener noreferrer"
              className="cin-footer-link"
            >
              shugo.gg
            </a>{" "}
            &middot; Data from Official API
          </p>
          <p className="cin-footer-tagline">
            Forged in the shadows of the abyss with love, hate, the spilled
            blood of Balaurs, and the torn skin of my enemies.
          </p>
        </div>
      </footer>
    </div>
  );
}
