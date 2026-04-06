import { clearSessionCookie } from "@/lib/admin-auth";

export const runtime = "edge";

export async function POST() {
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": clearSessionCookie(),
    },
  });
}
