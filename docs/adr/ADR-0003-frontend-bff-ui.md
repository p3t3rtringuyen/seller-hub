# ADR-0003 — Frontend: Next.js App Router, BFF session, UI kit

Status: Accepted, pending Gate 2 (D20) · Date: 2026-11-10 · Task: P2-ARCH

## Context

D3 a: Next.js App Router as BFF. Hard rule: **Amazon and identity tokens never reach the browser** (SCOPE PLT-01,
UX-26). The core screens are large server-side grids modelled on the Ads console (D51) and the legacy UX rules in
`catalog/legacy/web-ux-rules.json`: server-side paging/sort/filter, ellipsis + tooltip cells (UX-02), numeric
alignment and Total row (UX-03), skeletons only for data in transit (UX-04/05), URL as state with per-tab prefixes
(UX-07/09), saved column order/visibility/pinning (UX-10), selection that survives paging with maxima (UX-11),
bulk bar rules (UX-12), lazy tabs kept mounted (UX-06/23). D54: Vitest + RTL, Storybook with interaction tests,
Playwright.

## Options

**Session / BFF**
| Option | For | Against |
|---|---|---|
| **Opaque session id in an httpOnly cookie; BFF forwards it server-side to the API as a bearer** | nothing usable by JS in the browser; revocation is a row delete; API stays the single owner of identity | every API call goes through the BFF (one extra hop, same host) |
| Browser holds a JWT (SPA style) | simple fan-out | violates the rule; XSS steals tokens |
| BFF holds sessions itself, mints internal JWTs for the API | API stateless | two identity stores; P3-IDENTITY spans two apps |

**UI kit and grid**
| Option | For | Against |
|---|---|---|
| **MUI 7 (core, MIT) + TanStack Table v8 + TanStack Virtual, wrapped once in `packages/ui` as `DataGrid`** | free; headless table gives full control for UX-02..UX-12 (pinning, ordering, Total row, selection across pages); MUI gives accessible inputs, dialogs, date pickers; theming with CSS variables | we build and own the grid component (one P3-DS task) |
| MUI 7 + MUI X Data Grid Pro/Premium | pinning, reordering, server-side data source, aggregation out of the box | commercial licence per developer, and a licence key shipped to every self-hoster (D1 a); Total row and selection rules still need custom work |
| shadcn/ui (Radix + Tailwind) + TanStack Table | modern, copy-in components | more components to build ourselves (date range with compare, autocomplete with async, number fields); Tailwind class drift across many sessions |
| Mantine + mantine-react-table | batteries included | MRT lags TanStack versions; smaller ecosystem |

## Decision

1. **Next.js App Router, Node runtime**, React Server Components for first paint of each page; client components
   for grids and forms.
2. **BFF**: `apps/web/app/bff/[...path]/route.ts` is the only browser-facing API surface. It reads the
   `sh_session` cookie (httpOnly, `Secure`, `SameSite=Lax`, path `/`), forwards to `apps/api` with
   `Authorization: Bearer <session id>` and `X-Request-Id`, strips hop-by-hop and `Set-Cookie` from upstream, and
   enforces CSRF on mutating methods (double-submit token + `Origin` check). Server components call the API with the
   same bearer through the generated client. Login, logout and LWA connect callbacks are BFF routes that call the
   API and set/clear the cookie. No Amazon or identity token is ever serialised into props or responses.
3. **UI**: MUI 7 core + emotion (theme with CSS variables, light/dark), **TanStack Table** as the grid engine in a
   single `packages/ui` `DataGrid` that implements UX-02..UX-12 once (UX-22). Charts: Recharts (or ECharts if the
   compare/KPI charts need it — P3-DS decides inside `packages/ui`).
4. **Data**: TanStack Query on the client through the typed client (`packages/contracts`) pointed at `/bff`;
   **URL state** with `nuqs` (one hook per page, tab prefixes per UX-09); forms with react-hook-form + zod schemas
   generated from the contract (ADR-0010).
5. **Route groups** per module: `app/(auth)`, `app/(app)/ads/**`, `app/(app)/listings/**`, `app/(app)/settings/**`,
   … each owned by its slice. Permissions arrive with the session context (`/v1/me`) and drive hide/disable (UX-12,
   UX-19); the API remains the enforcer.
6. Real-time updates (command progress, later notifications): **SSE** via the BFF (`/bff/events`), with polling
   fallback.

## Consequences

- P3-DS builds `DataGrid`, `MoneyField`/`PercentField` (UX-01), `DateRangeCompare` (UX-17), `ErrorCard` (UX-20),
  skeleton rules (UX-04/05) with Storybook stories and interaction tests.
- No MUI X licence. If the user later prefers MUI X Pro, the swap is inside `packages/ui` only (pages use our
  `DataGrid` API).
- The BFF is a thin proxy: no business logic, no DB access (lint rule).

## Revisit when

TanStack Table cannot meet a grid requirement within one P3-DS iteration, or the user buys MUI X Pro.
