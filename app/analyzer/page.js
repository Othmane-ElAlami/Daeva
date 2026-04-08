"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Loader2,
  Info,
  ChevronDown,
  CheckCircle2,
  Filter,
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

// Client-side aggregate function for re-filtering builds
function clientAggregate(builds) {
  const total = builds.length;
  const stats = {
    total,
    activeSkills: {},
    stigmaSkills: {},
    passiveSkills: {},
    arcanaUsage: {},
    arcanaSets: {},
    arcanaSetCombos: {},
    arcanaMainStats: {},
    equippedStigmaCombos: {},
    subStatsBySlot: {},
    itemsBySlot: {},
    scannedPlayers: [],
  };
  for (const b of builds) {
    for (const s of b.activeSkills) {
      const e = (stats.activeSkills[s.name] ||= {
        totalLv: 0,
        count: 0,
        maxLv: 0,
        equippedCount: 0,
      });
      e.totalLv += s.level;
      e.count++;
      e.maxLv = Math.max(e.maxLv, s.level);
      if (s.equipped) e.equippedCount++;
    }
    for (const s of b.stigmaSkills) {
      const e = (stats.stigmaSkills[s.name] ||= {
        totalLv: 0,
        count: 0,
        maxLv: 0,
        equippedCount: 0,
      });
      e.totalLv += s.level;
      e.count++;
      e.maxLv = Math.max(e.maxLv, s.level);
      if (s.equipped) e.equippedCount++;
    }
    const topStigmas = [...b.stigmaSkills]
      .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name))
      .slice(0, 5)
      .map((s) => s.name)
      .sort();
    if (topStigmas.length > 0) {
      const combo = topStigmas.join(" + ");
      stats.equippedStigmaCombos[combo] = (stats.equippedStigmaCombos[combo] || 0) + 1;
    }
    for (const s of b.passiveSkills) {
      const e = (stats.passiveSkills[s.name] ||= {
        totalLv: 0,
        count: 0,
        maxLv: 0,
      });
      e.totalLv += s.level;
      e.count++;
      e.maxLv = Math.max(e.maxLv, s.level);
    }
    for (const a of b.arcanas) {
      stats.arcanaUsage[a.name] = (stats.arcanaUsage[a.name] || 0) + 1;
      if (a.mainStat)
        stats.arcanaMainStats[a.mainStat] = (stats.arcanaMainStats[a.mainStat] || 0) + 1;
    }
    for (const s of b.arcanaSets) {
      if (!stats.arcanaSets[s.name]) stats.arcanaSets[s.name] = { count: 0, bonuses: s.bonuses };
      stats.arcanaSets[s.name].count++;
    }
    if (b.arcanaSetCombo) {
      stats.arcanaSetCombos[b.arcanaSetCombo] = (stats.arcanaSetCombos[b.arcanaSetCombo] || 0) + 1;
    }
    for (const eq of b.equipSubStats) {
      const slotStats = (stats.subStatsBySlot[eq.categoryName] ||= {});
      for (const s of eq.subStats) {
        const entry = (slotStats[s.name] ||= { count: 0, values: [] });
        entry.count++;
        entry.values.push(s.value);
      }
    }
    for (const eq of b.equipItems || []) {
      const slotItems = (stats.itemsBySlot[eq.categoryName] ||= {});
      const existing = slotItems[eq.itemName];
      if (existing) {
        existing.count++;
      } else {
        slotItems[eq.itemName] = { count: 1, grade: eq.grade };
      }
    }
    stats.scannedPlayers.push({
      name: b.name,
      serverId: b.serverId,
      serverName: b.serverName,
      race: b.race,
      region: b.region,
      faction: b.faction,
      globalRank: b.globalRank,
      gearScore: b.gearScore,
      combatPower: b.combatPower,
    });
  }
  for (const map of [stats.activeSkills, stats.stigmaSkills, stats.passiveSkills]) {
    for (const d of Object.values(map)) {
      d.avgLv = +(d.totalLv / d.count).toFixed(1);
    }
  }
  return stats;
}

// Aion 2 item grade → color
//  API name  →  In-game name  →  Color
//  "Special" →  Special       →  Turquoise
//  "Epic"    →  Heroic        →  Dark orange
//  "Unique"  →  Unique        →  Golden yellow
//  "Legend"  →  Epic          →  Blue
//  "Rare"    →  Rare          →  Green
//  "Common"  →  Common        →  Grey

