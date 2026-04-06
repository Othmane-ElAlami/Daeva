"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

// Known manifest tables — keep in sync with src/lib/migrations-manifest.js
const MANIFEST_TABLES = new Set([
  "player_cache",
  "rate_limits",
  "meta_snapshots",
  "admin_events",
  "login_attempts",
]);

// ─── Sparkline SVG chart (inline, no dependency) ───
function SparkBar({ data, width = 600, height = 120 }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.count), 1);
  const barW = Math.max(2, (width - data.length * 2) / data.length);
  const gap = 2;

  return (
    <svg width={width} height={height + 20} style={{ display: "block", margin: "0 auto" }}>
      {data.map((d, i) => {
        const barH = (d.count / max) * height;
        const x = i * (barW + gap);
        const y = height - barH;
        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={barH}
              rx={2}
              fill="var(--accent, #b91c1c)"
              opacity={0.8}
            />
            <title>{`${d.date}: ${d.count}`}</title>
            {i % 7 === 0 && (
              <text
                x={x + barW / 2}
                y={height + 14}
                textAnchor="middle"
                fill="var(--text-tertiary, #475569)"
                fontSize="8"
              >
                {d.date.slice(5)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState("analytics");
  const [tables, setTables] = useState([]);
  const [expandedTable, setExpandedTable] = useState(null);
  const [tableData, setTableData] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadingTable, setLoadingTable] = useState(null);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState(null);
  const [tableFilter, setTableFilter] = useState("");
  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  const handleLogout = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    window.location.href = "/admin/login";
  };

  const fetchTables = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/tables");
      if (!res.ok) throw new Error("Failed to fetch tables");
      const data = await res.json();
      setTables(data.tables || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const res = await fetch("/api/admin/analytics");
      if (!res.ok) throw new Error("Failed to fetch analytics");
      const data = await res.json();
      setAnalytics(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTables();
    fetchAnalytics();
  }, [fetchTables, fetchAnalytics]);

  const fetchTableData = async (tableName) => {
    if (expandedTable === tableName) {
      setExpandedTable(null);
      return;
    }
    setLoadingTable(tableName);
    try {
      const res = await fetch(`/api/admin/table-data?table=${encodeURIComponent(tableName)}`);
      if (!res.ok) throw new Error("Failed to fetch data");
      const data = await res.json();
      setTableData((prev) => ({ ...prev, [tableName]: data.rows }));
      setExpandedTable(tableName);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingTable(null);
    }
  };

  const handleReset = async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setResetting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/reset", { method: "POST" });
      if (!res.ok) throw new Error("Failed to reset database");
      setTableData({});
      setExpandedTable(null);
      setConfirmReset(false);
      await fetchTables();
      await fetchAnalytics();
    } catch (err) {
      setError(err.message);
    } finally {
      setResetting(false);
    }
  };

  const truncateValue = (val) => {
    if (val === null || val === undefined) return "NULL";
    const str = String(val);
    return str.length > 120 ? str.slice(0, 120) + "…" : str;
  };

  const filteredTables = useMemo(
    () => tables.filter((t) => t.name.toLowerCase().includes(tableFilter.toLowerCase())),
    [tables, tableFilter]
  );

  const formatTimestamp = (ts) => {
    if (!ts) return "—";
    return new Date(ts).toLocaleString();
  };

  // ─── RENDER ───
  return (
    <div style={s.container}>
      {/* Header */}
      <header style={s.header}>
        <div>
          <h1 style={s.title}>Admin Dashboard</h1>
          <p style={s.subtitle}>Database Inspector & Management</p>
        </div>
        <div style={s.headerActions}>
          <button onClick={handleLogout} style={s.logoutBtn}>
            Logout
          </button>
          <button
            onClick={() => {
              fetchTables();
              fetchAnalytics();
            }}
            style={s.refreshBtn}
            disabled={loading}
          >
            {loading ? "Loading…" : "↻ Refresh"}
          </button>
          <button
            onClick={handleReset}
            style={confirmReset ? s.resetBtnConfirm : s.resetBtn}
            disabled={resetting}
          >
            {resetting
              ? "Resetting…"
              : confirmReset
                ? "⚠ Click again to confirm"
                : "Reset Database"}
          </button>
          {confirmReset && (
            <button onClick={() => setConfirmReset(false)} style={s.cancelBtn}>
              Cancel
            </button>
          )}
        </div>
      </header>

      {error && (
        <div style={s.errorBanner}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={s.dismissBtn}>
            ✕
          </button>
        </div>
      )}

      {/* Tabs */}
      <div style={s.tabBar}>
        {["analytics", "tables"].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={activeTab === tab ? s.tabActive : s.tab}
          >
            {tab === "analytics" ? "Analytics" : "Table Browser"}
          </button>
        ))}
      </div>

      {/* ═══════ ANALYTICS TAB ═══════ */}
      {activeTab === "analytics" && (
        <div style={s.tabContent}>
          {analyticsLoading && !analytics ? (
            <div style={s.loadingState}>Loading analytics…</div>
          ) : analytics ? (
            <>
              {/* Summary Cards */}
              <div style={s.statGrid}>
                <StatCard label="Total Tables" value={analytics.totalTables ?? 0} />
                <StatCard label="Total Rows" value={analytics.totalRows ?? 0} />
                <StatCard label="Scrapes Today" value={analytics.scrapeActivity?.last24h ?? 0} />
                <StatCard label="Rate Limit IPs" value={analytics.rateLimits?.total ?? 0} />
              </div>

              {/* Scrape Activity Chart */}
              {analytics.scrapeActivity?.daily && (
                <div style={s.section}>
                  <h3 style={s.sectionTitle}>Scrape Activity — Last 30 Days</h3>
                  <div style={s.card}>
                    <div style={s.chartRow}>
                      <span style={s.chartLabel}>
                        24h: {analytics.scrapeActivity.last24h} · 7d:{" "}
                        {analytics.scrapeActivity.last7d} · 30d: {analytics.scrapeActivity.last30d}
                      </span>
                    </div>
                    <SparkBar data={analytics.scrapeActivity.daily} />
                  </div>
                </div>
              )}

              {/* Meta Snapshots */}
              {analytics.metaSnapshots?.count != null && (
                <div style={s.section}>
                  <h3 style={s.sectionTitle}>Meta Snapshots</h3>
                  <div style={s.card}>
                    <span style={s.metaLine}>
                      <strong>{analytics.metaSnapshots.count}</strong> snapshot
                      {analytics.metaSnapshots.count !== 1 ? "s" : ""}
                      {analytics.metaSnapshots.latestUpdate && (
                        <>
                          {" "}
                          · Latest: <em>{formatTimestamp(analytics.metaSnapshots.latestUpdate)}</em>
                        </>
                      )}
                    </span>
                  </div>
                </div>
              )}

              {/* Data Health */}
              <div style={s.section}>
                <h3 style={s.sectionTitle}>Data Health</h3>
                <div style={s.card}>
                  <HealthRow
                    status={analytics.dataHealth?.healthy ? "green" : "yellow"}
                    label="Overall Schema"
                    detail={
                      analytics.dataHealth?.healthy
                        ? "All expected tables present"
                        : "Issues detected"
                    }
                  />
                  {analytics.dataHealth?.missingFromDB?.length > 0 && (
                    <HealthRow
                      status="red"
                      label="Missing Tables"
                      detail={analytics.dataHealth.missingFromDB.join(", ")}
                    />
                  )}
                  {analytics.dataHealth?.unexpectedInDB?.length > 0 && (
                    <HealthRow
                      status="yellow"
                      label="Unexpected Tables"
                      detail={analytics.dataHealth.unexpectedInDB.join(", ")}
                    />
                  )}
                  {analytics.dataHealth?.emptyExpected?.length > 0 && (
                    <HealthRow
                      status="yellow"
                      label="Empty Expected Tables"
                      detail={analytics.dataHealth.emptyExpected.join(", ")}
                    />
                  )}
                  {analytics.dataHealth?.healthy &&
                    !analytics.dataHealth?.emptyExpected?.length && (
                      <HealthRow status="green" label="All Tables" detail="Populated" />
                    )}
                </div>
              </div>

              {/* Last Reset */}
              {analytics.lastReset && (
                <div style={s.section}>
                  <h3 style={s.sectionTitle}>Last Reset</h3>
                  <div style={s.card}>
                    <span style={s.metaLine}>{formatTimestamp(analytics.lastReset.createdAt)}</span>
                    {analytics.lastReset.metadata && (
                      <div style={{ marginTop: "0.5rem", fontSize: "0.75rem" }}>
                        <span>
                          Reset: {analytics.lastReset.metadata.reset?.length ?? 0} · Created:{" "}
                          {analytics.lastReset.metadata.created?.length ?? 0} · Skipped:{" "}
                          {analytics.lastReset.metadata.skipped?.length ?? 0} · Errors:{" "}
                          {analytics.lastReset.metadata.errors?.length ?? 0}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Event Log */}
              {analytics.adminEvents?.length > 0 && (
                <div style={s.section}>
                  <h3 style={s.sectionTitle}>Event Log (last 20)</h3>
                  <div style={s.tableWrapper}>
                    <table style={s.dataTable}>
                      <thead>
                        <tr>
                          <th style={s.th}>Type</th>
                          <th style={s.th}>Timestamp</th>
                          <th style={s.th}>Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {analytics.adminEvents.map((ev, i) => (
                          <tr key={ev.id || i} style={i % 2 === 0 ? s.trEven : s.trOdd}>
                            <td style={s.td}>{ev.event_type}</td>
                            <td style={s.td}>{formatTimestamp(ev.created_at)}</td>
                            <td style={s.td}>{truncateValue(ev.metadata)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={s.emptyState}>No analytics data available.</div>
          )}
        </div>
      )}

      {/* ═══════ TABLE BROWSER TAB ═══════ */}
      {activeTab === "tables" && (
        <div style={s.tabContent}>
          {/* Search / Filter */}
          <div style={{ marginBottom: "1rem" }}>
            <input
              type="text"
              placeholder="Filter tables by name…"
              value={tableFilter}
              onChange={(e) => setTableFilter(e.target.value)}
              style={s.filterInput}
            />
          </div>

          {loading ? (
            <div style={s.loadingState}>Loading tables…</div>
          ) : filteredTables.length === 0 ? (
            <div style={s.emptyState}>
              {tableFilter ? "No tables match your filter." : "No tables found in the database."}
            </div>
          ) : (
            <div style={s.tableList}>
              {filteredTables.map((table) => {
                const inManifest = MANIFEST_TABLES.has(table.name);
                return (
                  <div key={table.name} style={s.tableCard}>
                    <button
                      onClick={() => fetchTableData(table.name)}
                      style={s.tableHeader}
                      disabled={loadingTable === table.name}
                    >
                      <div style={s.tableInfo}>
                        <span style={s.tableName}>
                          {table.name}{" "}
                          <span style={inManifest ? s.badgeOk : s.badgeUnknown}>
                            {inManifest ? "manifest" : "unknown"}
                          </span>
                        </span>
                        <span style={s.tableMeta}>
                          {table.rowCount} row{table.rowCount !== 1 ? "s" : ""} ·{" "}
                          {table.columns.length} column
                          {table.columns.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                      <div style={s.columnPills}>
                        {table.columns.map((col) => (
                          <span
                            key={col.name}
                            style={{
                              ...s.pill,
                              ...(col.pk ? s.pillPK : {}),
                            }}
                          >
                            {col.name}
                            <span style={s.pillType}>{col.type || "ANY"}</span>
                          </span>
                        ))}
                      </div>
                      <span style={s.chevron}>
                        {loadingTable === table.name
                          ? "⏳"
                          : expandedTable === table.name
                            ? "▲"
                            : "▼"}
                      </span>
                    </button>

                    {expandedTable === table.name && tableData[table.name] && (
                      <div style={s.dataSection}>
                        {tableData[table.name].length === 0 ? (
                          <div style={s.emptyTable}>Table is empty</div>
                        ) : (
                          <div style={s.tableWrapper}>
                            <table style={s.dataTable}>
                              <thead>
                                <tr>
                                  {Object.keys(tableData[table.name][0]).map((col) => (
                                    <th key={col} style={s.th}>
                                      {col}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {tableData[table.name].map((row, i) => (
                                  <tr key={i} style={i % 2 === 0 ? s.trEven : s.trOdd}>
                                    {Object.values(row).map((val, j) => (
                                      <td key={j} style={s.td}>
                                        {truncateValue(val)}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {tableData[table.name].length >= 500 && (
                              <div style={s.limitNote}>Showing first 500 rows</div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Small sub-components ───

function StatCard({ label, value }) {
  return (
    <div style={s.statCard}>
      <span style={s.statValue}>{value}</span>
      <span style={s.statLabel}>{label}</span>
    </div>
  );
}

function HealthRow({ status, label, detail }) {
  const colors = { green: "#10b981", yellow: "#f59e0b", red: "#ef4444" };
  return (
    <div style={s.healthRow}>
      <span style={{ ...s.healthDot, background: colors[status] || colors.yellow }} />
      <span style={s.healthLabel}>{label}</span>
      <span style={s.healthDetail}>{detail}</span>
    </div>
  );
}

// ─── Styles ───

const s = {
  container: {
    minHeight: "100vh",
    padding: "2rem",
    maxWidth: "1400px",
    margin: "0 auto",
    color: "var(--text-primary, #e2e8f0)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: "1.25rem",
    flexWrap: "wrap",
    gap: "1rem",
  },
  title: {
    fontSize: "1.75rem",
    fontWeight: 800,
    margin: 0,
    color: "var(--text-primary, #e2e8f0)",
  },
  subtitle: {
    fontSize: "0.875rem",
    color: "var(--text-secondary, #94a3b8)",
    margin: "0.25rem 0 0 0",
  },
  headerActions: {
    display: "flex",
    gap: "0.5rem",
    alignItems: "center",
    flexWrap: "wrap",
  },
  logoutBtn: {
    padding: "0.5rem 1rem",
    borderRadius: "8px",
    border: "1px solid var(--border-default, rgba(255,255,255,0.05))",
    background: "transparent",
    color: "var(--text-secondary, #94a3b8)",
    cursor: "pointer",
    fontSize: "0.8rem",
    fontWeight: 500,
  },
  refreshBtn: {
    padding: "0.5rem 1rem",
    borderRadius: "8px",
    border: "1px solid var(--border-default, rgba(255,255,255,0.05))",
    background: "var(--bg-elevated, #0a0f24)",
    color: "var(--text-primary, #e2e8f0)",
    cursor: "pointer",
    fontSize: "0.875rem",
    fontWeight: 500,
  },
  resetBtn: {
    padding: "0.5rem 1rem",
    borderRadius: "8px",
    border: "1px solid rgba(220, 38, 38, 0.4)",
    background: "rgba(220, 38, 38, 0.1)",
    color: "#fca5a5",
    cursor: "pointer",
    fontSize: "0.875rem",
    fontWeight: 600,
  },
  resetBtnConfirm: {
    padding: "0.5rem 1rem",
    borderRadius: "8px",
    border: "1px solid #dc2626",
    background: "#dc2626",
    color: "#fff",
    cursor: "pointer",
    fontSize: "0.875rem",
    fontWeight: 700,
  },
  cancelBtn: {
    padding: "0.5rem 0.75rem",
    borderRadius: "8px",
    border: "1px solid var(--border-default, rgba(255,255,255,0.05))",
    background: "transparent",
    color: "var(--text-secondary, #94a3b8)",
    cursor: "pointer",
    fontSize: "0.8rem",
  },
  errorBanner: {
    background: "rgba(220, 38, 38, 0.15)",
    border: "1px solid rgba(220, 38, 38, 0.3)",
    borderRadius: "8px",
    padding: "0.75rem 1rem",
    marginBottom: "1rem",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    color: "#fca5a5",
    fontSize: "0.875rem",
  },
  dismissBtn: {
    background: "none",
    border: "none",
    color: "#fca5a5",
    cursor: "pointer",
    fontSize: "1rem",
    padding: "0 0.25rem",
  },

  // ─── Tabs ───
  tabBar: {
    display: "flex",
    gap: "0.25rem",
    marginBottom: "1.5rem",
    borderBottom: "1px solid var(--border-default, rgba(255,255,255,0.05))",
    paddingBottom: "0",
  },
  tab: {
    padding: "0.6rem 1.25rem",
    background: "transparent",
    border: "none",
    borderBottom: "2px solid transparent",
    color: "var(--text-secondary, #94a3b8)",
    cursor: "pointer",
    fontSize: "0.85rem",
    fontWeight: 500,
  },
  tabActive: {
    padding: "0.6rem 1.25rem",
    background: "transparent",
    border: "none",
    borderBottom: "2px solid var(--accent, #b91c1c)",
    color: "var(--text-primary, #e2e8f0)",
    cursor: "pointer",
    fontSize: "0.85rem",
    fontWeight: 600,
  },
  tabContent: {},

  // ─── Analytics ───
  statGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: "0.75rem",
    marginBottom: "1.5rem",
  },
  statCard: {
    background: "var(--bg-elevated, #0a0f24)",
    border: "1px solid var(--border-default, rgba(255,255,255,0.05))",
    borderRadius: "10px",
    padding: "1rem 1.25rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.25rem",
  },
  statValue: {
    fontSize: "1.5rem",
    fontWeight: 800,
    color: "var(--text-primary, #e2e8f0)",
  },
  statLabel: {
    fontSize: "0.7rem",
    fontWeight: 500,
    color: "var(--text-secondary, #94a3b8)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  section: {
    marginBottom: "1.5rem",
  },
  sectionTitle: {
    fontSize: "0.85rem",
    fontWeight: 700,
    color: "var(--text-primary, #e2e8f0)",
    marginBottom: "0.5rem",
  },
  card: {
    background: "var(--bg-elevated, #0a0f24)",
    border: "1px solid var(--border-default, rgba(255,255,255,0.05))",
    borderRadius: "10px",
    padding: "1rem 1.25rem",
  },
  chartRow: {
    marginBottom: "0.75rem",
    fontSize: "0.75rem",
    color: "var(--text-secondary, #94a3b8)",
  },
  chartLabel: {},
  metaLine: {
    fontSize: "0.8rem",
    color: "var(--text-secondary, #94a3b8)",
  },

  // ─── Health ───
  healthRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.35rem 0",
    fontSize: "0.8rem",
  },
  healthDot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    flexShrink: 0,
  },
  healthLabel: {
    fontWeight: 600,
    color: "var(--text-primary, #e2e8f0)",
    minWidth: "140px",
  },
  healthDetail: {
    color: "var(--text-secondary, #94a3b8)",
  },

  // ─── Filter ───
  filterInput: {
    padding: "0.55rem 0.75rem",
    borderRadius: "8px",
    border: "1px solid var(--border-default, rgba(255,255,255,0.05))",
    background: "var(--bg-elevated, #0a0f24)",
    color: "var(--text-primary, #e2e8f0)",
    fontSize: "0.85rem",
    outline: "none",
    width: "100%",
    maxWidth: "360px",
  },

  // ─── Badges ───
  badgeOk: {
    display: "inline-block",
    fontSize: "0.55rem",
    fontWeight: 600,
    padding: "0.1rem 0.35rem",
    borderRadius: "4px",
    background: "rgba(16,185,129,0.15)",
    color: "#10b981",
    border: "1px solid rgba(16,185,129,0.3)",
    verticalAlign: "middle",
    marginLeft: "0.35rem",
    textTransform: "uppercase",
  },
  badgeUnknown: {
    display: "inline-block",
    fontSize: "0.55rem",
    fontWeight: 600,
    padding: "0.1rem 0.35rem",
    borderRadius: "4px",
    background: "rgba(245,158,11,0.15)",
    color: "#f59e0b",
    border: "1px solid rgba(245,158,11,0.3)",
    verticalAlign: "middle",
    marginLeft: "0.35rem",
    textTransform: "uppercase",
  },

  // ─── Shared table styles ───
  loadingState: {
    textAlign: "center",
    padding: "4rem 0",
    color: "var(--text-secondary, #94a3b8)",
    fontSize: "1rem",
  },
  emptyState: {
    textAlign: "center",
    padding: "4rem 0",
    color: "var(--text-tertiary, #475569)",
    fontSize: "1rem",
  },
  tableList: {
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
  },
  tableCard: {
    border: "1px solid var(--border-default, rgba(255,255,255,0.05))",
    borderRadius: "12px",
    overflow: "hidden",
    background: "var(--bg-elevated, #0a0f24)",
  },
  tableHeader: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: "1rem",
    padding: "1rem 1.25rem",
    background: "transparent",
    border: "none",
    cursor: "pointer",
    color: "var(--text-primary, #e2e8f0)",
    textAlign: "left",
  },
  tableInfo: {
    display: "flex",
    flexDirection: "column",
    minWidth: "140px",
  },
  tableName: {
    fontSize: "1rem",
    fontWeight: 700,
  },
  tableMeta: {
    fontSize: "0.75rem",
    color: "var(--text-secondary, #94a3b8)",
    marginTop: "2px",
  },
  columnPills: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.375rem",
    flex: 1,
  },
  pill: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.3rem",
    padding: "0.2rem 0.5rem",
    borderRadius: "6px",
    fontSize: "0.7rem",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.06)",
    color: "var(--text-secondary, #94a3b8)",
  },
  pillPK: {
    background: "rgba(185, 28, 28, 0.15)",
    borderColor: "rgba(185, 28, 28, 0.3)",
    color: "#fca5a5",
  },
  pillType: {
    fontSize: "0.6rem",
    color: "var(--text-tertiary, #475569)",
    textTransform: "uppercase",
  },
  chevron: {
    fontSize: "0.75rem",
    color: "var(--text-tertiary, #475569)",
    marginLeft: "auto",
    flexShrink: 0,
  },
  dataSection: {
    borderTop: "1px solid var(--border-default, rgba(255,255,255,0.05))",
  },
  emptyTable: {
    padding: "2rem",
    textAlign: "center",
    color: "var(--text-tertiary, #475569)",
    fontSize: "0.875rem",
  },
  tableWrapper: {
    overflowX: "auto",
  },
  dataTable: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "0.8rem",
  },
  th: {
    padding: "0.6rem 0.75rem",
    textAlign: "left",
    fontWeight: 600,
    fontSize: "0.7rem",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--text-secondary, #94a3b8)",
    background: "rgba(255,255,255,0.02)",
    borderBottom: "1px solid var(--border-default, rgba(255,255,255,0.05))",
    whiteSpace: "nowrap",
  },
  td: {
    padding: "0.5rem 0.75rem",
    borderBottom: "1px solid rgba(255,255,255,0.02)",
    color: "var(--text-primary, #e2e8f0)",
    maxWidth: "300px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  trEven: {
    background: "transparent",
  },
  trOdd: {
    background: "rgba(255,255,255,0.015)",
  },
  limitNote: {
    padding: "0.5rem 1rem",
    textAlign: "center",
    fontSize: "0.75rem",
    color: "var(--text-tertiary, #475569)",
    borderTop: "1px solid var(--border-default, rgba(255,255,255,0.05))",
  },
};
