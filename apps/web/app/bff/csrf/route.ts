import { csrfEndpoint } from "@/lib/bff-server";

export const dynamic = "force-dynamic";

// Makes sure the browser holds a csrf cookie before its first write (the sign-in form has no session yet).
export function GET(request: Request): Response {
  return csrfEndpoint(request);
}
