import { getRequestContext } from "@cloudflare/next-on-pages";
import { discoveryConfig } from "@/lib/discovery-config";

export const runtime = "edge";
export async function GET() {
  return Response.json(discoveryConfig(getRequestContext().env), {
    headers: { "Cache-Control": "no-store" },
  });
}
