# STATUS

Owned by the orchestrator. Other sessions read only. Update before ending every turn.

- **Phase:** P0 — waiting for Gate 0
- **Updated:** 2026-10-14
- **Waiting on user:** D0–D6, D8, D9 (docs/DECISIONS.md), R1, R3, R11

## Running

| Task | Session name | local id | Model | Checkout / branch | Ports / compose project | Started |
| --- | --- | --- | --- | --- | --- | --- |

## Done

| Task | Verified how | Merged / committed | Report |
| --- | --- | --- | --- |

## Blocked / waiting

| Task | Waiting on | Since |
| --- | --- | --- |

## Next runnable

- P0 bootstrap (orchestrator) → P1-SPAPI, P1-ADS, P1-WEB, P1-API, P1-REF, P1-CONSOLE in parallel.

## Log

- 2026-10-14 — kit created.
- 2026-10-14 — R4 done: `refs/amazon-ads` mirrored (223 specs incl. 18 Ads MCP tool groups, 807
  docs pages, 0 failures). Added P1-CONSOLE (Amazon Ads console as feature reference, D51), the
  ads-api → Amazon call map in P1-API (D52), the MCP doc in P1-ADS (D50), D53 (v0 vs v1).
- 2026-10-14 — User decided D50 = c, D53 = v1 (v0 only as named exceptions). Prompts P1-ADS,
  P1-API, P2-ARCH updated.
- 2026-10-14 — Kit committed on `main` and pushed to `origin` (D7). P0 steps 1–2 are done; P0
  still runs `fetch-refs.ps1` (refs/amazon is not fetched yet) and the legacy-path check.
