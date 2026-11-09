# P1-REF report: reference patterns and feature ideas

Task: P1-REF (D56 parameters). Main checkout, no commit (per CLAUDE.md for discovery tasks).

## What I did

1. Read `CLAUDE.md`, `prompts/p1-reference-patterns.md`, `docs/DECISIONS.md` (D0, D3, D5, D50–D56).
2. Inventoried `refs/amazon/selling-partner-api-samples/use-cases/` (7 folders: website-authorization, auth-lifecycle-management, notifications, listings, aplus-content-manager, amazon-data-kiosk-mcp-server, sp-api-dev-mcp), `refs/amazon/selling-partner-api-sdk/javascript/` (SDK, helper, rate limits, RDT code), `refs/amazon/selling-partner-agentic-toolkit/` (12 skills, 3 commands), `refs/amazon/selling-partner-api-postman/` (8 collections).
3. Checked every SP-API and Ads operation I cite against `catalog/spapi/operations.json` and `catalog/ads/operations.json`. Checked a few more against `refs/amazon/selling-partner-api-models/models/`.
4. Researched public features of Pacvue, Perpetua (incl. Sellics), Helium 10 Ads (ex-Adtomic) and Skai with web search and fetch. Many vendor pages returned 403/404, so several entries rest on search excerpts and third-party sources. Each entry carries an evidence tag.
5. Wrote the three owned files.

## Files created

- `docs/discovery/feature-ideas.md`: 32 feature entries (F-01 to F-32) plus 4 parked items (P-01 to P-06 in section F), each with sources, Amazon API, write-approval level, applicability (S / V), and surface. It covers all 12 toolkit skills and 3 commands. Section I lists the Ads v0 exceptions for the D53 log. Section J indexes the source files and URLs.
- `docs/discovery/reference-patterns.md`: 7 use-case sections, SDK section, toolkit patterns section (P-T1 to P-T9), Postman section, a "not reviewed" list, and a source-file index.
- `docs/reports/P1-REF.md`: this file.

## Commands run and results

- `ls`, `cat`, `find`, `grep`, `sed` on `refs/amazon/**` (read only). No script from `refs/` was run; no dependency installed.
- `node -e` reading `catalog/spapi/operations.json` and `catalog/ads/operations.json` (read only): all cited SP-API operations found, except the connector-only names listed below. Ads: campaign, ad-group, target, report and recommendation operations are v1; keyword, negative keyword, bid update, budget rule, budget usage, portfolio and export operations are v0 in the committed catalog.
- `node -e` parsing the Postman collections (read only, request counts and folder names).
- WebSearch (standard and extended) and WebFetch on competitor pages. Results: Perpetua `perpetua.io/` fetched; Skai `skai.io/capabilities/amazon-dsp` fetched; Pacvue support article, Pacvue dayparting tag page, Skai Amazon page, Perpetua DSP page, Helium 10 `tools/adtomic` returned 403 or 404 and were not read.
- `mkdir -p docs/discovery docs/reports` (created the two folders; no other repository change).

## Findings to note

1. **Connector-only tool names are not public SP-API operations.** The toolkit's `analytics_getMetricMetadata`, `analytics_getMetricData`, `finances_monthEndClosing` and `sellerAssistant_*` do not appear in the Amazon models or in `catalog/`. They look like tools of Amazon's MCP gateway. We cannot build on them; the feature entries use public operations instead.
2. **RDT in the JavaScript SDK conflicts with its README.** The README table says RDT is not supported in JavaScript, but `javascript/sdk/src/orders_v0/ApiClient.js` contains a `TokensApiClient` with `retrieveRestrictedDataToken`, and the rate map includes `TokensApi-createRestrictedDataToken`. Verify with a sandbox call before P2 relies on either.
3. **Ads API v0 exceptions under D53** (for `docs/discovery/ads-domains.md`): keywords, negative keywords, target bid updates, budget rules, budget usage, portfolios, exports. The v1 set covers campaigns (create, update, query), ad groups and targets (query), reports (create, retrieve, delete) and recommendations.
4. **Competitor claims are mostly secondhand.** Pricing and plan tiers conflict across sources, so none is recorded. The Helium 10 rebrand and the Pacvue-based rebuild come from a single third-party blog.
5. **Vendor ads are unresolved.** It is not confirmed from an Amazon source whether 1P vendors use the same Ads profiles. F-32 is blocked on this.
6. **Samples are partly outdated or out of our stack.** The notifications sample is Java; website-authorization is Python; the listings sample predates current Listings guidance. The patterns transfer; the code does not.
7. **Postman "Automate Pricing Rules"** exists in the pricing collection. Pricing automation is not in scope for seller-hub yet (feature-ideas P-03). The toolkit's guardrail against pricing advice is a product choice we must make ourselves.

## Checks skipped

- No gate command: the repo has no build yet (CLAUDE.md, until P3-SCAFFOLD).
- No sandbox call to verify the RDT conflict or any operation: no credentials, and D30 is open.
- Helium 10 current tiers, Pacvue and Skai pricing: out of scope and conflicting.
- Java sources in the notifications sample, and the `code-recipes/` and `local-ai-sandbox/` folders: not reviewed in depth (listed in reference-patterns section 5).

## Open questions (for the user, via P1-SCOPE or D-log)

- Do 1P vendors use the same Ads API profiles and endpoints as sellers? (blocks F-32 and the vendor side of F-11, F-30.)
- Which Ads v0 exceptions (listed above) are acceptable for the D53 log, or should we wait for v1 coverage?
- Should the AI assistant's pricing guardrail (from the toolkit) be a product rule? (D50 and P-03.)

## Follow-ups (not done here)

- Verify the JS SDK RDT behaviour with a sandbox call (P2 or the P3 SP-API client task).
- Confirm the Ads search-term report type in the reports spec (F-05 input).
- Check DSP API coverage before any DSP feature is scoped (P-01).
- Open the Data Kiosk query lifecycle as a worker job type in P2 design (reference-patterns 1.6).
