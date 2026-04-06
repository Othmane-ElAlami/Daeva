/**
 * Admin authentication guard for API routes and pages.
 * Validates requests against ADMIN_SECRET via Bearer token or session cookie.
 */

const SESSION_COOKIE_NAME = "admin_session";

/**
 * Validate an admin API request.
 * Checks Authorization header (Bearer token) or session cookie.
 * @returns {{ authorized: boolean }} result
 */
export async function validateAdminRequest(request, env = {}) {
  // Resolution order:
  // 1. Cloudflare Secrets Store binding (env.ADMIN_SECRETS.get("ADMIN_SECRET"))
  // 2. Direct env binding / wrangler.toml [vars] / .dev.vars (env.ADMIN_SECRET)
  // 3. process.env fallback for local `next dev` with .env.local
  let secret;
  if (env.ADMIN_SECRETS) {
    secret = await env.ADMIN_SECRETS.get("ADMIN_SECRET");
  } else {
    secret = env.ADMIN_SECRET || process.env.ADMIN_SECRET;
  }
  if (!secret) return { authorized: false };

  // Check Authorization: Bearer <secret>
  const authHeader = request.headers.get("Authorization");
  if (authHeader) {
    const parts = authHeader.split(" ");
    if (parts.length === 2 && parts[0] === "Bearer" && timingSafeEqual(parts[1], secret)) {
      return { authorized: true };
    }
  }

  // Check session cookie
  const cookie = parseCookies(request.headers.get("Cookie") || "");
  const sessionValue = cookie[SESSION_COOKIE_NAME];
  if (sessionValue && timingSafeEqual(sessionValue, secret)) {
    return { authorized: true };
  }

  return { authorized: false };
}

/**
 * Check if a request is from an authenticated admin (for page-level guards).
 * @returns {boolean}
 */
export async function isAdminAuthenticated(request, env) {
  return (await validateAdminRequest(request, env)).authorized;
}

/**
 * Create a Set-Cookie header for admin session (24h expiry, HttpOnly, Secure, SameSite=Strict).
 */
export function createSessionCookie(secret) {
  const maxAge = 24 * 60 * 60; // 24 hours
  return `${SESSION_COOKIE_NAME}=${secret}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

/**
 * Create a Set-Cookie header that clears the admin session.
 */
export function clearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

/**
 * Return a 401 JSON response.
 */
export function unauthorizedResponse() {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Parse a Cookie header string into an object.
 */
function parseCookies(cookieStr) {
  const cookies = {};
  if (!cookieStr) return cookies;
  for (const pair of cookieStr.split(";")) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    cookies[key] = val;
  }
  return cookies;
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
