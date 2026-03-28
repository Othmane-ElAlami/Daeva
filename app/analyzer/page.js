"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Loader2,
  Info,
  ChevronDown,
  CheckCircle2,
  Layers,
  Sparkles,
  Zap,
  Shield,
  Swords,
  Trophy,
  Terminal,
} from "lucide-react";

const CLASSES = [
  "chanter",
  "cleric",
  "sorcerer",
  "spiritmaster",
  "assassin",
  "ranger",
  "templar",
  "gladiator",
];
const LEADERBOARDS = [
  { id: "nightmare", label: "Nightmare" },
  { id: "abyss", label: "Abyss" },
  { id: "transcendence", label: "Transcendence" },
  { id: "arena-solo", label: "Arena Solo" },
  { id: "arena-coop", label: "Arena Coop" },
  { id: "ascension", label: "Ascension" },
  { id: "raid", label: "Raid" },
];

const REGIONS = [
  { id: "all", label: "All Regions" },
  { id: "KR", label: "Korea" },
  { id: "TW", label: "Taiwan" },
];

const ELYOS_SERVERS = [
  { id: "1001", name: "Siel" },
  { id: "1002", name: "Nezekan" },
  { id: "1003", name: "Vaizel" },
  { id: "1004", name: "Kaisinel" },
  { id: "1005", name: "Yustiel" },
  { id: "1006", name: "Ariel" },
  { id: "1007", name: "Fregion" },
  { id: "1008", name: "Meslamtaeda" },
  { id: "1009", name: "Hithanya" },
  { id: "1010", name: "Nania" },
  { id: "1011", name: "Tahavatha" },
  { id: "1012", name: "Luteros" },
  { id: "1013", name: "Phernos" },
  { id: "1014", name: "Daminu" },
  { id: "1015", name: "Kasaka" },
  { id: "1016", name: "Bakarma" },
  { id: "1017", name: "Tsenka" },
  { id: "1018", name: "Kochi" },
  { id: "1019", name: "Ishtar" },
  { id: "1020", name: "Tiamat" },
  { id: "1021", name: "Poeta" },
];

const ASMODIAN_SERVERS = [
  { id: "2001", name: "Israphel" },
  { id: "2002", name: "Zikel" },
  { id: "2003", name: "Triniel" },
  { id: "2004", name: "Lumiel" },
  { id: "2005", name: "Marchutan" },
  { id: "2006", name: "Azphel" },
  { id: "2007", name: "Ereshkigal" },
  { id: "2008", name: "Beritra" },
  { id: "2009", name: "Nemon" },
  { id: "2010", name: "Hadala" },
  { id: "2011", name: "Ludra" },
  { id: "2012", name: "Ulgorn" },
  { id: "2013", name: "Munin" },
  { id: "2014", name: "Odar" },
  { id: "2015", name: "Zemurru" },
  { id: "2016", name: "Kromede" },
  { id: "2017", name: "Quai" },
  { id: "2018", name: "Baba" },
  { id: "2019", name: "Fafnir" },
  { id: "2020", name: "Indnah" },
  { id: "2021", name: "Pandemonium" },
];

const fadeUp = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] },
};

const stagger = {
  animate: { transition: { staggerChildren: 0.06 } },
};

// Aion 2 item grade → color
//  API name  →  in-game name  →  color (confirmed ✓)
//  "Special" →  Special       →  turquoise ✓
//  "Epic"    →  Heroic        →  dark orange  ✓
//  "Unique"  →  Unique        →  golden yellow ✓
//  "Legend"  →  Epic          →  blue  ✓

