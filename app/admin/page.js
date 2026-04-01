"use client";

import { useState, useEffect, useCallback } from "react";

export default function AdminPage() {
  const [tables, setTables] = useState([]);
  const [expandedTable, setExpandedTable] = useState(null);
  const [tableData, setTableData] = useState({});
  const [loading, setLoading] = useState(true);
  const [loadingTable, setLoadingTable] = useState(null);
  const [resetting, setResetting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState(null);

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

  useEffect(() => {
    fetchTables();
  }, [fetchTables]);

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

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>Admin Dashboard</h1>
          <p style={styles.subtitle}>Database Inspector & Management</p>
        </div>
        <div style={styles.headerActions}>
          <button onClick={fetchTables} style={styles.refreshBtn} disabled={loading}>
            {loading ? "Loading…" : "↻ Refresh"}
          </button>
          <button
            onClick={handleReset}
            style={confirmReset ? styles.resetBtnConfirm : styles.resetBtn}
            disabled={resetting}
          >
            {resetting
              ? "Resetting…"
              : confirmReset
                ? "⚠ Click again to confirm"
                : "Reset Database"}
          </button>
          {confirmReset && (
            <button onClick={() => setConfirmReset(false)} style={styles.cancelBtn}>
              Cancel
            </button>
          )}
        </div>
      </header>

      {error && (
        <div style={styles.errorBanner}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={styles.dismissBtn}>
            ✕
          </button>
        </div>
      )}

      {loading ? (
        <div style={styles.loadingState}>Loading tables…</div>
      ) : tables.length === 0 ? (
        <div style={styles.emptyState}>No tables found in the database.</div>
      ) : (
        <div style={styles.tableList}>
          {tables.map((table) => (
            <div key={table.name} style={styles.tableCard}>
              <button
                onClick={() => fetchTableData(table.name)}
                style={styles.tableHeader}
                disabled={loadingTable === table.name}
              >
                <div style={styles.tableInfo}>
                  <span style={styles.tableName}>{table.name}</span>
                  <span style={styles.tableMeta}>
                    {table.rowCount} row{table.rowCount !== 1 ? "s" : ""} · {table.columns.length}{" "}
                    column
                    {table.columns.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div style={styles.columnPills}>
                  {table.columns.map((col) => (
                    <span
                      key={col.name}
                      style={{
                        ...styles.pill,
                        ...(col.pk ? styles.pillPK : {}),
                      }}
                    >
                      {col.name}
                      <span style={styles.pillType}>{col.type || "ANY"}</span>
                    </span>
                  ))}
                </div>
                <span style={styles.chevron}>
                  {loadingTable === table.name ? "⏳" : expandedTable === table.name ? "▲" : "▼"}
                </span>
              </button>

              {expandedTable === table.name && tableData[table.name] && (
                <div style={styles.dataSection}>
                  {tableData[table.name].length === 0 ? (
                    <div style={styles.emptyTable}>Table is empty</div>
                  ) : (
                    <div style={styles.tableWrapper}>
                      <table style={styles.dataTable}>
                        <thead>
                          <tr>
                            {Object.keys(tableData[table.name][0]).map((col) => (
                              <th key={col} style={styles.th}>
                                {col}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {tableData[table.name].map((row, i) => (
                            <tr key={i} style={i % 2 === 0 ? styles.trEven : styles.trOdd}>
                              {Object.values(row).map((val, j) => (
                                <td key={j} style={styles.td}>
                                  {truncateValue(val)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {tableData[table.name].length >= 500 && (
                        <div style={styles.limitNote}>Showing first 500 rows</div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles = {
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
    marginBottom: "2rem",
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
    animation: "pulse 1s infinite",
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
    marginBottom: "1.5rem",
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
