# P1-SCOPE — Scope synthesis

Model: Opus · checkout: main · do not commit
OWNED_PATHS: `docs/SCOPE.md`, `docs/reports/P1-SCOPE.md`; you may append new OPEN questions to the
"Phát sinh trong lúc làm" section of `docs/DECISIONS.md`.

## Goal

One document the user can decide the MVP from in thirty minutes.

## Inputs

All of `docs/discovery/*`, `catalog/**`, `docs/DECISIONS.md` (D0–D9), and the P1 reports in
`docs/reports/`.

## `docs/SCOPE.md` — write it in Vietnamese (the user reads it); keep IDs and API names in English

1. **Tóm tắt** — ≤15 lines: what seller-hub covers, how it relates to ads-web, the biggest risks.
2. **Ma trận tính năng** — one row per feature:
   `ID | Domain | Tính năng | Nguồn (legacy-web / legacy-api / SP-API / Ads / idea) | APIs / reports |
   Role / restricted | Độ lớn (S/M/L/XL) | Đề xuất (MVP / v1 / sau) | Lý do | MVP? [ ]`
   The last column is the checkbox the user ticks. Order rows by suggested tier, then by
   dependency.
3. **Đối chiếu legacy** — every ads-web screen and every ads-api endpoint group mapped to a feature
   ID, or "bỏ (internal Yes4All)" with the reason. Nothing left unmapped.
3b. **Đối chiếu Amazon Ads console** (D51 — the functional reference) — from
   `docs/discovery/ads-console-features.md`: each console feature → feature ID, and whether ads-web
   had it. The ads part of the MVP should reach console parity on the screens it includes.
3c. **AI / MCP** (D50) — features built on Amazon's Ads MCP Server and the SP-API connector, and
   on a seller-hub MCP server of our own, from `docs/discovery/ads-mcp.md` and `feature-ideas.md`;
   with the tier you suggest and what must exist first (connections, data sync).
4. **Thay nguồn dữ liệu** — condensed replacement map from P1-API: legacy source → Amazon source,
   and the gaps Amazon cannot fill (e.g. COGS → user input).
5. **Rủi ro và ràng buộc** — rate limits on high-volume reads, restricted data, Ads API approval,
   data volume and retention, Amazon's write limits, anything in the discovery reports that
   changes the plan.
6. **Roles SP-API cần cho MVP đề xuất** — so the user can register the app (R5).
7. **Câu hỏi cho Gate 1** — D10, D11, and any new question you appended to DECISIONS.md.

Suggest an MVP that is a thin, end-to-end product: connect a seller → sync listings → a listing
screen; then SP campaigns + Ads reporting with parity to ads-web's core screens; then inventory,
orders, finance. Say what that MVP proves.

## Done when

Every discovery output is reflected; every legacy screen/endpoint is mapped; the suggestion is
consistent with D1–D5.