function gradeColor(grade) {
  const map = {
    special: "#2dd4bf", // Turquoise
    epic: "#c2410c", // Dark orange
    unique: "#eab308", // Golden yellow
    legend: "#3b82f6", // Blue
    rare: "#22c55e", // Green
    common: "#6b7280", // Grey
  };
  if (grade === null || grade === undefined) return "#e4e4e7";
  const key = typeof grade === "string" ? grade.toLowerCase() : String(grade);
  return map[key] ?? "#e4e4e7";
}

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [rawBuilds, setRawBuilds] = useState(null);
  const [raceFilter, setRaceFilter] = useState("all");
  const [runeFilter, setRuneFilter] = useState("all");
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
    race: "all",
  });

  const logContainerRef = useRef(null);
  const resultsLogContainerRef = useRef(null);

  // Derive race from a specific server ID
  const raceFromServer = (sid) => {
    if (!sid || sid === "all") return null;
    const num = parseInt(sid);
    if (num >= 2000) return "asmodians";
    if (num >= 1000) return "elyos";
    return null;
  };

  // Filtered server list based on selected race
  const filteredServers =
    forma.race === "elyos"
      ? { elyos: ELYOS_SERVERS, asmodian: [] }
      : forma.race === "asmodians"
        ? { elyos: [], asmodian: ASMODIAN_SERVERS }
        : { elyos: ELYOS_SERVERS, asmodian: ASMODIAN_SERVERS };

  // Handle race change — reset server if incompatible
  const handleRaceChange = (newRace) => {
    const currentServerRace = raceFromServer(forma.serverId);
    let newServerId = forma.serverId;
    if (newRace !== "all" && currentServerRace && currentServerRace !== newRace) {
      newServerId = "all";
    }
    setFormData({ ...forma, race: newRace, serverId: newServerId });
    setRaceFilter(newRace);
  };

  // Handle server change — auto-set race if specific server picked
  const handleServerChange = (newServerId) => {
    const serverRace = raceFromServer(newServerId);
    let newRace = forma.race;
    if (serverRace && forma.race === "all") {
      newRace = serverRace;
    }
    setFormData({ ...forma, serverId: newServerId, race: newRace });
    if (serverRace) setRaceFilter(serverRace);
  };

  const [mounted, setMounted] = useState(false);

  // Compute filtered/displayed data based on race and rune filters
  const displayData = useMemo(() => {
    if (!data) return null;
    if (!rawBuilds || (raceFilter === "all" && runeFilter === "all")) return data;

    let filtered = rawBuilds;

    if (raceFilter !== "all") {
      filtered = filtered.filter((b) =>
        raceFilter === "elyos" ? b.race === "Elyos" : b.race === "Asmo"
      );
    }

    if (runeFilter !== "all") {
      filtered = filtered.filter((b) => {
        const rune = (b.equipItems || []).find((e) => e.categoryName === "Rune");
        if (!rune) return false;
        const name = (rune.itemName || "").toLowerCase();
        if (runeFilter === "pve") return name.includes("clash");
        if (runeFilter === "pvp") return name.includes("devotion");
        return true;
      });
    }

    if (filtered.length === 0) {
      return { ...data, stats: clientAggregate([]), count: 0 };
    }

    return {
      ...data,
      stats: clientAggregate(filtered),
      count: filtered.length,
    };
  }, [data, rawBuilds, raceFilter, runeFilter]);

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
      resultsLogContainerRef.current.scrollTop = resultsLogContainerRef.current.scrollHeight;
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
    setRawBuilds(null);
    setLogs([]);
    setProgress({ current: 0, total: forma.limit, target: "" });

    try {
      let continuationData = null;
      let isDone = false;
      let cumulativeProcessed = 0;
      let allProcessedPlayers = [];

      while (!isDone) {
        const requestBody = continuationData
          ? { ...forma, runeFilter, continuation: continuationData }
          : { ...forma, runeFilter };

        const res = await fetch("/api/scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });

        if (res.status === 429) {
          const errData = await res.json();
          throw new Error(errData.error || "Rate limit exceeded. Please wait before trying again.");
        }
        if (!res.ok) {
          throw new Error("Failed to start analysis");
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let readerDone = false;
        let buffer = "";
        continuationData = null;

        while (!readerDone) {
          const { value, done: doneReading } = await reader.read();
          readerDone = doneReading;
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
                          ? new Date(event.timestamp).toLocaleTimeString("en-US", {
                              hour12: false,
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                              fractionalSecondDigits: 3,
                            })
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
                  } else if (event.type === "empty-leaderboard") {
                    const seasonLabel = event.season ? `Season ${event.season}` : "A new season";
                    const startLabel = event.seasonStart
                      ? ` on ${new Date(event.seasonStart).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                      : "";
                    throw new Error(
                      `${seasonLabel} just started${startLabel} — ${event.leaderboard} rankings aren't available yet. Try Abyss or check back soon.`
                    );
                  } else if (event.type === "done") {
                    setData({
                      stats: event.stats,
                      count: event.count,
                      cls: forma.cls,
                      lb: forma.lbType,
                    });
                    setRawBuilds(event.builds || null);
                    isDone = true;
                  } else if (event.type === "continue") {
                    cumulativeProcessed = event.processedCount;
                    allProcessedPlayers = event.processedPlayers || [];
                    continuationData = {
                      players: event.players,
                      processedCount: cumulativeProcessed,
                      processedPlayers: allProcessedPlayers,
                    };
                  } else if (event.type === "error") {
                    throw new Error(event.message);
                  }
                } catch (e) {
                  if (e.message && !e.message.includes("Unexpected end of JSON")) {
                    throw e;
                  }
                }
              }
            }
          }
        }

        // Stream ended — if no continuation and not done, something went wrong
        if (!continuationData && !isDone) {
          throw new Error("Analysis was interrupted. Please try again.");
        }
      }
    } catch (err) {
      // Never show raw infrastructure errors to the user
      const msg = err.message || "";
      const isInternal = /subrequest|worker invocation|cloudflare|wrangler|d1_error|sqlite/i.test(
        msg
      );
      setError(
        isInternal
          ? "The server is temporarily busy. Please try again with a smaller limit or wait a moment."
          : msg || "An unexpected error occurred. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  const percent = (count, total) => (total === 0 ? "0.0" : ((count / total) * 100).toFixed(1));

  return (
    <main className="container" style={{ paddingTop: "48px", paddingBottom: "64px" }}>
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
                background: "linear-gradient(135deg, rgba(124,58,237,0.15), rgba(124,58,237,0.05))",
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
                  onChange={(e) => setFormData({ ...forma, cls: e.target.value })}
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
                  onChange={(e) => setFormData({ ...forma, lbType: e.target.value })}
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
              <label>Race</label>
              <div className="relative">
                <select
                  value={forma.race}
                  onChange={(e) => handleRaceChange(e.target.value)}
                  className="appearance-none"
                >
                  <option value="all">All Races</option>
                  <option value="elyos">☀️ Elyos</option>
                  <option value="asmodians">🌙 Asmodians</option>
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
                  onChange={(e) => handleServerChange(e.target.value)}
                  className="appearance-none"
                >
                  <option value="all">All Servers</option>
                  {filteredServers.elyos.length > 0 && (
                    <optgroup label="☀️ Elyos">
                      {filteredServers.elyos.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {filteredServers.asmodian.length > 0 && (
                    <optgroup label="🌙 Asmodian">
                      {filteredServers.asmodian.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
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
              <label>Rune Type</label>
              <div className="relative">
                <select
                  value={runeFilter}
                  onChange={(e) => setRuneFilter(e.target.value)}
                  className="appearance-none"
                >
                  <option value="all">All Runes</option>
                  <option value="pve">⚔️ PvE (Clash Rune)</option>
                  <option value="pvp">🛡️ PvP (Devotion Rune)</option>
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

            <button type="submit" disabled={loading} className="btn-primary mt-4">
              {loading ? <Loader2 className="animate-spin" size={18} /> : <Search size={18} />}
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
            {!displayData && !loading && (
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
                <p className="text-muted mt-2" style={{ fontSize: "0.85rem", maxWidth: "300px" }}>
                  Configure your class and leaderboard, then hit analyze to extract top builds.
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
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
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
                            {log.context && <span className="log-context">{log.context}</span>}
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
            {displayData && !loading && (
              <motion.div
                key="results"
                variants={stagger}
                initial="initial"
                animate="animate"
                className="flex-col gap-6"
              >
                {/* Build Summary + Analysis Complete */}
                <motion.div
                  variants={fadeUp}
                  style={{
                    background: "var(--bg-elevated)",
                    border: "1px solid rgba(124,58,237,0.15)",
                    borderRadius: "var(--radius-lg)",
                    padding: "0",
                    overflow: "hidden",
                    boxShadow: "0 0 0 1px rgba(255,255,255,0.03), 0 8px 32px rgba(0,0,0,0.4)",
                    isolation: "isolate",
                    position: "relative",
                  }}
                >
                  {/* Header strip */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "18px 24px",
                      background:
                        "linear-gradient(90deg, rgba(124,58,237,0.08), rgba(52,211,153,0.05))",
                      borderBottom: "1px solid rgba(255,255,255,0.05)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                      }}
                    >
                      <div
                        style={{
                          width: "34px",
                          height: "34px",
                          borderRadius: "10px",
                          background:
                            "linear-gradient(135deg, rgba(124,58,237,0.3), rgba(52,211,153,0.2))",
                          border: "1px solid rgba(124,58,237,0.25)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <CheckCircle2 size={16} style={{ color: "#34d399" }} />
                      </div>
                      <div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                          }}
                        >
                          <span
                            style={{
                              fontSize: "1rem",
                              fontWeight: 700,
                              color: "var(--text-primary)",
                              letterSpacing: "-0.01em",
                            }}
                          >
                            Analysis Complete
                          </span>
                          <span
                            className="badge-success badge"
                            style={{
                              fontSize: "0.58rem",
                              letterSpacing: "0.04em",
                            }}
                          >
                            Done
                          </span>
                        </div>
                        <p
                          style={{
                            fontSize: "0.78rem",
                            color: "var(--text-muted, #6b7280)",
                            marginTop: "2px",
                          }}
                        >
                          <span
                            style={{
                              color: "rgba(255,255,255,0.75)",
                              fontWeight: 600,
                            }}
                          >
                            {displayData.count}
                          </span>
                          {" top "}
                          <span
                            style={{
                              color: "rgba(255,255,255,0.75)",
                              fontWeight: 600,
                            }}
                          >
                            {displayData.cls}
                          </span>
                          {" players · "}
                          <span
                            style={{
                              color: "rgba(255,255,255,0.75)",
                              fontWeight: 600,
                            }}
                          >
                            {displayData.lb}
                          </span>
                        </p>
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      <Zap size={13} style={{ color: "#a78bfa", opacity: 0.8 }} />
                      <span
                        style={{
                          fontSize: "0.72rem",
                          color: "#a78bfa",
                          fontWeight: 600,
                          letterSpacing: "0.05em",
                          textTransform: "uppercase",
                        }}
                      >
                        Quick Build
                      </span>
                    </div>
                  </div>

                  {/* Filter Status Bar */}
                  {(raceFilter !== "all" || runeFilter !== "all") && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "10px",
                        padding: "10px 24px",
                        background: "rgba(0,0,0,0.15)",
                        borderBottom: "1px solid rgba(255,255,255,0.05)",
                      }}
                    >
                      <Filter size={13} style={{ color: "var(--text-tertiary)" }} />
                      <span
                        style={{
                          fontSize: "0.65rem",
                          fontWeight: 600,
                          color: "var(--text-tertiary)",
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                        }}
                      >
                        Filtered
                      </span>
                      {raceFilter !== "all" && (
                        <span
                          style={{
                            fontSize: "0.6rem",
                            padding: "2px 8px",
                            borderRadius: "4px",
                            background:
                              raceFilter === "elyos"
                                ? "rgba(6,182,212,0.1)"
                                : "rgba(244,63,94,0.1)",
                            color: raceFilter === "elyos" ? "#67e8f9" : "#fda4af",
                            border: `1px solid ${raceFilter === "elyos" ? "rgba(6,182,212,0.2)" : "rgba(244,63,94,0.2)"}`,
                            fontWeight: 600,
                          }}
                        >
                          {raceFilter === "elyos" ? "☀️ Elyos" : "🌙 Asmodians"}
                        </span>
                      )}
                      {runeFilter !== "all" && (
                        <span
                          style={{
                            fontSize: "0.6rem",
                            padding: "2px 8px",
                            borderRadius: "4px",
                            background: "rgba(124,58,237,0.1)",
                            color: "#a78bfa",
                            border: "1px solid rgba(124,58,237,0.2)",
                            fontWeight: 600,
                          }}
                        >
                          {runeFilter === "pve" ? "⚔️ PvE (Clash)" : "🛡️ PvP (Devotion)"}
                        </span>
                      )}
                      <div
                        style={{
                          marginLeft: "auto",
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        <span
                          style={{
                            fontSize: "0.65rem",
                            color: "#a78bfa",
                            fontWeight: 600,
                          }}
                        >
                          {displayData.count} / {data.count} players
                        </span>
                        <button
                          onClick={() => {
                            setRaceFilter("all");
                            setRuneFilter("all");
                            setFormData({ ...forma, race: "all" });
                          }}
                          style={{
                            fontSize: "0.6rem",
                            padding: "2px 8px",
                            borderRadius: "4px",
                            background: "rgba(124,58,237,0.1)",
                            border: "1px solid rgba(124,58,237,0.2)",
                            color: "#a78bfa",
                            cursor: "pointer",
                            fontWeight: 600,
                          }}
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  )}

                  {/* No results after filtering */}
                  {displayData.count === 0 && (raceFilter !== "all" || runeFilter !== "all") && (
                    <div
                      style={{
                        padding: "32px 24px",
                        textAlign: "center",
                        color: "var(--text-secondary)",
                        fontSize: "0.85rem",
                      }}
                    >
                      No players match the current filters. Try adjusting Race or Rune filters.
                    </div>
                  )}

                  {/* Skill columns */}
                  <div className="grid-cols-3" style={{ gap: "0" }}>
                    {[
                      {
                        label: "Core Active",
                        color: "#60a5fa",
                        glow: "rgba(96,165,250,0.15)",
                        border: "rgba(96,165,250,0.12)",
                        tagBg: "rgba(96,165,250,0.07)",
                        tagBorder: "rgba(96,165,250,0.18)",
                        entries: Object.entries(displayData.stats.activeSkills)
                          .filter(([, d]) => d.avgLv > 0)
                          .sort((a, b) => b[1].avgLv - a[1].avgLv)
                          .slice(0, 5),
                      },
                      {
                        label: "Core Passive",
                        color: "#34d399",
                        glow: "rgba(52,211,153,0.15)",
                        border: "rgba(52,211,153,0.12)",
                        tagBg: "rgba(52,211,153,0.07)",
                        tagBorder: "rgba(52,211,153,0.18)",
                        entries: Object.entries(displayData.stats.passiveSkills)
                          .filter(([, d]) => d.avgLv > 0)
                          .sort((a, b) => b[1].avgLv - a[1].avgLv)
                          .slice(0, 5),
                      },
                      {
                        label: "Must-Have Stigmas",
                        color: "#c084fc",
                        glow: "rgba(192,132,252,0.15)",
                        border: "rgba(192,132,252,0.12)",
                        tagBg: "rgba(192,132,252,0.07)",
                        tagBorder: "rgba(192,132,252,0.18)",
                        entries: Object.entries(displayData.stats.stigmaSkills)
                          .filter(([, d]) => d.equippedCount > displayData.count / 2)
                          .sort((a, b) => b[1].avgLv - a[1].avgLv)
                          .slice(0, 5),
                      },
                    ].map((col, ci) => (
                      <div
                        key={ci}
                        style={{
                          padding: "20px 22px",
                          borderRight: ci < 2 ? "1px solid rgba(255,255,255,0.04)" : "none",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "7px",
                            marginBottom: "14px",
                          }}
                        >
                          <span
                            style={{
                              width: "6px",
                              height: "6px",
                              borderRadius: "50%",
                              background: col.color,
                              boxShadow: `0 0 6px ${col.glow}`,
                              flexShrink: 0,
                            }}
                          />
                          <span
                            style={{
                              fontSize: "0.72rem",
                              fontWeight: 700,
                              color: col.color,
                              letterSpacing: "0.06em",
                              textTransform: "uppercase",
                            }}
                          >
                            {col.label}
                          </span>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "6px",
                          }}
                        >
                          {col.entries.length > 0 ? (
                            col.entries.map(([n], i) => (
                              <div
                                key={n}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "8px",
                                  padding: "5px 10px",
                                  borderRadius: "6px",
                                  background: col.tagBg,
                                  border: `1px solid ${col.tagBorder}`,
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: "0.65rem",
                                    fontWeight: 700,
                                    color: col.color,
                                    opacity: 0.6,
                                    minWidth: "14px",
                                    fontVariantNumeric: "tabular-nums",
                                  }}
                                >
                                  {i + 1}
                                </span>
                                <span
                                  style={{
                                    fontSize: "0.78rem",
                                    color: "var(--text-primary)",
                                    fontWeight: 500,
                                    lineHeight: 1.3,
                                  }}
                                >
                                  {n}
                                </span>
                              </div>
                            ))
                          ) : (
                            <span
                              style={{
                                fontSize: "0.75rem",
                                color: "var(--text-muted, #6b7280)",
                              }}
                            >
                              —
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Log strip */}
                  {logs.length > 0 && (
                    <div
                      style={{
                        borderTop: "1px solid rgba(255,255,255,0.05)",
                      }}
                    >
                      <div
                        style={{
                          padding: "8px 22px",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          background: "rgba(0,0,0,0.2)",
                        }}
                      >
                        <span
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                            fontSize: "0.62rem",
                            fontWeight: 600,
                            color: "var(--text-tertiary)",
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                          }}
                        >
                          <Terminal size={11} style={{ color: "#a78bfa" }} />
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
                          padding: "10px 22px",
                          height: "180px",
                          overflowY: "auto",
                          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                          fontSize: "0.68rem",
                          background: "rgba(0,0,0,0.15)",
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
                              <div key={i} className={`log-entry ${levelClass}`}>
                                <span className="log-icon">{levelIcon}</span>
                                <span className="log-time">{log.time}</span>
                                {log.context && <span className="log-context">{log.context}</span>}
                                <span className="log-message">{log.text}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
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
                      {Object.entries(displayData.stats.activeSkills)
                        .sort((a, b) => b[1].avgLv - a[1].avgLv)
                        .map(([name, stat], i) => (
                          <div key={name} className="flex-col" style={{ gap: "4px" }}>
                            <div className="flex justify-between" style={{ fontSize: "0.8rem" }}>
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
                                  background: "linear-gradient(90deg, #3b82f6, #60a5fa)",
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
                      {Object.entries(displayData.stats.passiveSkills)
                        .sort((a, b) => b[1].avgLv - a[1].avgLv)
                        .map(([name, stat], i) => (
                          <div key={name} className="flex-col" style={{ gap: "4px" }}>
                            <div className="flex justify-between" style={{ fontSize: "0.8rem" }}>
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
                                  background: "linear-gradient(90deg, #10b981, #34d399)",
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
                      {Object.entries(displayData.stats.stigmaSkills)
                        .sort((a, b) => b[1].equippedCount - a[1].equippedCount)
                        .map(([name, stat], i) => {
                          const equipPct = percent(stat.equippedCount, displayData.count);
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
                                  className="badge"
                                  style={{
                                    fontSize: "0.6rem",
                                    background: "rgba(34,211,238,0.12)",
                                    color: "#22d3ee",
                                    border: "1px solid rgba(34,211,238,0.25)",
                                    flexShrink: 0,
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

                  {Object.keys(displayData.stats.equippedStigmaCombos).length > 0 && (
                    <motion.div variants={fadeUp} className="glass-panel">
                      <h3 className="mb-4 flex items-center gap-2">
                        <Sparkles size={16} style={{ color: "#38bdf8" }} />
                        Top Stigma Combos
                      </h3>
                      <div
                        className="flex-col gap-3 custom-scrollbar-slim"
                        style={{ maxHeight: "340px", overflowY: "auto" }}
                      >
                        {Object.entries(displayData.stats.equippedStigmaCombos)
                          .sort((a, b) => b[1] - a[1])
                          .slice(0, 8)
                          .map(([combo, count], i) => {
                            const pct = percent(count, displayData.count);
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
                                    className="badge"
                                    style={{
                                      fontSize: "0.6rem",
                                      background: "rgba(56,189,248,0.12)",
                                      color: "#38bdf8",
                                      border: "1px solid rgba(56,189,248,0.25)",
                                    }}
                                  >
                                    {pct}%
                                  </span>
                                </div>
                                <div className="flex flex-wrap" style={{ gap: "4px" }}>
                                  {combo.split(" + ").map((skill, idx) => (
                                    <span
                                      key={idx}
                                      style={{
                                        fontSize: "0.58rem",
                                        padding: "2px 7px",
                                        borderRadius: "5px",
                                        background: "rgba(56,189,248,0.08)",
                                        color: "#7dd3fc",
                                        border: "1px solid rgba(56,189,248,0.12)",
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
                {Object.keys(displayData.stats.arcanaSetCombos).length > 0 && (
                  <motion.div variants={fadeUp} className="glass-panel">
                    <h3 className="mb-4 flex items-center gap-2">
                      <Layers size={16} style={{ color: "#818cf8" }} />
                      Top Arcana Set Combos
                    </h3>
                    <div
                      className="flex-col gap-2 custom-scrollbar-slim"
                      style={{ maxHeight: "300px", overflowY: "auto" }}
                    >
                      {Object.entries(displayData.stats.arcanaSetCombos)
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 10)
                        .map(([combo, count], i) => {
                          const pct = percent(count, displayData.count);
                          const sets = combo.split(" + ").map((s) => {
                            const match = s.match(/(.+)\((\d+)\)/);
                            if (match) return { name: match[1], count: match[2] };
                            return { name: s, count: null };
                          });

                          const getArcanaColor = (name) => {
                            const n = name.toLowerCase();
                            if (n.includes("pure blood")) return "arcana-pure-blood";
                            if (n.includes("primal vigor")) return "arcana-primal-vigor";
                            if (n.includes("magic armor")) return "arcana-magic-armor";
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
                                        border: "1px solid var(--border-subtle)",
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
                                className="badge"
                                style={{
                                  fontSize: "0.6rem",
                                  background: "rgba(129,140,248,0.12)",
                                  color: "#818cf8",
                                  border: "1px solid rgba(129,140,248,0.25)",
                                  flexShrink: 0,
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
                  {Object.keys(displayData.stats.arcanaMainStats).length > 0 && (
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
                        {Object.entries(displayData.stats.arcanaMainStats)
                          .sort((a, b) => b[1] - a[1])
                          .slice(0, 15)
                          .map(([stat, count]) => {
                            const totalSlots = Object.values(
                              displayData.stats.arcanaMainStats
                            ).reduce((sum, v) => sum + v, 0);
                            const activePct = percent(count, totalSlots);
                            return (
                              <div key={stat} className="flex-col" style={{ gap: "6px" }}>
                                <div
                                  className="flex justify-between items-center"
                                  style={{ fontSize: "0.75rem" }}
                                >
                                  <span className="font-medium">{stat}</span>
                                  <span
                                    className="badge"
                                    style={{
                                      fontSize: "0.6rem",
                                      background: "rgba(245,158,11,0.12)",
                                      color: "#fbbf24",
                                      border: "1px solid rgba(245,158,11,0.25)",
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
                                      background: "linear-gradient(90deg, #f59e0b, #fbbf24)",
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

                  {Object.keys(displayData.stats.arcanaUsage).length > 0 && (
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
                        {Object.entries(displayData.stats.arcanaUsage)
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
                              <span className="badge badge-success" style={{ fontSize: "0.6rem" }}>
                                {percent(count, displayData.count)}%
                              </span>
                            </div>
                          ))}
                      </div>
                    </motion.div>
                  )}
                </div>

                {/* Most Used Theostones + Manastones */}
                <div className="grid-cols-2">
                  {displayData.stats.theostoneUsage &&
                    Object.keys(displayData.stats.theostoneUsage).length > 0 && (
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
                              background: "rgba(168,85,247,0.08)",
                              border: "1px solid rgba(168,85,247,0.15)",
                            }}
                          >
                            <Sparkles size={14} style={{ color: "#a855f7" }} />
                          </span>
                          Most Used Theostones
                        </h3>
                        <div
                          className="flex-col custom-scrollbar-slim"
                          style={{
                            gap: "2px",
                            maxHeight: "340px",
                            overflowY: "auto",
                          }}
                        >
                          {Object.entries(displayData.stats.theostoneUsage)
                            .sort((a, b) => b[1].count - a[1].count)
                            .slice(0, 15)
                            .map(([stone, data], i) => (
                              <div
                                key={stone}
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                  padding: "8px 12px",
                                  borderRadius: "8px",
                                  borderBottom: "1px solid var(--border-subtle)",
                                  transition: "background 0.15s",
                                  gap: "8px",
                                }}
                                className="hover:bg-white/5"
                              >
                                <div
                                  className="flex items-center gap-3"
                                  style={{ flex: 1, minWidth: 0 }}
                                >
                                  <span
                                    style={{
                                      fontSize: "0.6rem",
                                      fontWeight: 700,
                                      color: "var(--text-tertiary)",
                                      width: "16px",
                                      flexShrink: 0,
                                    }}
                                  >
                                    {i + 1}
                                  </span>
                                  <div style={{ minWidth: 0 }}>
                                    <span
                                      style={{
                                        fontSize: "0.8rem",
                                        fontWeight: 500,
                                        display: "block",
                                        color: gradeColor(data.grade),
                                      }}
                                    >
                                      {stone}
                                    </span>
                                    {data.desc && (
                                      <span
                                        style={{
                                          fontSize: "0.65rem",
                                          color: "var(--text-tertiary)",
                                          lineHeight: "1.3",
                                          display: "block",
                                          marginTop: "2px",
                                        }}
                                      >
                                        {data.desc.split("\n")[0]}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <span
                                  className="badge"
                                  style={{
                                    fontSize: "0.6rem",
                                    background: "rgba(168,85,247,0.12)",
                                    color: "#a855f7",
                                    border: "1px solid rgba(168,85,247,0.25)",
                                    flexShrink: 0,
                                  }}
                                >
                                  {percent(data.count, displayData.count)}%
                                </span>
                              </div>
                            ))}
                        </div>
                      </motion.div>
                    )}

                  {displayData.stats.manastoneUsage &&
                    Object.keys(displayData.stats.manastoneUsage).length > 0 && (
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
                              background: "rgba(56,189,248,0.08)",
                              border: "1px solid rgba(56,189,248,0.15)",
                            }}
                          >
                            <Zap size={14} style={{ color: "#38bdf8" }} />
                          </span>
                          Most Used Manastones
                        </h3>
                        <div
                          className="flex-col custom-scrollbar-slim"
                          style={{
                            gap: "2px",
                            maxHeight: "340px",
                            overflowY: "auto",
                          }}
                        >
                          {Object.entries(displayData.stats.manastoneUsage)
                            .sort((a, b) => b[1].count - a[1].count)
                            .slice(0, 15)
                            .map(([stone, data], i) => {
                              const color = gradeColor(data.grade);
                              return (
                                <div
                                  key={stone}
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
                                        color,
                                      }}
                                    >
                                      {stone}
                                      {data.maxValue && (
                                        <span
                                          style={{
                                            marginLeft: "6px",
                                            fontSize: "0.7rem",
                                            opacity: 0.85,
                                          }}
                                        >
                                          {data.maxValue}
                                        </span>
                                      )}
                                    </span>
                                  </div>
                                  <span
                                    className="badge"
                                    style={{
                                      fontSize: "0.6rem",
                                      background: "rgba(56,189,248,0.12)",
                                      color: "#38bdf8",
                                      border: "1px solid rgba(56,189,248,0.25)",
                                    }}
                                  >
                                    {percent(data.count, displayData.count)}%
                                  </span>
                                </div>
                              );
                            })}
                        </div>
                      </motion.div>
                    )}
                </div>

                {/* Equipment Substats */}
                {Object.keys(displayData.stats.subStatsBySlot).length > 0 && (
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
                      const WEAPON_SLOTS = ["Main Hand", "Guard"];
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

                      const allSlots = Object.entries(displayData.stats.subStatsBySlot).filter(
                        ([, stats]) => Object.keys(stats).length > 0
                      );

                      const matchesGroup = (slot, slotList) =>
                        slotList.some((s) => slot === s || slot.startsWith(s + "("));
                      const groupSlots = (slotList) =>
                        allSlots.filter(([slot]) => matchesGroup(slot, slotList));
                      const allKnownSlots = [
                        ...WEAPON_SLOTS,
                        ...ARMOR_SLOTS,
                        ...ACCESSORY_SLOTS,
                        ...ARCANA_SLOTS,
                      ];
                      const remainingSlots = allSlots.filter(
                        ([slot]) => !matchesGroup(slot, allKnownSlots)
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
                          slots: [...groupSlots(ARCANA_SLOTS), ...remainingSlots],
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
                                1
                              );

                              const classifyStatType = (name, values) => {
                                const topVal = values.length > 0 ? values[0] : "";
                                // Skill level upgrades: values are "+N"
                                if (String(topVal).startsWith("+")) return "skill";
                                // Deity stats: name contains [brackets]
                                if (/\[.+\]/.test(name)) return "deity";

                                const n = name.toLowerCase();
                                // Offense keywords
                                if (
                                  /\b(attack|damage|crit|might|precision|penetration|pierce|smite|hit|chance|boost|strike|additional|speed|accuracy|power|strength|intelligence|impact|perfect)\b/.test(
                                    n
                                  )
                                )
                                  return "offense";
                                // Defense keywords
                                if (
                                  /\b(def|defense|resist|hp|block|parry|evasion|endurance|willpower|constitution|health|tolerance|heal|regeneration|suppression|vitality|dexterity|agility|back defense|defense increase)\b/.test(
                                    n
                                  )
                                )
                                  return "defense";
                                // Utility keywords
                                if (/\b(mp|mana|cooldown|cast|move|regen)\b/.test(n))
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
                                  const sortedVals = Object.entries(valCounts).sort(
                                    (a, b) => b[1] - a[1]
                                  );
                                  const topVal = sortedVals[0];
                                  const maxVal = statData.values.reduce((best, v) => {
                                    const n = parseFloat(String(v).replace(/[^\d.]/g, "")) || 0;
                                    const m =
                                      parseFloat(String(best || "").replace(/[^\d.]/g, "")) || 0;
                                    return n > m ? v : best;
                                  }, statData.values[0] || "");
                                  const pct = (statData.count / totalItems) * 100;
                                  const type = classifyStatType(statName, statData.values);
                                  return {
                                    statName,
                                    statData,
                                    topVal,
                                    maxVal,
                                    pct,
                                    type,
                                  };
                                })
                                .sort((a, b) => b.pct - a.pct);

                              // Count types for the header summary
                              const typeCounts = {};
                              for (const c of classified) {
                                typeCounts[c.type] = (typeCounts[c.type] || 0) + 1;
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
                                    <div style={{ display: "flex", gap: "3px" }}>
                                      {Object.entries(typeCounts).map(([type, count]) => (
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
                                      ))}
                                    </div>
                                  </div>
                                  <div
                                    className="stat-card-content custom-scrollbar-slim"
                                    style={{
                                      maxHeight: "340px",
                                      overflowY: "auto",
                                    }}
                                  >
                                    {classified.map(({ statName, maxVal, pct, type }) => (
                                      <div
                                        key={statName}
                                        className="hover:bg-white/5"
                                        style={{
                                          padding: "5px 6px",
                                          borderRadius: "6px",
                                          transition: "background 0.15s ease",
                                        }}
                                      >
                                        {/* name row */}
                                        <div
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "7px",
                                          }}
                                        >
                                          <span
                                            style={{
                                              width: "5px",
                                              height: "5px",
                                              borderRadius: "50%",
                                              flexShrink: 0,
                                              background: `var(--stat-${type})`,
                                            }}
                                          />
                                          <span
                                            title={statName}
                                            style={{
                                              flex: 1,
                                              fontSize: "0.72rem",
                                              fontWeight: 500,
                                              color: "var(--text-primary)",
                                              whiteSpace: "normal",
                                              lineHeight: 1.3,
                                              minWidth: 0,
                                            }}
                                          >
                                            {statName}
                                          </span>
                                          {maxVal && (
                                            <span
                                              title="Highest value seen"
                                              style={{
                                                fontSize: "0.70rem",
                                                fontFamily: "ui-monospace, monospace",
                                                fontWeight: 700,
                                                color: `var(--stat-${type})`,
                                                opacity: 0.7,
                                                flexShrink: 0,
                                              }}
                                            >
                                              {maxVal}
                                            </span>
                                          )}
                                          <span
                                            className="badge"
                                            style={{
                                              fontSize: "0.6rem",
                                              background: `color-mix(in srgb, var(--stat-${type}) 12%, transparent)`,
                                              color: `var(--stat-${type})`,
                                              border: `1px solid color-mix(in srgb, var(--stat-${type}) 30%, transparent)`,
                                              flexShrink: 0,
                                            }}
                                          >
                                            {pct.toFixed(0)}%
                                          </span>
                                        </div>
                                        {/* always-visible progress bar */}
                                        <div
                                          style={{
                                            marginTop: "4px",
                                            marginLeft: "12px",
                                            height: "2px",
                                            background: "rgba(255,255,255,0.05)",
                                            borderRadius: "1px",
                                            overflow: "hidden",
                                          }}
                                        >
                                          <motion.div
                                            initial={{ width: 0 }}
                                            animate={{ width: `${pct}%` }}
                                            transition={{
                                              duration: 0.8,
                                              ease: "easeOut",
                                              delay: 0.15 + slotIdx * 0.03,
                                            }}
                                            style={{
                                              height: "100%",
                                              borderRadius: "1px",
                                              background: `var(--stat-${type})`,
                                              opacity: 0.55,
                                            }}
                                          />
                                        </div>
                                      </div>
                                    ))}
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
                {Object.keys(displayData.stats.itemsBySlot).length > 0 && (
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
                      const WEAPON_SLOTS = ["Main Hand", "Guard"];
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

                      const allSlots = Object.entries(displayData.stats.itemsBySlot).filter(
                        ([, items]) => Object.keys(items).length > 0
                      );

                      const matchesGroup = (slot, slotList) =>
                        slotList.some((s) => slot === s || slot.startsWith(s + "("));
                      const groupSlots = (slotList) =>
                        allSlots.filter(([slot]) => matchesGroup(slot, slotList));

                      const groups = [
                        {
                          label: "Main Hand & Guard",
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
                          slots: groupSlots(ARCANA_SLOTS),
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
                                (a, b) => b[1].count - a[1].count
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
                                    {sorted.map(([itemName, { count, grade, itemLevel }], i) => {
                                      const pct = ((count / displayData.count) * 100).toFixed(0);
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
                                                  fontSize: "0.72rem",
                                                }}
                                              >
                                                <span
                                                  style={{
                                                    color: "var(--text-tertiary)",
                                                    marginRight: "6px",
                                                    fontSize: "0.65rem",
                                                  }}
                                                >
                                                  {i + 1}.
                                                </span>
                                                {itemName}
                                              </span>
                                            </div>
                                            {itemLevel != null && (
                                              <span
                                                style={{
                                                  fontSize: "0.7rem",
                                                  fontFamily: "ui-monospace, monospace",
                                                  fontWeight: 700,
                                                  color,
                                                  opacity: 0.75,
                                                  flexShrink: 0,
                                                }}
                                              >
                                                {itemLevel}
                                              </span>
                                            )}
                                            <span
                                              className="badge"
                                              style={{
                                                fontSize: "0.6rem",
                                                background: `color-mix(in srgb, ${color} 12%, transparent)`,
                                                color,
                                                border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
                                                flexShrink: 0,
                                              }}
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
                                                  delay: 0.15 + slotIdx * 0.03,
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
                                    })}
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

                {/* Player Credits */}
                {displayData.stats.scannedPlayers &&
                  displayData.stats.scannedPlayers.length > 0 && (
                    <motion.div variants={fadeUp} className="glass-panel">
                      <h3 className="mb-4 flex items-center gap-2">
                        <Trophy size={18} style={{ color: "#fbbf24" }} />
                        Player Credits
                      </h3>
                      <p className="text-muted mb-4" style={{ fontSize: "0.8rem" }}>
                        Built from data of these top-ranked heroes:
                      </p>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                          gap: "10px",
                          maxHeight: "340px",
                          overflowY: "auto",
                          paddingRight: "8px",
                        }}
                        className="custom-scrollbar-slim"
                      >
                        {[...displayData.stats.scannedPlayers]
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
                                  {p.serverName && <span>🖥️ {p.serverName}</span>}
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
                                        color: p.race === "Elyos" ? "#67e8f9" : "#fda4af",
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
                                        border: "1px solid rgba(251,191,36,0.2)",
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
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </main>
  );
}
