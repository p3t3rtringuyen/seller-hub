// Feature flags: env-driven, server-side only (conventions §9). One file, one place to look.
// Add a flag here with its default; never read flags in browser code.

export interface Flags {
  /** Registers test-only handlers (for example `platform.test-echo`, BACKLOG S02). */
  enableTestHandlers: boolean;
}

export function readFlags(env: Record<string, string | undefined> = process.env): Flags {
  return {
    enableTestHandlers: env.SH_FLAG_TEST_HANDLERS === "1" || env.NODE_ENV === "test",
  };
}
