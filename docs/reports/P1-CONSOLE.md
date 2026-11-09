# P1-CONSOLE report

## What was done
Read-only walk of the Amazon Ads console in the user's Chrome (2026-11-09), starting from START_URL (`entityId=…`).
Covered: campaign type chooser, builders for Sponsored Products, Sponsored Brands and Display, Campaign Manager list,
SB campaign detail (all 5 tabs), SB ad group detail (6 tabs), portfolios area pages (Portfolios, Budgets, Rules,
Products, Targeting, Bulk operations).

## Files
- `catalog/console/console-features.json` (11 entries, parses; no ids/names/account data — grep-checked)
- `docs/discovery/ads-console-features.md` (readable + parity table vs `catalog/legacy/web-features.json`)
- `docs/reports/P1-CONSOLE.md`

## Commands
- `node -e require(console-features.json)` → 11 entries, valid JSON.
- grep for entityId / account name / campaign ids / product names in the JSON → no matches.
- Nothing else run (no build exists yet).

## Not covered (with reasons)
- Streaming TV builder (outside SP/SB/SD; not opened).
- SP "Across retailers" retailer list (dropdown not read); SP "Amazon Business" site variant of the form.
- SB goals "Grow brand impression share" / "Reserve share of voice" field differences and SB video/asset upload steps: the
  goal radio did not visibly change the form text; test account has no Stores/segments so pickers were empty.
- Validation messages, min/max values: only visible after Save/Launch/Submit, which were never clicked.
- Column tooltip definitions: only the Status tooltip read (hover per header not done).
- Campaign Manager tabs All / Sponsored Products / Display; SP and SD campaign detail; ad group level list; portfolio
  detail, Drafts, History, Settings; History tab of the ad group. Account only has SB campaigns.
- Left-nav tools (Recommendations, Brand Stores, Creative Studio, Brand metrics, Ads planner, Attribution, AMC, Reports,
  Brand lift, Billing…) listed by name only.
- Saved views: the View menu only has Default and Compact.

## Incidents
1. Leaving a builder triggers Chrome's native "Leave site?" dialog, which blocks the extension; I closed the stuck tab
   workflow by opening a second tab. The first tab (builder page for Display, unsaved wizard) could not be closed
   (the close call hung). **It is still open and may show a "Leave site?" dialog — the user should close it
   and choose Leave.** Nothing was saved or submitted.
2. A click while the Ads Agent AI chat panel was open hit a suggested prompt, starting a chat ("Thinking"). No account
   change is known to result; it is an AI chat, not a campaign action. Also the Campaign list search box showed a
   campaign search term already filled — not typed by me deliberately.
3. Only buttons clicked beyond navigation: radio/tab/expand controls in builders, opening menus (Columns, Filter, View,
   Export, Bulk actions, date range, row kebab) and a row checkbox (deselected again). No menu item that writes was clicked.

4. Interruption (orchestrator notice): the user touched the Chrome tab. On recovery the tab was still on the unsaved
   Display builder page (no dialog content changed, nothing submitted); no change to data or filters was visible. Closing it still hangs on the
   native "Leave site?" prompt, so it must be closed by hand. No further screens were read after the interruption; all
   recorded screens were captured before it.

## Open questions
- Should P1-SCOPE ask the user for an account with SP/SD campaigns to complete those tabs?
- Is Streaming TV in scope? (assumed no)

## Follow-ups
- A second pass on an account with SP/SD data to read SP campaign detail tabs and the other builder goals.
