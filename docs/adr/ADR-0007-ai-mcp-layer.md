# ADR-0007 — AI layer: MCP client (assistant) and seller-hub MCP server

Status: Accepted (Gate 2, D20, 2026-11-10) — built after MVP (D50 c); MVP only keeps the seams · Date: 2026-11-10

## Context

D50 c: first an assistant inside seller-hub that is a **client** of Amazon's hosted MCP servers (Ads:
`advertising-ai{,-eu,-fe}.amazon.com/mcp[/lite]`, 110 tools; SP-API: `sellingpartner-ai.amazon.com/mcp`) with
approval for every write (AI-01, AI-02, v1); later a **seller-hub MCP server** over our own data (AI-04).
Sources: `docs/discovery/ads-mcp.md` §2 (auth: token mode with `Authorization` + `Amazon-Ads-ClientId`; FIXED
context headers), §5 (what MCP does not cover: stream, exports, history, budget rules, recommendations, profiles),
§6 (workshop advice: never hand the refresh token to the agent); `catalog/ads/mcp-tools.json`;
`docs/discovery/reference-patterns.md` §1.7 (do not expose an unguarded execute tool), §3 P-T2 (write = draft,
preview, approve). The MCP is beta; tool names may change.

## Options

**Where the assistant runs**
| Option | For | Against |
|---|---|---|
| **`assistant` module in `apps/api`** (agent loop server-side, MCP client in `packages/mcp-client`) | reuses session, RBAC, vault, audit and commands; tokens stay server-side | LLM latency inside the API process → run turns as jobs streamed over SSE |
| Separate agent service (e.g. LangGraph / Bedrock AgentCore as in the workshop) | independent scaling, Python ecosystem | second language (D3 a), second auth path for tenant scope |
| Browser-side MCP client | simplest demo | tokens in the browser — forbidden |

**How assistant writes reach Amazon**
| Option | For | Against |
|---|---|---|
| Let the LLM invoke MCP write tools after a UI confirm | least code | a second write path beside commands (trap 8); 207 handling, audit and caps duplicated; tool result shapes unverified |
| **Intercept write tools → turn them into seller-hub commands (source `assistant`) that need approval; execute through our client** | one write path, same audit, caps, kill switch and per-item results (ADR-0011) | needs a mapping per allowed write tool; unmapped write tools are unavailable |

## Decision

1. **Assistant (AI-01/02, v1)**: `modules/assistant` in the API; turns run as worker jobs, streamed to the UI via
   SSE. LLM provider and key are tenant settings (opt-in, trap 17).
2. **MCP client** (`packages/mcp-client`): connects in **token mode** to the region of the seller account; access
   token minted by `amazon-core`'s credential source from the vault (ADR-0005) — the refresh token never leaves
   our process and is never put in a prompt; **FIXED** account context: `Amazon-Ads-AI-Account-Selection-Mode:
   FIXED` + `Amazon-Advertising-API-Scope` (and `Amazon-Ads-AccountId`) set by code from the user's current scope,
   so the model cannot switch tenant or account.
3. **Tool allow-list in code** per server (prefer `/mcp/lite` meta-tools only if the allow-list can still be
   enforced on `invoke_tool` arguments; otherwise regular `/mcp` with a filtered tool list). Read tools: allowed if
   the user has the matching `*.read` permission. **Write tools**: never forwarded; each allowed one maps to a command
   kind (e.g. `campaign_management-update_campaign` → `ads.update-campaigns`), created with `source=assistant`,
   status `proposed`, shown to the user for approval (`commands.approve`); unmapped write tools are removed from
   the tool list.
4. Ingestion, schedules and automation **never** go through MCP (`ads-mcp.md` §5 rule of thumb).
5. **seller-hub MCP server (AI-04, later)**: separate deployable `apps/mcp` (streamable HTTP, stateless). It holds
   **no Amazon credentials**: it calls `apps/api` with a tenant-scoped, permission-limited machine token
   (`identity.api_tokens`, ADR-0004) obtained by an OAuth 2.1 flow where seller-hub is the authorisation server.
   Tools are generated from our OpenAPI contract (catalogue-driven, as the sample in `reference-patterns.md` §1.7);
   writes create `proposed` commands only.
6. Evals per skill/tool set in `eval/*.json` (pattern P-T8) before AI features ship.

## Consequences

- MVP work: none beyond seams — `command.source` includes `assistant`; approval flow exists for rules (D63) and is
  reused; machine-token kind exists in auth; `packages/mcp-client` slot reserved.
- Assistant-proposed writes inherit caps, kill switch, audit and per-item results.
- A beta tool rename breaks only a mapping table (with a test against `catalog/ads/mcp-tools.json`).

## Revisit when

Amazon's MCP leaves beta or publishes a tool → API mapping and result shapes; or SaaS needs a managed agent
runtime.
