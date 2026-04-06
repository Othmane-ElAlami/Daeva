"use client";

import { useState } from "react";

export default function AdminLoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        window.location.href = "/admin";
      } else {
        const data = await res.json();
        setError(data.error || "Login failed");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.wrapper}>
      <form onSubmit={handleSubmit} style={styles.card}>
        <h1 style={styles.title}>Admin Login</h1>
        <p style={styles.subtitle}>Enter the admin secret to continue</p>

        {error && <div style={styles.errorBanner}>{error}</div>}

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Admin secret"
          style={styles.input}
          autoFocus
          required
        />

        <button type="submit" style={styles.submitBtn} disabled={loading || !password}>
          {loading ? "Authenticating…" : "Login"}
        </button>
      </form>
    </div>
  );
}

const styles = {
  wrapper: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "2rem",
  },
  card: {
    width: "100%",
    maxWidth: "380px",
    background: "var(--bg-elevated, #0a0f24)",
    border: "1px solid var(--border-default, rgba(255,255,255,0.05))",
    borderRadius: "12px",
    padding: "2rem",
    display: "flex",
    flexDirection: "column",
    gap: "1rem",
  },
  title: {
    fontSize: "1.5rem",
    fontWeight: 800,
    margin: 0,
    color: "var(--text-primary, #e2e8f0)",
    textAlign: "center",
  },
  subtitle: {
    fontSize: "0.8rem",
    color: "var(--text-secondary, #94a3b8)",
    margin: 0,
    textAlign: "center",
  },
  errorBanner: {
    background: "rgba(220, 38, 38, 0.15)",
    border: "1px solid rgba(220, 38, 38, 0.3)",
    borderRadius: "8px",
    padding: "0.6rem 0.75rem",
    color: "#fca5a5",
    fontSize: "0.8rem",
    textAlign: "center",
  },
  input: {
    padding: "0.65rem 0.75rem",
    borderRadius: "8px",
    border: "1px solid var(--border-default, rgba(255,255,255,0.05))",
    background: "var(--bg-primary, #050814)",
    color: "var(--text-primary, #e2e8f0)",
    fontSize: "0.9rem",
    outline: "none",
    width: "100%",
  },
  submitBtn: {
    padding: "0.65rem 1rem",
    borderRadius: "8px",
    border: "1px solid var(--accent, #b91c1c)",
    background: "var(--accent, #b91c1c)",
    color: "#fff",
    cursor: "pointer",
    fontSize: "0.875rem",
    fontWeight: 600,
    marginTop: "0.25rem",
  },
};
