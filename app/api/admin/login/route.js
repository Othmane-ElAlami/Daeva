import { getRequestContext } from "@cloudflare/next-on-pages";
import { createSessionCookie } from "@/lib/admin-auth";

export const runtime = "edge";

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export async function POST(request) {
  const { env } = getRequestContext();
  const secret = env.ADMIN_SECRET;

  if (!secret) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Rate limiting by IP
  const ip =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown";

  const db = env.DB;
  try {
    // Ensure login_attempts table exists
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS login_attempts (
          ip TEXT PRIMARY KEY,
          attempts INTEGER NOT NULL DEFAULT 0,
          first_attempt_at INTEGER NOT NULL
        )`
      )
      .run();

    const row = await db
      .prepare("SELECT attempts, first_attempt_at FROM login_attempts WHERE ip = ?")
      .bind(ip)
      .first();

    if (row) {
      const windowExpired = Date.now() - row.first_attempt_at > WINDOW_MS;
      if (!windowExpired && row.attempts >= MAX_ATTEMPTS) {
        return new Response(
          JSON.stringify({ error: "Too many login attempts. Try again later." }),
          {
            status: 429,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
      if (windowExpired) {
        // Reset window
        await db
          .prepare(
            "INSERT OR REPLACE INTO login_attempts (ip, attempts, first_attempt_at) VALUES (?, 1, ?)"
          )
          .bind(ip, Date.now())
          .run();
      } else {
        await db
          .prepare("UPDATE login_attempts SET attempts = attempts + 1 WHERE ip = ?")
          .bind(ip)
          .run();
      }
    } else {
      await db
        .prepare("INSERT INTO login_attempts (ip, attempts, first_attempt_at) VALUES (?, 1, ?)")
        .bind(ip, Date.now())
        .run();
    }
  } catch {
    // If DB rate limiting fails, continue — don't block login entirely
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { password } = body;
  if (!password || typeof password !== "string") {
    return new Response(JSON.stringify({ error: "Password required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Constant-time compare
  if (!timingSafeEqual(password, secret)) {
    return new Response(JSON.stringify({ error: "Invalid password" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Clear rate limit on success
  try {
    await db.prepare("DELETE FROM login_attempts WHERE ip = ?").bind(ip).run();
  } catch {
    // non-critical
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": createSessionCookie(secret),
    },
  });
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
