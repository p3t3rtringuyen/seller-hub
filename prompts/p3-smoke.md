# P3-SMOKE — First contact with Amazon

Model: Haiku · checkout: main (P3 is merged and no P4 writer runs yet) · do not change code, do
not commit
OWNED_PATHS: `docs/reports/P3-SMOKE.md` only

## Goal

Prove the merged foundation talks to Amazon with the user's credentials (R5, R6), within the
limits of D30.

## Steps

1. `node scripts/check-env.mjs SPAPI_ ADS_` — all required names set. If not, stop: `BLOCKED`,
   list the missing names.
2. Run the gate command from CLAUDE.md "Commands".
3. `pnpm amazon:sandbox` (P3-CLIENTS): SP-API sandbox calls; Ads API profile list (or test
   account).
4. Only if D30 allows a real account: read-only calls — marketplace participations, one listings
   report request (do not wait more than 15 minutes for it), Ads profiles. **No writes.**
5. Run the demo sync definition (P3-INGEST) against the allowed account; count rows landed.

## Report

For each call: operation, region, HTTP status, latency, request id, row counts. **Redact**: no
tokens, no seller ids beyond the last 4 characters, no buyer data. Anything that failed: the
error code and the part of the stack it points to.

## Done when

Every step ran or is named as skipped with the reason. First line DONE only if steps 1–3 passed.