function gradeColor(grade) {
  const map = {
    special: "#2dd4bf", // turquoise
    common: "#6b7280", // grey
    rare: "#22c55e", // green
    epic: "#c2410c", // dark orange
    unique: "#eab308", // golden yellow
    legend: "#3b82f6", // blue
    heroic: "#a855f7", // purple — placeholder, unconfirmed
  };
  if (grade === null || grade === undefined) return "#e4e4e7";
  const key = typeof grade === "string" ? grade.toLowerCase() : String(grade);
  return map[key] ?? "#e4e4e7";
}

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [logs, setLogs] = useState([]);
  const [progress, setProgress] = useState({
    current: 0,
    total: 10,
    target: "",
  });
  const [forma, setFormData] = useState({
    cls: "chanter",
    lbType: "nightmare",
    limit: 10,
    region: "all",
    serverId: "all",
  });

  const logContainerRef = useRef(null);
  const resultsLogContainerRef = useRef(null);

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs]);

  useEffect(() => {
    if (resultsLogContainerRef.current) {
      resultsLogContainerRef.current.scrollTop =
        resultsLogContainerRef.current.scrollHeight;
    }
  }, [logs, data]);

  if (!mounted) {
    return null;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setData(null);
    setLogs([]);
    setProgress({ current: 0, total: forma.limit, target: "" });

    try {
      const res = await fetch("/api/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(forma),
      });

      if (res.status === 429) {
        const data = await res.json();
        throw new Error(
          data.error || "Rate limit exceeded. Please wait before trying again.",
        );
      }
      if (!res.ok) {
        throw new Error("Failed to start analysis");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let buffer = "";

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop();
          for (const part of parts) {
            if (part.startsWith("data: ")) {
              try {
                const event = JSON.parse(part.slice(6));
                if (event.type === "log") {
                  setLogs((prev) => [
                    ...prev,
                    {
                      text: event.message,
                      level: event.level || "INFO",
                      context: event.context || "",
                      time: event.timestamp
                        ? new Date(event.timestamp).toLocaleTimeString(
                            "en-US",
                            {
                              hour12: false,
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                              fractionalSecondDigits: 3,
                            },
                          )
                        : new Date().toLocaleTimeString("en-US", {
                            hour12: false,
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                            fractionalSecondDigits: 3,
                          }),
                    },
                  ]);
                } else if (event.type === "progress") {
                  setProgress(event);
                } else if (event.type === "done") {
                  setData({
                    stats: event.stats,
                    count: event.count,
                    cls: forma.cls,
                    lb: forma.lbType,
                  });
                } else if (event.type === "error") {
                  throw new Error(event.message);
                }
              } catch (e) {
                if (
                  e.message &&
                  !e.message.includes("Unexpected end of JSON")
                ) {
                  throw e;
                }
              }
            }
          }
        }
      }
    } catch (err) {
      // Never show raw infrastructure errors to the user
      const msg = err.message || "";
      const isInternal =
        /subrequest|worker invocation|cloudflare|wrangler|d1_error|sqlite/i.test(
          msg,
        );
      setError(
        isInternal
          ? "The server is temporarily busy. Please try again with a smaller limit or wait a moment."
          : msg || "An unexpected error occurred. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  const percent = (count, total) =>
    total === 0 ? "0.0" : ((count / total) * 100).toFixed(1);

  return (
    <main
      className="container"
      style={{ paddingTop: "48px", paddingBottom: "64px" }}
    >
      {/* ── Header ── */}
      <motion.div
        initial={{ opacity: 0, y: -24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="text-center mb-8"
      >
        <h1>Daeva Analyzer</h1>
        <p
          className="text-muted mt-2"
          style={{ fontSize: "1rem", maxWidth: "400px", margin: "8px auto 0" }}
        >
          Decode the meta from top-ranked player builds
        </p>
      </motion.div>

      <div className="grid-cols-3">
        {/* ── Config Panel ── */}
        <motion.div
          initial={{ opacity: 0, x: -24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          className="glass-panel"
          style={{ height: "max-content", position: "sticky", top: "24px" }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              marginBottom: "24px",
            }}
          >
            <span
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: "36px",
                height: "36px",
                borderRadius: "10px",
                background:
                  "linear-gradient(135deg, rgba(124,58,237,0.15), rgba(124,58,237,0.05))",
                border: "1px solid rgba(124,58,237,0.2)",
              }}
            >
              <Search size={16} style={{ color: "#a78bfa" }} />
            </span>
            <div>
              <h2 style={{ fontSize: "1rem", marginBottom: "0" }}>Configure</h2>
              <p
                style={{
                  fontSize: "0.7rem",
                  color: "var(--text-tertiary)",
                  margin: 0,
                }}
              >
                Set up your analysis
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="flex-col gap-4">
            <div className="input-group">
              <label>Class</label>
              <div className="relative">
                <select
                  value={forma.cls}
                  onChange={(e) =>
                    setFormData({ ...forma, cls: e.target.value })
                  }
                  className="appearance-none"
                >
                  {CLASSES.map((c) => (
                    <option key={c} value={c}>
                      {c.charAt(0).toUpperCase() + c.slice(1)}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="absolute pointer-events-none"
                  style={{
                    right: "14px",
                    top: "12px",
                    color: "var(--text-tertiary)",
                  }}
                  size={14}
                />
              </div>
            </div>

            <div className="input-group">
              <label>Leaderboard</label>
              <div className="relative">
                <select
                  value={forma.lbType}
                  onChange={(e) =>
                    setFormData({ ...forma, lbType: e.target.value })
                  }
                  className="appearance-none"
                >
                  {LEADERBOARDS.map((lb) => (
                    <option key={lb.id} value={lb.id}>
                      {lb.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="absolute pointer-events-none"
                  style={{
                    right: "14px",
                    top: "12px",
                    color: "var(--text-tertiary)",
                  }}
                  size={14}
                />
              </div>
            </div>

            <div className="input-group">
              <label>Region</label>
              <div className="relative">
                <select
                  value={forma.region}
                  onChange={(e) =>
                    setFormData({
                      ...forma,
                      region: e.target.value,
                      serverId: "all",
                    })
                  }
                  className="appearance-none"
                >
                  {REGIONS.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="absolute pointer-events-none"
                  style={{
                    right: "14px",
                    top: "12px",
                    color: "var(--text-tertiary)",
                  }}
                  size={14}
                />
              </div>
            </div>

            <div className="input-group">
              <label>Server</label>
              <div className="relative">
                <select
                  value={forma.serverId}
                  onChange={(e) =>
                    setFormData({ ...forma, serverId: e.target.value })
                  }
                  className="appearance-none"
                >
                  <option value="all">All Servers</option>
                  <optgroup label="☀️ Elyos">
                    {ELYOS_SERVERS.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="🌙 Asmodian">
                    {ASMODIAN_SERVERS.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
                <ChevronDown
                  className="absolute pointer-events-none"
                  style={{
                    right: "14px",
                    top: "12px",
                    color: "var(--text-tertiary)",
                  }}
                  size={14}
                />
              </div>
            </div>

            <div className="input-group">
              <label>Scan Limit (max 100)</label>
              <input
                type="number"
                min="1"
                max="100"
                value={forma.limit}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  setFormData({
                    ...forma,
                    limit: val > 0 ? Math.min(val, 100) : "",
                  });
                }}
                onBlur={(e) => {
                  const val = parseInt(e.target.value);
                  if (!(val > 0)) setFormData({ ...forma, limit: 10 });
                  else if (val > 100) setFormData({ ...forma, limit: 100 });
                }}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary mt-4"
            >
              {loading ? (
                <Loader2 className="animate-spin" size={18} />
              ) : (
                <Search size={18} />
              )}
              {loading ? "Scanning..." : "Analyze Builds"}
            </button>
            <p
              style={{
                fontSize: "0.65rem",
                color: "var(--text-tertiary)",
                textAlign: "center",
                marginTop: "4px",
              }}
            >
              Scanning may take a moment per player
            </p>
          </form>

          {error && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              style={{
                marginTop: "16px",
                padding: "12px 16px",
                borderRadius: "var(--radius-sm)",
                background: "rgba(239, 68, 68, 0.08)",
                border: "1px solid rgba(239, 68, 68, 0.2)",
                color: "#fca5a5",
                fontSize: "0.8rem",
              }}
            >
              {error}
            </motion.div>
          )}
        </motion.div>

        {/* ── Results Area ── */}
        <div className="flex-col gap-6" style={{ gridColumn: "span 2" }}>
          <AnimatePresence mode="wait">
            {/* Empty State */}
            {!data && !loading && (
              <motion.div
                key="empty"
                {...fadeUp}
                className="glass-panel flex-col items-center justify-center text-center"
                style={{ padding: "80px 40px", minHeight: "400px" }}
              >
                <div
                  style={{
                    width: "64px",
                    height: "64px",
                    borderRadius: "16px",
                    marginBottom: "20px",
                    background: "rgba(124, 58, 237, 0.06)",
                    border: "1px solid rgba(124, 58, 237, 0.12)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Swords size={28} style={{ color: "var(--text-tertiary)" }} />
                </div>
                <h3 style={{ color: "var(--text-secondary)", fontWeight: 600 }}>
                  Ready to Analyze
                </h3>
                <p
                  className="text-muted mt-2"
                  style={{ fontSize: "0.85rem", maxWidth: "300px" }}
                >
                  Configure your class and leaderboard, then hit analyze to
                  extract top builds.
                </p>
              </motion.div>
            )}

            {/* Loading State */}
            {loading && (
              <motion.div
                key="loading"
                {...fadeUp}
                className="glass-panel flex-col items-center justify-center"
                style={{ padding: "48px 32px" }}
              >
                {/* Spinner */}
                <div
                  style={{
                    position: "relative",
                    width: "72px",
                    height: "72px",
                    marginBottom: "24px",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      borderRadius: "50%",
                      border: "3px solid rgba(124, 58, 237, 0.1)",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      borderRadius: "50%",
                      border: "3px solid transparent",
                      borderTopColor: "#7c3aed",
                      animation: "spin 1s linear infinite",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      inset: "8px",
                      borderRadius: "50%",
                      border: "2px solid transparent",
                      borderBottomColor: "#a78bfa",
                      animation: "spin 1.5s linear infinite reverse",
                    }}
                  />
                </div>

                <h3 style={{ fontSize: "1.1rem" }}>Extracting Build Data</h3>
                <p
                  className="text-muted mt-2 text-center"
                  style={{ maxWidth: "340px", fontSize: "0.85rem" }}
                >
                  Analyzing player configurations...
                </p>

                {/* Progress */}
                <div
                  style={{
                    width: "100%",
                    maxWidth: "380px",
                    marginTop: "28px",
                  }}
                >
                  <div
                    className="flex justify-between"
                    style={{
                      fontSize: "0.75rem",
                      color: "var(--text-secondary)",
                      marginBottom: "8px",
                    }}
                  >
                    <span>
                      {progress.current} / {progress.total} scanned
                    </span>
                    <span style={{ color: "#a78bfa", fontWeight: 600 }}>
                      {percent(progress.current, Math.max(progress.total, 1))}%
                    </span>
                  </div>
                  <div
                    style={{
                      height: "6px",
                      width: "100%",
                      borderRadius: "3px",
                      background: "rgba(255,255,255,0.04)",
                      overflow: "hidden",
                    }}
                  >
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{
                        width: `${(progress.current / Math.max(progress.total, 1)) * 100}%`,
                      }}
                      transition={{ bounce: 0 }}
                      style={{
                        height: "100%",
                        borderRadius: "3px",
                        background: "linear-gradient(90deg, #7c3aed, #a78bfa)",
                        boxShadow: "0 0 12px rgba(124, 58, 237, 0.4)",
                      }}
                    />
                  </div>
                  {progress.target && (
                    <p
                      style={{
                        fontSize: "0.7rem",
                        textAlign: "center",
                        color: "#a78bfa",
                        marginTop: "8px",
                      }}
                    >
                      Found: {progress.target}
                    </p>
                  )}
                </div>

                {/* Log Viewer */}
                <div
                  style={{
                    width: "100%",
                    maxWidth: "480px",
                    marginTop: "28px",
                    background: "rgba(0,0,0,0.35)",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid rgba(255,255,255,0.04)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      padding: "10px 16px",
                      borderBottom: "1px solid rgba(255,255,255,0.04)",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        fontSize: "0.65rem",
                        fontWeight: 600,
                        color: "var(--text-tertiary)",
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                      }}
                    >
                      <Terminal size={12} style={{ color: "#a78bfa" }} />
                      Live Logs
                    </span>
                    <span
                      style={{
                        width: "6px",
                        height: "6px",
                        borderRadius: "50%",
                        background: "#7c3aed",
                        boxShadow: "0 0 8px rgba(124,58,237,0.6)",
                        animation: "pulse 2s infinite",
                      }}
                    />
                  </div>
                  <div
                    ref={logContainerRef}
                    className="custom-scrollbar-slim"
                    style={{
                      padding: "12px 16px",
                      height: "180px",
                      overflowY: "auto",
                      fontFamily:
                        "ui-monospace, SFMono-Regular, Menlo, monospace",
                      fontSize: "0.7rem",
                    }}
                  >
                    <div className="flex-col gap-2">
                      {logs.map((log, i) => {
                        const levelIcon =
                          {
                            SUCCESS: "✅",
                            INFO: "ℹ️",
                            WARN: "⚠️",
                            ERROR: "❌",
                          }[log.level] || "ℹ️";
                        const levelClass = `log-${(log.level || "INFO").toLowerCase()}`;
                        return (
                          <motion.div
                            key={i}
                            initial={{ opacity: 0, x: -6 }}
                            animate={{ opacity: 1, x: 0 }}
                            className={`log-entry ${levelClass}`}
                          >
                            <span className="log-icon">{levelIcon}</span>
                            <span className="log-time">{log.time}</span>
                            {log.context && (
                              <span className="log-context">
                                ({log.context})
                              </span>
                            )}
                            <span className="log-message">{log.text}</span>
                          </motion.div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Results */}
            {data && !loading && (
              <motion.div
                key="results"
                variants={stagger}
                initial="initial"
                animate="animate"
                className="flex-col gap-6"
              >
                {/* Scorecard */}
                <motion.div
                  variants={fadeUp}
                  className="glass-panel"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    background:
                      "linear-gradient(135deg, var(--bg-elevated), rgba(124,58,237,0.04))",
                    borderColor: "rgba(124,58,237,0.12)",
                  }}
                >
                  <div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        marginBottom: "4px",
                      }}
                    >
                      <h2 style={{ fontSize: "1.2rem" }}>Analysis Complete</h2>
                      <span
                        className="badge-success badge"
                        style={{ fontSize: "0.6rem" }}
                      >
                        Done
                      </span>
                    </div>
                    <p className="text-muted" style={{ fontSize: "0.85rem" }}>
                      <strong style={{ color: "#fff" }}>{data.count}</strong>{" "}
                      top <strong style={{ color: "#fff" }}>{data.cls}</strong>{" "}
                      players on{" "}
                      <strong style={{ color: "#fff" }}>{data.lb}</strong>
                    </p>
                  </div>
                  <CheckCircle2
                    size={40}
                    style={{ color: "var(--success)", opacity: 0.7 }}
                  />
                </motion.div>

                {/* Active + Passive Skills */}
                <div className="grid-cols-2">
                  <motion.div variants={fadeUp} className="glass-panel">
                    <h3 className="mb-4 flex items-center gap-2">
                      <span
                        style={{
                          width: "8px",
                          height: "8px",
                          borderRadius: "50%",
                          background: "#3b82f6",
                          boxShadow: "0 0 8px rgba(59,130,246,0.4)",
                        }}
                      />
                      Top Active Skills
                    </h3>
                    <div
                      className="flex-col gap-4 custom-scrollbar-slim"
                      style={{
                        maxHeight: "340px",
                        overflowY: "auto",
                        paddingRight: "8px",
                      }}
                    >
                      {Object.entries(data.stats.activeSkills)
                        .sort((a, b) => b[1].avgLv - a[1].avgLv)
                        .map(([name, stat], i) => (
                          <div
                            key={name}
                            className="flex-col"
                            style={{ gap: "4px" }}
                          >
                            <div
                              className="flex justify-between"
                              style={{ fontSize: "0.8rem" }}
                            >
                              <span
                                className="font-medium"
                                style={{ color: "var(--text-primary)" }}
                              >
                                <span
                                  style={{
                                    color: "var(--text-tertiary)",
                                    marginRight: "6px",
                                    fontSize: "0.7rem",
                                  }}
                                >
                                  {i + 1}.
                                </span>
                                {name}
                              </span>
                              <span
                                style={{
                                  color: "#60a5fa",
                                  fontWeight: 600,
                                  fontSize: "0.75rem",
                                }}
                              >
                                Lv {stat.avgLv}
                              </span>
                            </div>
                            <div className="progress-container">
                              <div
                                className="progress-bar"
                                style={{
                                  width: `${Math.min((stat.avgLv / 20) * 100, 100)}%`,
                                  background:
                                    "linear-gradient(90deg, #3b82f6, #60a5fa)",
                                  boxShadow: "0 0 8px rgba(59,130,246,0.3)",
                                }}
                              />
                            </div>
                          </div>
                        ))}
                    </div>
                  </motion.div>

                  <motion.div variants={fadeUp} className="glass-panel">
                    <h3 className="mb-4 flex items-center gap-2">
                      <span
                        style={{
                          width: "8px",
                          height: "8px",
                          borderRadius: "50%",
                          background: "#10b981",
                          boxShadow: "0 0 8px rgba(16,185,129,0.4)",
                        }}
                      />
                      Top Passive Skills
                    </h3>
                    <div
                      className="flex-col gap-4 custom-scrollbar-slim"
                      style={{
                        maxHeight: "340px",
                        overflowY: "auto",
                        paddingRight: "8px",
                      }}
                    >
                      {Object.entries(data.stats.passiveSkills)
                        .sort((a, b) => b[1].avgLv - a[1].avgLv)
                        .map(([name, stat], i) => (
                          <div
                            key={name}
                            className="flex-col"
                            style={{ gap: "4px" }}
                          >
                            <div
                              className="flex justify-between"
                              style={{ fontSize: "0.8rem" }}
                            >
                              <span
                                className="font-medium"
                                style={{ color: "var(--text-primary)" }}
                              >
                                <span
                                  style={{
                                    color: "var(--text-tertiary)",
                                    marginRight: "6px",
                                    fontSize: "0.7rem",
                                  }}
                                >
                                  {i + 1}.
                                </span>
                                {name}
                              </span>
                              <span
                                style={{
                                  color: "#34d399",
                                  fontWeight: 600,
                                  fontSize: "0.75rem",
                                }}
                              >
                                Lv {stat.avgLv}
                              </span>
                            </div>
                            <div className="progress-container">
                              <div
                                className="progress-bar"
                                style={{
                                  width: `${Math.min((stat.avgLv / 20) * 100, 100)}%`,
                                  background:
                                    "linear-gradient(90deg, #10b981, #34d399)",
                                  boxShadow: "0 0 8px rgba(16,185,129,0.3)",
                                }}
                              />
                            </div>
                          </div>
                        ))}
                    </div>
                  </motion.div>
                </div>

                {/* Stigma Overview — two-column layout */}
                <div className="grid-cols-2">
                  <motion.div variants={fadeUp} className="glass-panel">
                    <h3 className="mb-4 flex items-center gap-2">
                      <span
                        style={{
                          width: "8px",
                          height: "8px",
                          borderRadius: "50%",
                          background: "#06b6d4",
                          boxShadow: "0 0 8px rgba(6,182,212,0.4)",
                        }}
                      />
                      Stigma Priority
                    </h3>
                    <div
                      className="flex-col custom-scrollbar-slim"
                      style={{
                        gap: "2px",
                        maxHeight: "340px",
                        overflowY: "auto",
                        paddingRight: "8px",
                      }}
                    >
                      {Object.entries(data.stats.stigmaSkills)
                        .sort((a, b) => b[1].equippedCount - a[1].equippedCount)
                        .map(([name, stat], i) => {
                          const equipPct = percent(
                            stat.equippedCount,
                            data.count,
                          );
                          return (
                            <div
                              key={name}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "7px 10px",
                                borderRadius: "8px",
                                borderBottom: "1px solid var(--border-subtle)",
                                transition: "background 0.15s",
                              }}
                              className="hover:bg-white/5"
                            >
                              <div className="flex items-center gap-2">
                                <span
                                  style={{
                                    fontSize: "0.6rem",
                                    fontWeight: 700,
                                    color: "var(--text-tertiary)",
                                    width: "16px",
                                  }}
                                >
                                  {i + 1}
                                </span>
                                <span
                                  style={{
                                    fontSize: "0.8rem",
                                    fontWeight: 500,
                                  }}
                                >
                                  {name}
                                </span>
                              </div>
                              <div className="flex items-center gap-3">
                                <span
                                  style={{
                                    fontSize: "0.65rem",
                                    color: "var(--text-tertiary)",
                                  }}
                                >
                                  Lv {stat.avgLv}
                                </span>
                                <span
                                  style={{
                                    fontSize: "0.7rem",
                                    fontWeight: 700,
                                    color: "#22d3ee",
                                    minWidth: "36px",
                                    textAlign: "right",
                                  }}
                                >
                                  {equipPct}%
                                </span>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  </motion.div>

                  {Object.keys(data.stats.equippedStigmaCombos).length > 0 && (
                    <motion.div variants={fadeUp} className="glass-panel">
                      <h3 className="mb-4 flex items-center gap-2">
                        <Sparkles size={16} style={{ color: "#38bdf8" }} />
                        Top Stigma Combos
                      </h3>
                      <div
                        className="flex-col gap-3 custom-scrollbar-slim"
                        style={{ maxHeight: "340px", overflowY: "auto" }}
                      >
                        {Object.entries(data.stats.equippedStigmaCombos)
                          .sort((a, b) => b[1] - a[1])
                          .slice(0, 8)
                          .map(([combo, count], i) => {
                            const pct = percent(count, data.count);
                            return (
                              <div
                                key={combo}
                                style={{
                                  padding: "10px 12px",
                                  borderRadius: "var(--radius-sm)",
                                  background: "rgba(255,255,255,0.015)",
                                  border: "1px solid var(--border-subtle)",
                                }}
                              >
                                <div
                                  className="flex justify-between items-center"
                                  style={{ marginBottom: "8px" }}
                                >
                                  <span
                                    style={{
                                      fontSize: "0.65rem",
                                      fontWeight: 700,
                                      color: "#38bdf8",
                                    }}
                                  >
                                    #{i + 1}
                                  </span>
                                  <span
                                    style={{
                                      fontSize: "0.7rem",
                                      fontWeight: 700,
                                      color: "#fff",
                                    }}
                                  >
                                    {pct}%
                                    <span
                                      style={{
                                        fontSize: "0.55rem",
                                        color: "var(--text-tertiary)",
                                        marginLeft: "4px",
                                        fontWeight: 400,
                                      }}
                                    >
                                      ({count})
                                    </span>
                                  </span>
                                </div>
                                <div
                                  className="flex flex-wrap"
                                  style={{ gap: "4px" }}
                                >
                                  {combo.split(" + ").map((skill, idx) => (
                                    <span
                                      key={idx}
                                      style={{
                                        fontSize: "0.58rem",
                                        padding: "2px 7px",
                                        borderRadius: "5px",
                                        background: "rgba(56,189,248,0.08)",
                                        color: "#7dd3fc",
                                        border:
                                          "1px solid rgba(56,189,248,0.12)",
                                      }}
                                    >
                                      {skill}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </motion.div>
                  )}
                </div>

                {/* Arcana Combos */}
                {Object.keys(data.stats.arcanaSetCombos).length > 0 && (
                  <motion.div variants={fadeUp} className="glass-panel">
                    <h3 className="mb-4 flex items-center gap-2">
                      <Layers size={16} style={{ color: "#818cf8" }} />
                      Top Arcana Set Combos
                    </h3>
                    <div
                      className="flex-col gap-2 custom-scrollbar-slim"
                      style={{ maxHeight: "300px", overflowY: "auto" }}
                    >
                      {Object.entries(data.stats.arcanaSetCombos)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 10)
                        .map(([combo, count], i) => {
                          const pct = percent(count, data.count);
                          const sets = combo.split(" + ").map((s) => {
                            const match = s.match(/(.+)\((\d+)\)/);
                            if (match)
                              return { name: match[1], count: match[2] };
                            return { name: s, count: null };
                          });

                          const getArcanaColor = (name) => {
                            const n = name.toLowerCase();
                            if (n.includes("pure blood"))
                              return "arcana-pure-blood";
                            if (n.includes("primal vigor"))
                              return "arcana-primal-vigor";
                            if (n.includes("magic armor"))
                              return "arcana-magic-armor";
                            if (n.includes("frenzy")) return "arcana-frenzy";
                            return "arcana-none";
                          };

                          return (
                            <div
                              key={combo}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "10px",
                                padding: "10px 12px",
                                borderRadius: "var(--radius-sm)",
                                background: "rgba(255,255,255,0.015)",
                                border: "1px solid var(--border-subtle)",
                                transition: "border-color 0.2s",
                              }}
                            >
                              <span
                                style={{
                                  fontSize: "0.65rem",
                                  fontWeight: 800,
                                  color: "var(--text-tertiary)",
                                  flexShrink: 0,
                                  width: "20px",
                                }}
                              >
                                #{i + 1}
                              </span>
                              <div
                                className="flex flex-wrap gap-1.5 items-center"
                                style={{ flex: 1, minWidth: 0 }}
                              >
                                {sets.map((set, idx) => {
                                  const colorBase = getArcanaColor(set.name);
                                  return (
                                    <div
                                      key={idx}
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "5px",
                                        background: "rgba(0,0,0,0.25)",
                                        borderRadius: "6px",
                                        padding: "3px 8px",
                                        border:
                                          "1px solid var(--border-subtle)",
                                      }}
                                    >
                                      <div
                                        className={`bg-${colorBase}`}
                                        style={{
                                          width: "5px",
                                          height: "5px",
                                          borderRadius: "50%",
                                        }}
                                      />
                                      <span
                                        style={{
                                          fontSize: "0.7rem",
                                          fontWeight: 600,
                                        }}
                                      >
                                        {set.name}
                                      </span>
                                      {set.count && (
                                        <span
                                          className={`badge-${colorBase}`}
                                          style={{
                                            fontSize: "0.55rem",
                                            padding: "0px 5px",
                                            borderRadius: "4px",
                                            fontWeight: 800,
                                          }}
                                        >
                                          {set.count}
                                        </span>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                              <span
                                style={{
                                  fontSize: "0.85rem",
                                  fontWeight: 800,
                                  color: "#818cf8",
                                  flexShrink: 0,
                                  textAlign: "right",
                                  minWidth: "40px",
                                }}
                              >
                                {pct}%
                              </span>
                            </div>
                          );
                        })}
                    </div>
                  </motion.div>
                )}

                {/* Arcana Stats + Cards */}
                <div className="grid-cols-2">
                  {Object.keys(data.stats.arcanaMainStats).length > 0 && (
                    <motion.div variants={fadeUp} className="glass-panel">
                      <h3 className="mb-6 flex items-center gap-2">
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: "28px",
                            height: "28px",
                            borderRadius: "8px",
                            background: "rgba(245,158,11,0.08)",
                            border: "1px solid rgba(245,158,11,0.15)",
                          }}
                        >
                          <Shield size={14} style={{ color: "#f59e0b" }} />
                        </span>
                        Arcana Base Stats
                      </h3>
                      <div
                        className="flex-col gap-4 custom-scrollbar-slim"
                        style={{ maxHeight: "340px", overflowY: "auto" }}
                      >
                        {Object.entries(data.stats.arcanaMainStats)
                          .sort((a, b) => b[1] - a[1])
                          .slice(0, 15)
                          .map(([stat, count]) => {
                            const totalSlots = Object.values(
                              data.stats.arcanaMainStats,
                            ).reduce((sum, v) => sum + v, 0);
                            const activePct = percent(count, totalSlots);
                            return (
                              <div
                                key={stat}
                                className="flex-col"
                                style={{ gap: "6px" }}
                              >
                                <div
                                  className="flex justify-between items-center"
                                  style={{ fontSize: "0.75rem" }}
                                >
                                  <span className="font-medium">{stat}</span>
                                  <span
                                    style={{
                                      color: "#fbbf24",
                                      fontWeight: 700,
                                    }}
                                  >
                                    {activePct}%
                                  </span>
                                </div>
                                <div
                                  style={{
                                    height: "3px",
                                    width: "100%",
                                    borderRadius: "2px",
                                    background: "rgba(0,0,0,0.3)",
                                    overflow: "hidden",
                                  }}
                                >
                                  <motion.div
                                    initial={{ width: 0 }}
                                    animate={{ width: `${activePct}%` }}
                                    style={{
                                      height: "100%",
                                      borderRadius: "2px",
                                      background:
                                        "linear-gradient(90deg, #f59e0b, #fbbf24)",
                                      boxShadow: "0 0 8px rgba(245,158,11,0.3)",
                                    }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    </motion.div>
                  )}

                  {Object.keys(data.stats.arcanaUsage).length > 0 && (
                    <motion.div variants={fadeUp} className="glass-panel">
                      <h3 className="mb-6 flex items-center gap-2">
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: "28px",
                            height: "28px",
                            borderRadius: "8px",
                            background: "rgba(16,185,129,0.08)",
                            border: "1px solid rgba(16,185,129,0.15)",
                          }}
                        >
                          <Sparkles size={14} style={{ color: "#10b981" }} />
                        </span>
                        Top Arcana Cards
                      </h3>
                      <div
                        className="flex-col custom-scrollbar-slim"
                        style={{
                          gap: "2px",
                          maxHeight: "340px",
                          overflowY: "auto",
                        }}
                      >
                        {Object.entries(data.stats.arcanaUsage)
                          .sort((a, b) => b[1] - a[1])
                          .slice(0, 15)
                          .map(([card, count], i) => (
                            <div
                              key={card}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                padding: "8px 12px",
                                borderRadius: "8px",
                                borderBottom: "1px solid var(--border-subtle)",
                                transition: "background 0.15s",
                              }}
                              className="hover:bg-white/5"
                            >
                              <div className="flex items-center gap-3">
                                <span
                                  style={{
                                    fontSize: "0.6rem",
                                    fontWeight: 700,
                                    color: "var(--text-tertiary)",
                                    width: "16px",
                                  }}
                                >
                                  {i + 1}
                                </span>
                                <span
                                  style={{
                                    fontSize: "0.8rem",
                                    fontWeight: 500,
                                  }}
                                >
                                  {card}
                                </span>
                              </div>
                              <span
                                className="badge badge-success"
                                style={{ fontSize: "0.6rem" }}
                              >
                                {percent(count, data.count)}%
                              </span>
                            </div>
                          ))}
                      </div>
                    </motion.div>
                  )}
                </div>

                {/* Equipment Substats */}
                {Object.keys(data.stats.subStatsBySlot).length > 0 && (
                  <motion.div variants={fadeUp} className="glass-panel">
                    <h3 className="mb-4 flex items-center gap-2">
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: "28px",
                          height: "28px",
                          borderRadius: "8px",
                          background: "rgba(124,58,237,0.08)",
                          border: "1px solid rgba(124,58,237,0.15)",
                        }}
                      >
                        <Info size={14} style={{ color: "#a78bfa" }} />
                      </span>
                      Equipment Substats
                    </h3>

                    {/* Legend */}
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: "12px",
                        marginBottom: "20px",
                        padding: "10px 14px",
                        background: "rgba(0,0,0,0.15)",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border-subtle)",
                      }}
                    >
                      {[
                        { label: "Offense", color: "var(--stat-offense)" },
                        { label: "Defense", color: "var(--stat-defense)" },
                        { label: "Utility", color: "var(--stat-utility)" },
                        { label: "Skill Lv", color: "var(--stat-skill)" },
                        { label: "Deity", color: "var(--stat-deity)" },
                      ].map((cat) => (
                        <div
                          key={cat.label}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "5px",
                          }}
                        >
                          <span
                            style={{
                              width: "6px",
                              height: "6px",
                              borderRadius: "50%",
                              background: cat.color,
                              boxShadow: `0 0 6px ${cat.color}40`,
                            }}
                          />
                          <span
                            style={{
                              fontSize: "0.62rem",
                              fontWeight: 600,
                              color: "var(--text-secondary)",
                              letterSpacing: "0.02em",
                            }}
                          >
                            {cat.label}
                          </span>
                        </div>
                      ))}
                    </div>

                    {(() => {
                      const WEAPON_SLOTS = [
                        "Mace", // Cleric
                        "Spellbook", // Sorcerer
                        "Staff", // Chanter
                        "Greatsword", // Gladiator
                        "Longsword", // Templar
                        "Dagger", // Assassin
                        "Bow", // Ranger
                        "Orb", // Spiritmaster
                        "Guard", // Everyone
                        "MainHand",
                        "SubHand",
                      ];
                      const ARMOR_SLOTS = [
                        "Top",
                        "Legs",
                        "Helm",
                        "Pauldrons",
                        "Gloves",
                        "Shoes",
                        "Cloak",
                        "Belt",
                      ];
                      const ACCESSORY_SLOTS = [
                        "Earrings",
                        "Necklace",
                        "Amulet",
                        "Ring",
                        "Bracelet",
                        "Rune",
                      ];
                      const ARCANA_SLOTS = [
                        "Grail",
                        "Parchment",
                        "Compass",
                        "Bell",
                        "Mirror",
                        "Scales",
                        "Arcana",
                      ];

                      const allSlots = Object.entries(
                        data.stats.subStatsBySlot,
                      ).filter(([, stats]) => Object.keys(stats).length > 0);

                      const matchesGroup = (slot, slotList) =>
                        slotList.some(
                          (s) => slot === s || slot.startsWith(s + "("),
                        );
                      const groupSlots = (slotList) =>
                        allSlots.filter(([slot]) =>
                          matchesGroup(slot, slotList),
                        );
                      const allKnownSlots = [
                        ...WEAPON_SLOTS,
                        ...ARMOR_SLOTS,
                        ...ACCESSORY_SLOTS,
                        ...ARCANA_SLOTS,
                      ];
                      const remainingSlots = allSlots.filter(
                        ([slot]) => !matchesGroup(slot, allKnownSlots),
                      );

                      const groups = [
                        {
                          label: "Weapons & Guard",
                          icon: "⚔️",
                          slots: groupSlots(WEAPON_SLOTS),
                        },
                        {
                          label: "Armor",
                          icon: "🛡️",
                          slots: groupSlots(ARMOR_SLOTS),
                        },
                        {
                          label: "Accessories",
                          icon: "💍",
                          slots: groupSlots(ACCESSORY_SLOTS),
                        },
                        {
                          label: "Arcanas",
                          icon: "✨",
                          slots: [
                            ...groupSlots(ARCANA_SLOTS),
                            ...remainingSlots,
                          ],
                        },
                      ].filter((g) => g.slots.length > 0);

                      return groups.map((group) => (
                        <div key={group.label} style={{ marginBottom: "24px" }}>
                          <h4
                            style={{
                              fontSize: "0.8rem",
                              color: "var(--text-secondary)",
                              marginBottom: "12px",
                              fontWeight: 600,
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                            }}
                          >
                            <span>{group.icon}</span> {group.label}
                          </h4>
                          <div className="grid-cols-3">
                            {group.slots.map(([slot, stats], slotIdx) => {
                              const totalItems = Math.max(
                                ...Object.values(stats).map((s) => s.count),
                                1,
                              );

                              const classifyStatType = (name, values) => {
                                const topVal =
                                  values.length > 0 ? values[0] : "";
                                // Skill level upgrades: values are "+N"
                                if (String(topVal).startsWith("+"))
                                  return "skill";
                                // Deity stats: name contains [brackets]
                                if (/\[.+\]/.test(name)) return "deity";

                                const n = name.toLowerCase();
                                // Offense keywords
                                if (
                                  /\b(attack|damage|crit|might|precision|penetration|pierce|smite|hit|chance|boost|strike|additional|speed|accuracy|power|strength|intelligence|impact|perfect)\b/.test(
                                    n,
                                  )
                                )
                                  return "offense";
                                // Defense keywords
                                if (
                                  /\b(def|defense|resist|hp|block|parry|evasion|endurance|willpower|constitution|health|tolerance|heal|regeneration|suppression|vitality|dexterity|agility|back defense|defense increase)\b/.test(
                                    n,
                                  )
                                )
                                  return "defense";
                                // Utility keywords
                                if (
                                  /\b(mp|mana|cooldown|cast|move|regen)\b/.test(
                                    n,
                                  )
                                )
                                  return "utility";
                                return "base";
                              };

                              const TYPE_META = {
                                offense: { label: "Offense", order: 0 },
                                defense: { label: "Defense", order: 1 },
                                skill: { label: "Skill Levels", order: 2 },
                                deity: { label: "Deity", order: 3 },
                                utility: { label: "Utility", order: 4 },
                                base: { label: "Other", order: 5 },
                              };

                              // Classify all stats and group them
                              const classified = Object.entries(stats)
                                .map(([statName, statData]) => {
                                  const valCounts = {};
                                  for (const v of statData.values) {
                                    valCounts[v] = (valCounts[v] || 0) + 1;
                                  }
                                  const sortedVals = Object.entries(
                                    valCounts,
                                  ).sort((a, b) => b[1] - a[1]);
                                  const topVal = sortedVals[0];
                                  const pct =
                                    (statData.count / totalItems) * 100;
                                  const type = classifyStatType(
                                    statName,
                                    statData.values,
                                  );
                                  return {
                                    statName,
                                    statData,
                                    topVal,
                                    pct,
                                    type,
                                  };
                                })
                                .sort((a, b) => b.pct - a.pct);

                              // Count types for the header summary
                              const typeCounts = {};
                              for (const c of classified) {
                                typeCounts[c.type] =
                                  (typeCounts[c.type] || 0) + 1;
                              }

                              return (
                                <motion.div
                                  key={slot}
                                  initial={{ opacity: 0, y: 8 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={{ delay: slotIdx * 0.03 }}
                                  className="stat-card"
                                >
                                  <div className="stat-card-header">
                                    <span
                                      style={{
                                        fontSize: "0.7rem",
                                        fontWeight: 700,
                                        color: "#a78bfa",
                                        textTransform: "uppercase",
                                        letterSpacing: "0.05em",
                                      }}
                                    >
                                      {slot}
                                    </span>
                                    <div
                                      style={{ display: "flex", gap: "3px" }}
                                    >
                                      {Object.entries(typeCounts).map(
                                        ([type, count]) => (
                                          <span
                                            key={type}
                                            style={{
                                              width: "6px",
                                              height: "6px",
                                              borderRadius: "50%",
                                              background: `var(--stat-${type})`,
                                              opacity: 0.7,
                                            }}
                                            title={`${count} ${TYPE_META[type]?.label || type}`}
                                          />
                                        ),
                                      )}
                                    </div>
                                  </div>
                                  <div
                                    className="stat-card-content custom-scrollbar-slim"
                                    style={{
                                      maxHeight: "340px",
                                      overflowY: "auto",
                                    }}
                                  >
                                    {classified.map(
                                      ({ statName, topVal, pct, type }) => (
                                        <div key={statName}>
                                          <div className="substat-row">
                                            <span
                                              className="substat-type-dot"
                                              style={{
                                                background: `var(--stat-${type})`,
                                              }}
                                            />
                                            <div className="substat-info">
                                              <span
                                                className="substat-name"
                                                title={statName}
                                                style={{
                                                  whiteSpace: "normal",
                                                  lineHeight: "1.3",
                                                }}
                                              >
                                                {statName}
                                              </span>
                                              <span
                                                className="substat-peak"
                                                title="Most common value"
                                              >
                                                {topVal ? topVal[0] : "—"}
                                              </span>
                                            </div>
                                            <span
                                              className="substat-pct"
                                              style={{
                                                color: `var(--stat-${type})`,
                                              }}
                                            >
                                              {pct.toFixed(0)}%
                                            </span>
                                            <div className="substat-bar-bg">
                                              <motion.div
                                                initial={{ width: 0 }}
                                                animate={{ width: `${pct}%` }}
                                                transition={{
                                                  duration: 0.8,
                                                  ease: "easeOut",
                                                  delay: 0.15 + slotIdx * 0.03,
                                                }}
                                                className={`substat-bar bg-${type}`}
                                              />
                                            </div>
                                          </div>
                                        </div>
                                      ),
                                    )}
                                  </div>
                                </motion.div>
                              );
                            })}
                          </div>
                        </div>
                      ));
                    })()}
                  </motion.div>
                )}

                {/* Most Used Items by Slot */}
                {Object.keys(data.stats.itemsBySlot).length > 0 && (
                  <motion.div variants={fadeUp} className="glass-panel">
                    <h3 className="mb-4 flex items-center gap-2">
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: "28px",
                          height: "28px",
                          borderRadius: "8px",
                          background: "rgba(56,189,248,0.08)",
                          border: "1px solid rgba(56,189,248,0.15)",
                        }}
                      >
                        <Swords size={14} style={{ color: "#38bdf8" }} />
                      </span>
                      Most Used Items
                    </h3>

                    {(() => {
                      const WEAPON_SLOTS = [
                        "Mace", // Cleric
                        "Spellbook", // Sorcerer
                        "Staff", // Chanter
                        "Greatsword", // Gladiator
                        "Longsword", // Templar
                        "Dagger", // Assassin
                        "Bow", // Ranger
                        "Orb", // Spiritmaster
                        "Guard", // Everyone
                        "MainHand",
                        "SubHand",
                      ];
                      const ARMOR_SLOTS = [
                        "Top",
                        "Legs",
                        "Helm",
                        "Pauldrons",
                        "Gloves",
                        "Shoes",
                        "Cloak",
                        "Belt",
                      ];
                      const ACCESSORY_SLOTS = [
                        "Earrings",
                        "Necklace",
                        "Amulet",
                        "Ring",
                        "Bracelet",
                        "Rune",
                      ];
                      const ARCANA_SLOTS = [
                        "Grail",
                        "Parchment",
                        "Compass",
                        "Bell",
                        "Mirror",
                        "Scales",
                        "Arcana",
                      ];

                      const allSlots = Object.entries(
                        data.stats.itemsBySlot,
                      ).filter(([, items]) => Object.keys(items).length > 0);

                      const matchesGroup = (slot, slotList) =>
                        slotList.some(
                          (s) => slot === s || slot.startsWith(s + "("),
                        );
                      const groupSlots = (slotList) =>
                        allSlots.filter(([slot]) =>
                          matchesGroup(slot, slotList),
                        );
                      const allKnownSlots = [
                        ...WEAPON_SLOTS,
                        ...ARMOR_SLOTS,
                        ...ACCESSORY_SLOTS,
                        ...ARCANA_SLOTS,
                      ];
                      const remainingSlots = allSlots.filter(
                        ([slot]) => !matchesGroup(slot, allKnownSlots),
                      );

                      const groups = [
                        {
                          label: "Weapons & Guard",
                          icon: "⚔️",
                          slots: groupSlots(WEAPON_SLOTS),
                        },
                        {
                          label: "Armor",
                          icon: "🛡️",
                          slots: groupSlots(ARMOR_SLOTS),
                        },
                        {
                          label: "Accessories",
                          icon: "💍",
                          slots: groupSlots(ACCESSORY_SLOTS),
                        },
                        {
                          label: "Arcanas",
                          icon: "✨",
                          slots: [
                            ...groupSlots(ARCANA_SLOTS),
                            ...remainingSlots,
                          ],
                        },
                      ].filter((g) => g.slots.length > 0);

                      return groups.map((group) => (
                        <div key={group.label} style={{ marginBottom: "24px" }}>
                          <h4
                            style={{
                              fontSize: "0.8rem",
                              color: "var(--text-secondary)",
                              marginBottom: "12px",
                              fontWeight: 600,
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                            }}
                          >
                            <span>{group.icon}</span> {group.label}
                          </h4>
                          <div className="grid-cols-3">
                            {group.slots.map(([slot, items], slotIdx) => {
                              const sorted = Object.entries(items).sort(
                                (a, b) => b[1].count - a[1].count,
                              );
                              return (
                                <motion.div
                                  key={slot}
                                  initial={{ opacity: 0, y: 8 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={{ delay: slotIdx * 0.03 }}
                                  className="stat-card"
                                >
                                  <div className="stat-card-header">
                                    <span
                                      style={{
                                        fontSize: "0.7rem",
                                        fontWeight: 700,
                                        color: "#38bdf8",
                                        textTransform: "uppercase",
                                        letterSpacing: "0.05em",
                                      }}
                                    >
                                      {slot}
                                    </span>
                                  </div>
                                  <div
                                    className="stat-card-content custom-scrollbar-slim"
                                    style={{
                                      maxHeight: "340px",
                                      overflowY: "auto",
                                    }}
                                  >
                                    {sorted.map(
                                      ([itemName, { count, grade }], i) => {
                                        const pct = (
                                          (count / data.count) *
                                          100
                                        ).toFixed(0);
                                        const color = gradeColor(grade);
                                        return (
                                          <div key={itemName}>
                                            <div className="substat-row">
                                              <span
                                                className="substat-type-dot"
                                                style={{
                                                  background: color,
                                                  boxShadow: `0 0 6px ${color}66`,
                                                }}
                                              />
                                              <div className="substat-info">
                                                <span
                                                  className="substat-name"
                                                  title={itemName}
                                                  style={{
                                                    color,
                                                    whiteSpace: "normal",
                                                    lineHeight: "1.3",
                                                    fontSize: "0.78rem",
                                                  }}
                                                >
                                                  <span
                                                    style={{
                                                      color:
                                                        "var(--text-tertiary)",
                                                      marginRight: "6px",
                                                      fontSize: "0.65rem",
                                                    }}
                                                  >
                                                    {i + 1}.
                                                  </span>
                                                  {itemName}
                                                </span>
                                              </div>
                                              <span
                                                className="substat-pct"
                                                style={{ color }}
                                              >
                                                {pct}%
                                              </span>
                                              <div className="substat-bar-bg">
                                                <motion.div
                                                  initial={{ width: 0 }}
                                                  animate={{
                                                    width: `${pct}%`,
                                                  }}
                                                  transition={{
                                                    duration: 0.8,
                                                    ease: "easeOut",
                                                    delay:
                                                      0.15 + slotIdx * 0.03,
                                                  }}
                                                  className="substat-bar"
                                                  style={{
                                                    background: color,
                                                    boxShadow: `0 0 8px ${color}4d`,
                                                  }}
                                                />
                                              </div>
                                            </div>
                                          </div>
                                        );
                                      },
                                    )}
                                  </div>
                                </motion.div>
                              );
                            })}
                          </div>
                        </div>
                      ));
                    })()}
                  </motion.div>
                )}

                {/* Build Summary */}
                <motion.div
                  variants={fadeUp}
                  className="glass-panel"
                  style={{
                    background:
                      "linear-gradient(135deg, var(--bg-elevated), rgba(16,185,129,0.03))",
                    borderColor: "rgba(16,185,129,0.1)",
                  }}
                >
                  <h3 className="mb-4 flex items-center gap-2">
                    <Zap size={18} style={{ color: "#34d399" }} />
                    Quick Build Summary
                  </h3>
                  <div className="grid-cols-3" style={{ fontSize: "0.85rem" }}>
                    <div>
                      <h4
                        style={{
                          color: "#34d399",
                          marginBottom: "8px",
                          fontWeight: 600,
                          fontSize: "0.8rem",
                        }}
                      >
                        Core Active
                      </h4>
                      <ul
                        className="list-disc list-inside text-muted"
                        style={{ fontSize: "0.8rem" }}
                      >
                        {Object.entries(data.stats.activeSkills)
                          .filter(([, d]) => d.avgLv > 0)
                          .sort((a, b) => b[1].avgLv - a[1].avgLv)
                          .slice(0, 5)
                          .map(([n]) => (
                            <li key={n}>{n}</li>
                          ))}
                      </ul>
                    </div>
                    <div>
                      <h4
                        style={{
                          color: "#34d399",
                          marginBottom: "8px",
                          fontWeight: 600,
                          fontSize: "0.8rem",
                        }}
                      >
                        Core Passive
                      </h4>
                      <ul
                        className="list-disc list-inside text-muted"
                        style={{ fontSize: "0.8rem" }}
                      >
                        {Object.entries(data.stats.passiveSkills)
                          .filter(([, d]) => d.avgLv > 0)
                          .sort((a, b) => b[1].avgLv - a[1].avgLv)
                          .slice(0, 5)
                          .map(([n]) => (
                            <li key={n}>{n}</li>
                          ))}
                      </ul>
                    </div>
                    <div>
                      <h4
                        style={{
                          color: "#34d399",
                          marginBottom: "8px",
                          fontWeight: 600,
                          fontSize: "0.8rem",
                        }}
                      >
                        Must-Have Stigmas
                      </h4>
                      <ul
                        className="list-disc list-inside text-muted"
                        style={{ fontSize: "0.8rem" }}
                      >
                        {Object.entries(data.stats.stigmaSkills)
                          .filter(([, d]) => d.equippedCount > data.count / 2)
                          .sort((a, b) => b[1].avgLv - a[1].avgLv)
                          .slice(0, 5)
                          .map(([n]) => (
                            <li key={n}>{n}</li>
                          ))}
                      </ul>
                    </div>
                  </div>
                </motion.div>

                {/* Player Credits */}
                {data.stats.scannedPlayers &&
                  data.stats.scannedPlayers.length > 0 && (
                    <motion.div variants={fadeUp} className="glass-panel">
                      <h3 className="mb-4 flex items-center gap-2">
                        <Trophy size={18} style={{ color: "#fbbf24" }} />
                        Player Credits
                      </h3>
                      <p
                        className="text-muted mb-4"
                        style={{ fontSize: "0.8rem" }}
                      >
                        Built from data of these top-ranked heroes:
                      </p>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns:
                            "repeat(auto-fill, minmax(220px, 1fr))",
                          gap: "10px",
                          maxHeight: "340px",
                          overflowY: "auto",
                          paddingRight: "8px",
                        }}
                        className="custom-scrollbar-slim"
                      >
                        {[...data.stats.scannedPlayers]
                          .sort((a, b) => a.globalRank - b.globalRank)
                          .map((p, idx) => (
                            <div
                              key={idx}
                              style={{
                                background: "rgba(0,0,0,0.2)",
                                padding: "12px 14px",
                                borderRadius: "var(--radius-sm)",
                                border: "1px solid var(--border-subtle)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                              }}
                            >
                              <div className="flex-col">
                                <span
                                  style={{
                                    fontWeight: 600,
                                    fontSize: "0.85rem",
                                    color: "#e4e4e7",
                                  }}
                                >
                                  {p.name}
                                </span>
                                <div
                                  style={{
                                    fontSize: "0.65rem",
                                    color: "var(--text-secondary)",
                                    display: "flex",
                                    gap: "6px",
                                    alignItems: "center",
                                    flexWrap: "wrap",
                                    marginTop: "3px",
                                  }}
                                >
                                  <span>🌍 {p.region}</span>
                                  {p.serverName && (
                                    <span>🖥️ {p.serverName}</span>
                                  )}
                                  {p.race && p.race !== "Unknown" && (
                                    <span
                                      style={{
                                        padding: "1px 6px",
                                        borderRadius: "4px",
                                        fontSize: "0.55rem",
                                        textTransform: "uppercase",
                                        fontWeight: 700,
                                        background:
                                          p.race === "Elyos"
                                            ? "rgba(6,182,212,0.12)"
                                            : "rgba(244,63,94,0.12)",
                                        color:
                                          p.race === "Elyos"
                                            ? "#67e8f9"
                                            : "#fda4af",
                                        border: `1px solid ${p.race === "Elyos" ? "rgba(6,182,212,0.2)" : "rgba(244,63,94,0.2)"}`,
                                      }}
                                    >
                                      {p.race}
                                    </span>
                                  )}
                                  {p.faction && p.faction !== "Unknown" && (
                                    <span>⚔️ {p.faction}</span>
                                  )}
                                  {p.gearScore && (
                                    <span
                                      style={{
                                        padding: "1px 6px",
                                        borderRadius: "4px",
                                        fontSize: "0.55rem",
                                        fontWeight: 700,
                                        background: "rgba(251,191,36,0.12)",
                                        color: "#fbbf24",
                                        border:
                                          "1px solid rgba(251,191,36,0.2)",
                                      }}
                                    >
                                      GS {p.gearScore.toLocaleString()}
                                    </span>
                                  )}
                                  {p.combatPower && (
                                    <span
                                      style={{
                                        padding: "1px 6px",
                                        borderRadius: "4px",
                                        fontSize: "0.55rem",
                                        fontWeight: 700,
                                        background: "rgba(239,68,68,0.12)",
                                        color: "#ef4444",
                                        border: "1px solid rgba(239,68,68,0.2)",
                                      }}
                                    >
                                      CP {p.combatPower.toLocaleString()}
                                    </span>
                                  )}
                                </div>
                              </div>
                              <div
                                style={{
                                  fontSize: "1.2rem",
                                  fontWeight: 800,
                                  color: "rgba(255,255,255,0.07)",
                                }}
                              >
                                #{p.globalRank}
                              </div>
                            </div>
                          ))}
                      </div>
                    </motion.div>
                  )}

                {/* Log Viewer (persistent after analysis) */}
                {logs.length > 0 && (
                  <motion.div variants={fadeUp} className="glass-panel">
                    <div
                      style={{
                        background: "rgba(0,0,0,0.35)",
                        borderRadius: "var(--radius-md)",
                        border: "1px solid rgba(255,255,255,0.04)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          padding: "10px 16px",
                          borderBottom: "1px solid rgba(255,255,255,0.04)",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            fontSize: "0.65rem",
                            fontWeight: 600,
                            color: "var(--text-tertiary)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          <Terminal size={12} style={{ color: "#a78bfa" }} />
                          Analysis Logs
                        </span>
                        <span
                          style={{
                            fontSize: "0.6rem",
                            color: "var(--text-tertiary)",
                          }}
                        >
                          {logs.length} entries
                        </span>
                      </div>
                      <div
                        ref={resultsLogContainerRef}
                        className="custom-scrollbar-slim"
                        style={{
                          padding: "12px 16px",
                          height: "200px",
                          overflowY: "auto",
                          fontFamily:
                            "ui-monospace, SFMono-Regular, Menlo, monospace",
                          fontSize: "0.7rem",
                        }}
                      >
                        <div className="flex-col gap-2">
                          {logs.map((log, i) => {
                            const levelIcon =
                              {
                                SUCCESS: "\u2705",
                                INFO: "\u2139\ufe0f",
                                WARN: "\u26a0\ufe0f",
                                ERROR: "\u274c",
                              }[log.level] || "\u2139\ufe0f";
                            const levelClass = `log-${(log.level || "INFO").toLowerCase()}`;
                            return (
                              <div
                                key={i}
                                className={`log-entry ${levelClass}`}
                              >
                                <span className="log-icon">{levelIcon}</span>
                                <span className="log-time">{log.time}</span>
                                {log.context && (
                                  <span className="log-context">
                                    ({log.context})
                                  </span>
                                )}
                                <span className="log-message">{log.text}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </main>
  );
}
