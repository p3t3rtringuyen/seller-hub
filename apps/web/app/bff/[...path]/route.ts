import { forward } from "@/lib/bff-server";

// The BFF is the only browser-facing API surface (ADR-0003). It forwards to apps/api with the session cookie turned into
// a bearer header, enforces the CSRF rules for writes, and issues/clears the httpOnly session cookie. No business logic
// and no database access belong here. See lib/bff-security.ts and lib/bff-server.ts.

export const dynamic = "force-dynamic";

export const GET = forward;
export const HEAD = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
