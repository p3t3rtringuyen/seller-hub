# P6-SEC — Security review against Amazon's data protection requirements

Model: Opus · checkout: main, read-only for code · do not commit
OWNED_PATHS: `docs/security/**`, `docs/reports/P6-SEC.md`; you may append follow-up slices to the
end of `docs/BACKLOG.md` under "Security follow-ups".

## Goal

Know, before anyone outside the team uses seller-hub, where it falls short of what Amazon requires
of developers handling seller data — and fix list for each gap. Required before D1 (b) SaaS.

## Inputs

Amazon's Data Protection Policy and Acceptable Use Policy for SP-API developers, and the Amazon Ads
API terms (fetch the current versions from Amazon's developer sites; record the URLs and dates you
read). The merged codebase, ADRs, data model, deployment notes.

## Check

- Encryption in transit and at rest; key management; credential vault.
- Access control: least privilege, MFA for admins, tenant isolation, audit trail.
- PII: which data is stored, where, for how long; purge jobs; no PII in logs, backups policy.
- Logging, monitoring, alerting; incident response (Amazon's notification deadline) — a runbook.
- Vulnerability management: dependency scanning, secret scanning, container scanning in CI.
- Secure development: review gate, branch protection (once a remote exists).
- Application security: authn/z on every endpoint, CSRF, SSRF on report download URLs, injection,
  file handling of report documents, rate limiting of our own API.

## Output

- `docs/security/dpp-gap-analysis.md` — requirement → current state → gap → fix → severity, with
  file references.
- `docs/security/incident-response.md` — runbook draft.
- Follow-up slices for every must-fix gap, appended to BACKLOG.

## Done when

Every requirement in the policies you read is a row; every must-fix gap has a follow-up slice.
