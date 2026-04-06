import { NextResponse } from "next/server";

const SESSION_COOKIE_NAME = "admin_session";

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};

export function middleware(request) {
  const { pathname } = request.nextUrl;

  // Allow login page and login/logout API routes without auth
  if (
    pathname === "/admin/login" ||
    pathname === "/api/admin/login" ||
    pathname === "/api/admin/logout"
  ) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const authHeader = request.headers.get("Authorization");
  const hasBearer = authHeader && authHeader.startsWith("Bearer ");

  // For /api/admin/* routes, return 401 if no auth
  if (pathname.startsWith("/api/admin")) {
    if (!sessionCookie && !hasBearer) {
      return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    // Let the actual route handler do full validation
    return NextResponse.next();
  }

  // For /admin/* pages, redirect to login if no session cookie
  if (!sessionCookie) {
    const loginUrl = new URL("/admin/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}
