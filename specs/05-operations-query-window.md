# Spec 5: AI Operations Query Window

Status: approved product decisions consolidated into implementation-ready design.
This document specifies future work; it does not claim implementation or test
verification. Existing Module 1 code is implemented. Historical documentation-only
status statements in Specs 1-4 describe their authoring time, not today's repo.

## Goal and Scope

Provide admins and managers with a conversational, read-only Operations assistant
grounded in real persisted service orders through controlled backend queries.
Implement the assessment's AI integration pattern without inventing completion
data or silently adding technician workflows.

Own the assistant page/API, query planning, retrieval, evidence, provider adapter,
usage admission, and necessary manager authentication/read-access integration.
Inherit the existing Node 24, Fastify, pg, React/Vite/Router, Tailwind, npm
workspaces, shared contracts, custom sessions, errors, CSRF and no-store rules.

Exclude completion tracking, payments, revenue, appointments, rescheduling,
availability, workload predictions, manager review, uploads, notifications,
writes through AI, arbitrary SQL, dashboards, transcript export and saved chats.
Drafts, operation receipts, accounts and sessions are never assistant data sources.
Authentication necessarily reads accounts/sessions separately from retrieval.

## Confirmed Decision Ledger

- Query existing orders only: find, count, group/rank, total quoted value, and
  exact order-number lookup. No synthetic completion dataset.
- Admins and managers may use AI and read all orders and existing full details;
  no branch/creator restriction. Managers cannot create orders or access drafts.
- Search customer name, problem description and admin notes under the explicit
  matching/privacy rules below. Phone/address are not searchable.
- Dedicated conversational page, non-streaming, memory-only, with follow-ups and
  clarification. One bounded retrieval plan per submitted question.
- One operator-configured OpenAI-compatible Chat Completions provider/model.
  Provider identity/model are deferred; compatibility/privacy are deployment gates.
- AI interprets; backend validates and retrieves; AI explains minimized results.
  Backend-rendered evidence is authoritative. No autonomous tool loop.
- All dates use Asia/Kuala_Lumpur. Aggregates cover every matching order, never
  just a displayed page. Quote value is not revenue; assignment is not completion.
- One active question per account, four across the deployment, ten admitted
  questions/account/five minutes, 500/deployment/MYT day by default.
- No automatic provider retries or provider fallback. Clear unavailable states;
  verified retrieval survives summary failure through deterministic fallback.

This spec intentionally supersedes the admin-only login and order-read portions
of Specs 1/2/4. It does not broaden Spec 3 write/draft authorization.

## Existing Integration Contracts

Current Actor and SessionData in packages/contracts/src/api.ts hardcode admin.
resolveSession in apps/api/src/auth/session.ts rejects all other roles;
authorizeAdmin in auth/authorize.ts currently relies on that rejection. Login
also checks admin under the account lock. AuthProvider rejects non-admin data.
These must change together; widening resolveSession alone would grant managers
admin powers through the existing authorizeAdmin implementation.

Current known routes, safe return, breadcrumbs and shell live in App.tsx and
auth/safe-return.ts. Listings and detail routes currently use requireAdmin.
The account CLI supports create-admin but not create-manager. The account role
constraint already allows manager; no alteration of that constraint is required.
Migrations 001/002 are checksum-tracked: never edit them for this feature.

## Roles, Authentication and Routing

Define PortalRole = 'admin' | 'manager'; widen Actor and SessionData to carry the
actual validated role. Login/session resolution admits active accounts in those
roles, preserving password hashing, locked login recheck, generic failures,
eight-hour expiry, cookie-neutral failures and existing session protections.
Technicians remain ineligible. Never accept a role in login input.

Make authorizeAdmin/requireAdmin explicitly require role admin. Add
requireOrderReader for admin/manager and use it only on order listing, detail,
and assistant routes. Technician selection, all draft routes, every editor
mutation and reconciliation route remain admin-only. Verify every existing
endpoint, including read-only editor endpoints, rather than relying on UI hiding.

Add trusted CLI `npm run account -- create-manager <email>` using exactly the
create-admin password/provisioning safeguards. No web provisioning, role selector,
role-change CLI or new UPDATE(role) grant. Existing maintenance commands work for
either portal role. Trusted out-of-band role changes must revoke sessions.

Route: /operations-assistant, without queries/fragments. Add to known routes and
safe-return allowlists. Both roles default to /orders; role-incompatible safe
returns fall back there. Managers visiting /orders/new or draft routes receive a
local permission page within their valid session; do not globally destroy a valid
manager session merely for an admin-only destination. API 403 still denies access.
Differentiate route-specific authorization denial from loss of portal eligibility.

Both roles see Service orders and Operations assistant. Only admins see My drafts
and creation actions, including Create another order on detail and empty-list
actions. Use role-neutral portal/login copy and actual role labels. Shared order
detail remains fully readable, including customer/contact, notes and traceability;
AI-provider disclosure is narrower than portal read permission.

Role change detected by session verification is an authorization-context change:
invalidate generations and destroy prior privileged state even for the same ID.
Do not restore admin editor recovery under manager permissions. Preserve existing
account-change/logout invalidation and backend authorization on every request.

## Capabilities and Query Semantics

Supported operations:

| Operation | Meaning |
| --- | --- |
| findOrders | Up to 25 newest matching orders plus full matching count |
| countOrders | Exact number of matching orders |
| rankTechnicians | Count or total quoted value grouped by technician |
| totalQuotedValue | Exact MYR sum over all matching orders |
| lookupOrder | Exact canonical SO number; operational summary and detail link |

Common filters: technician ID resolved from a name, service type, explicit date
range/date basis, customer-name term and service-text term. Combine conditions
with AND; service text matches problem description OR admin notes. Preserve enum
installation/servicing/repair. Only assigned status exists; never imply a live
status progression. Creation and assignment currently have equal timestamps but
remain distinct date bases. They are not service appointment dates.

One question produces one operation and its filters. Clarify multi-operation
requests instead of silently executing part or chaining queries. Supported
ranking metrics are order count and quoted total; equal metric values share
competition rank (1,1,3). Sort equal ranks by technician name then UUID for stable
presentation. Include inactive technicians with matching historical orders;
omit technicians with no matching orders and explain that scope. No-match ranking
is empty, not a fabricated winner. Sum/count zero is a valid result.

Resolve technicians against the backend's complete reference list, not only active
editor selections. Case-insensitive exact names may resolve automatically; partial,
duplicate or otherwise ambiguous names require clarification. Never accept model
invented IDs without checking them. "Best"/"busiest" requires a metric choice;
do not imply quality, completion or availability.

Order lookup accepts SO- followed by at least six decimal digits, canonical
sequence formatting without redundant leading zeros beyond the six-digit minimum.
Case-insensitive user spelling may normalize to uppercase. No fuzzy lookup or
JS Number conversion of sequence values. A missing order is a successful no-match
assistant outcome, not an AI failure.

Unsupported examples include completed jobs, collected revenue, unpaid balances,
work duration, scheduling, live availability and predicted overload. Explain the
missing data and offer a supported alternative without executing it automatically.
Never answer completion questions with zero or substitute assignment silently.

## Dates and Search Matching

Capture one server request instant before interpretation; use it consistently for
relative dates, the MYT usage day and displayed interpretation. The backend, not
the model/browser clock, resolves dates. SQL uses UTC instants and half-open ranges.

- Today: MYT midnight through captured now.
- This week: Monday 00:00 MYT through now.
- Last week: previous Monday inclusive through current Monday exclusive.
- This month: first day 00:00 MYT through now.
- Explicit calendar date range: start midnight inclusive, day after final date
  exclusive. Validate real dates; ambiguous numeric dates require clarification.
- Default date basis is createdAt; explicit assignment language selects assignedAt.
- No date means all recorded history and is explicitly labeled. No silent range cap.
- Show exact interpreted MYT dates/basis, not just "last week". Explicit future
  dates may yield no matches; do not imply scheduled work exists.

Each search term trims edges and contains 2-200 Unicode code points. Reject NUL
and unpaired surrogates; do not normalize accents or internal whitespace.
Case-insensitive literal substring, no stemming, fuzzy/phonetic matching, regex
or wildcard behavior. Escape %, _ and SQL escape characters before binding LIKE
patterns. Pin Unicode case behavior to the database collation in deployment/tests;
do not claim universal linguistic equivalence. A phrase preserves internal spaces.
Ambiguous customer versus service-text intent requires clarification when material.
Matches indicate recorded text only, not a verified diagnosis or customer identity.

For each returned row, backend may include customerName and one excerpt for each
matching problem/notes field. Each excerpt is at most 160 code points including
ellipsis, selected around the first match; markup is not part of content. Preserve
safe text rendering and label source fields. Do not return whole fields as a
fallback. Customer-only search needs no problem/notes excerpt. Aggregates expose
no per-order excerpts unless the requested capability returns order rows.

## Privacy and Trust Boundaries

Show a persistent concise notice: questions and recent conversation are processed
by the configured external AI provider; avoid unnecessary personal/sensitive data.
Do not claim local-only processing or that provider retention is disabled.

User-entered names or sensitive text can reach the provider in questions and query
state. Stored customer names, phones, addresses, problems, notes and excerpts do
not enter provider retrieval results or subsequent conversation evidence. Use
separate internal provider DTOs and browser evidence DTOs; never serialize browser
results into a provider prompt. Minimize IDs: use order-number references for the
model, with backend-controlled UUID links in the browser.

Provider retrieval payload may contain operation, interpreted filters, technician
names, service types, order numbers, timestamps, count/rank and quoted values.
Search terms originated by the user may recur in validated query state. Provider
summaries must not quote stored fields or invent customer/contact information.

All stored/user/model text is untrusted data, not executable instructions. Never
let prompt content override role, endpoint, model, query scope, SQL structure,
limits or credentials. No HTML injection, remote content fetching, browsing,
code execution, model-authored links or provider-hosted database tools.

Portal evidence can contain sensitive excerpts; do not promise automatic PII
redaction. Existing authorization, no-store and memory-only rules apply. No
questions/answers/search terms/excerpts/raw provider errors in logs, analytics,
URLs, browser storage, broadcasts or error telemetry. No transcripts in the DB.

## Conversational Page and Lifecycle

Use existing design tokens and shell. H1 Operations assistant, supported examples,
privacy notice, labeled multiline question input, Send, completed conversation,
progress and persistent error regions. Each answer shows interpreted filters,
MYT interval/basis, retrieval timestamp, AI narrative and authoritative structured
evidence. Label AI summary separately. Render plain text only; no raw Markdown HTML.

Examples must use available creation/assignment/quote data. Explain limitations
near examples. Answer rows link through backend-validated UUIDs to existing detail;
return to assistant retains the tab conversation. Respect existing guarded
navigation and do not create transcript data in history.state.

Follow-ups use last validated query state: "What about John?" changes technician
while preserving the prior filters when intent is clear. Data-dependent follow-ups
always retrieve afresh; old answers remain timestamped historical snapshots.
Clarification occurs before retrieval. Show full resolved filters on every answer
so unintended carryover is visible. Do not silently widen a query.

At most 20 completed exchanges (one user question and one response each). At the
limit, preserve history and require explicit Start new conversation confirmation
before another question. Do not silently drop visible history. Composer max 2000
code points; whitespace-only input rejected. Keep only the six most recent
exchanges in provider context, plus validated query state. Those exchanges contain
question text and sanitized narrative, never evidence cards/excerpts/customer
result fields. Omit failed/incomplete responses from contextual evidence.

One pending question; disable repeated Send. Allow Cancel. Start new conversation
clears history/query state after confirmation and cancels pending work if any.
No streaming or automatic retries. Navigation cancels pending work, retains
completed exchanges, and never automatically resubmits on return. Unsent composer
is retained in tab memory. Refresh/tab closure loses everything.

Temporary auth verification hides/inerts protected content and privately retains
completed state. Confirmed 401 clears transcript/results/query state and pending
request; only unsent composer text may recover after same-account login. Explicit
logout, account change, role-context change or loss of portal authorization clears
all assistant state, including composer. No automatic replay after auth recovery.
AbortSignal, request sequence and auth/account generation guard every callback.
Late results cannot repopulate cleared state. A request already admitted may still
consume quota/provider charges after cancellation or logout.

States: ready, interpreting, retrieving, summarizing, clarification, unsupported,
answered, answeredWithFallback, error and canceled. Auth gates remain above page.
Empty retrieval is an answer, not an operational error. Preserve earlier completed
exchanges after ordinary errors. Retry repeats an explicit user action, consumes
a new admission and obtains fresh data; label this rather than promising a replay
of an identical snapshot.

Use semantic headings, labeled controls, aria-busy and polite progress updates;
alerts for errors. Do not announce every token or forcibly move focus when an
answer arrives. Send retains focus; provide reachable answer headings. Tables
become labeled cards on narrow screens without duplicate tab stops. Test
360/768/1280/1440px, keyboard, 200% zoom, long content and reduced motion.

## API and Browser Contracts

POST /api/operations-assistant/query; active order-reader authorization before
domain parsing/admission. Same-origin JSON and X-CSRF-Protection: 1 are mandatory
despite read-only domain semantics: this POST consumes external resources.
Use existing {data}, error envelope, generated request IDs and Cache-Control:
no-store. No cookies set/deleted by assistant handlers. No query parameters.
Reject unknown properties and unsupported Content-Encoding. Body limit 128 KiB;
semantic context limits apply independently, never trust Content-Length alone.

Request contract (strict runtime validation, not just TypeScript):

```ts
type AssistantQueryRequest = {
  question: string;
  recentExchanges: Array<{ question: string; narrative: string }>;
  previousQuery: QueryPlan | null;
};
type QueryPlan = {
  operation: 'findOrders' | 'countOrders' | 'rankTechnicians' |
    'totalQuotedValue' | 'lookupOrder';
  filters: {
    technicianId: string | null;
    serviceType: 'installation' | 'servicing' | 'repair' | null;
    dateBasis: 'createdAt' | 'assignedAt';
    startDate: string | null; // explicit MYT YYYY-MM-DD
    endDate: string | null;   // inclusive calendar date
    customerName: string | null;
    serviceText: string | null;
  };
  orderNumber: string | null;
  rankingMetric: 'orderCount' | 'quotedValue' | null;
};
```

QueryPlan is a browser-safe context representation, not trusted SQL authorization.
The backend compiles it to an internal resolved plan with exact UTC boundaries,
including captured-now upper bounds for current relative periods. Model planning
can emit symbolic relative dates; backend canonicalizes them before retrieval.
The submitted previousQuery is revalidated and never executed implicitly.
Require all-time boundaries both null, or both valid dates, with start <= end.
Irrelevant fields must be null: lookup uses orderNumber only; ranking alone uses
rankingMetric. Validate operation/filter combinations and technician existence.

Each recent question <=2000 code points, narrative <=4000, at most six exchanges;
combined question/context/serialized plan <=16000 code points. Backend also caps
serialized provider input to 64 KiB per call; fail gracefully rather than silently
discarding filters. Client history is untrusted: reapply instructions, privacy and
all validation. A forged prior narrative never proves a fact or grants access.

Response is a discriminated union inside data:

- clarification: bounded plain-text message and optional validated choices; no
  retrieval or fabricated count. Choice selection submits a new question.
- unsupported: bounded explanation and supported suggestions, none auto-executed.
- answer: operation, canonical query, resolvedFilters (UTC boundaries plus MYT
  labels), retrievedAt, narrative, summarySource ('ai'|'deterministic'), and evidence.

Evidence types: findOrders {items,matchingCount,returnedCount,truncated}; count
{matchingCount}; total {matchingCount,totalQuotedValue}; rankings {items,metric};
lookup {order:null|OperationalOrder}. OperationalOrder includes UUID, orderNumber,
customerName, serviceType, technician reference, status, quote, createdAt,
assignedAt and optional matching excerpts. Never contact/whole notes/problem.
Ranking rows include technician, rank, orderCount and totalQuotedValue.
No pagination or load-more in version one; narrow filters for more than 25 matches.

Counts serialize as canonical nonnegative integer strings (Postgres bigint);
aggregate MYR totals use arbitrary-length canonical fixed-scale decimal strings.
Do not reuse the per-order maximum for sums, convert bigint to Number, or perform
floating-point money arithmetic. Per-order money retains the existing Money
contract; shared formatting must support aggregate magnitude deliberately.

400 MALFORMED_REQUEST for shape/context errors; 422 VALIDATION_ERROR for invalid
question fields; 401/403 existing auth meanings; 413/415 admission errors;
429 RATE_LIMITED for account/daily limits with Retry-After; 503
SERVICE_UNAVAILABLE for disabled/unconfigured provider, capacity exhaustion,
provider outage/timeout or DB timeout; sanitized 500 for unexpected failures.
User-understandable clarification/unsupported outcomes are 200. Invalid provider
output is a sanitized 503, never a query or a claim of no matches. Capacity
rejection may use short Retry-After; no client auto-retry. Formatting failure
after successful retrieval returns 200 answer with deterministic summary.

## Provider Orchestration and Grounding

Use a small injectable provider adapter around non-streaming Chat Completions,
not a multi-provider framework. Config: AI_ENABLED (default false), AI_BASE_URL,
AI_API_KEY, AI_MODEL, AI_DAILY_QUESTION_LIMIT (default 500), and
AI_GLOBAL_CONCURRENCY (default 4). Never expose secrets or let request/model
content override configuration. Enabling requires all provider settings; disabled
AI does not prevent the rest of the portal from starting.

AI_BASE_URL is an operator-trusted HTTPS API root; append chat/completions once.
Reject URL credentials/query/fragment and redirects; no browser-selected URL or
runtime model discovery. Local HTTP is permitted only in explicit test adapters,
not production. Document exact endpoint construction with the chosen provider.
Disable SDK automatic retries and automatic tool execution. Do not assume support
for Responses API, JSON Schema mode, store=false or provider retention controls.

At most two calls per question: interpretation, then summary after retrieval.
Interpretation returns strict bounded JSON: query, clarification or unsupported.
Validate everything; reject prose/code fences/trailing output, unknown fields,
invalid enums, overlong text and invented references. No repair call or tool loop.
Clarification/unsupported messages must still be safe, bounded plain text.

Each call has a 20-second timeout, whole request 45 seconds including admission;
database retrieval has five seconds. Bound response bodies to 64 KiB and output
to 1000 tokens/call using the configured provider's supported parameter. Validate
finish reason; truncated planning output cannot execute. Bound input as above;
token/context-window compatibility is a deployment test, not inferred from chars.

Summary receives minimized factual DTO, not browser evidence, and returns a
structured narrative referencing backend-issued fact IDs/order references. Use
backend-owned formatted values for numbers and order references where possible.
Reject unknown facts, mismatching numeric claims, invented order references or
links; insert validated values through deterministic rendering. If free narrative
contains claims the validator cannot establish, prefer deterministic summary.
Never claim that numeric matching proves all prose correct. Evidence is primary.
Summaries should be short, distinguish quotes from revenue, and avoid unsupported
causal/performance conclusions. No-result and lookup-miss summaries can be purely
deterministic without a second call.

Formatting error/timeout/invalid grounding uses deterministic fallback with usable
results. Interpretation failure cannot fall back to guessing a SQL query. Provider
errors are mapped to sanitized application copy, not relayed verbatim. Cancellation
aborts outbound work best-effort; explain that billing may continue.

## Retrieval, Consistency and Database Boundary

Dedicated allowlisted queries over app_private.service_orders and technicians;
no scanning frontend list endpoints. Parameterized values only. Enumerated
operation/date-basis selects backend-owned SQL fragments, never model SQL.
Explicit projections, no SELECT *, joins to drafts/accounts/sessions, or writes
to operational data. Shared auth queries are independent.

For findOrders, count and displayed rows/excerpts use one SQL snapshot (one
statement or short read-only REPEATABLE READ transaction). Set transaction-local
statement_timeout and release connections in finally. Aggregate all matches in
SQL with bigint/numeric sums. Order rows sort created_at DESC,id DESC and limit
25. Do not hold a DB connection during provider calls. retrievedAt represents
the retrieval snapshot time, not summary completion time. Follow-ups are fresh
snapshots; no cross-question consistency guarantee.

Literal substring search may require scans; no speculative index extension.
Existing creation-time index supports common retrieval; assess assignment-time
and search plans with realistic synthetic data. Add only justified indexes in a
new migration. Five-second timeout is a safety limit, not a performance promise.

Runtime remains trusted backend app_runtime; no DB credentials or generic query
capability reach the model. Dedicated functions select fixed queries. Existing
runtime privileges are not made read-only globally because the portal needs
writes; retrieval transactions themselves are read-only. Preserve revoked
PUBLIC/anon/authenticated access and non-exposed app_private schema.

## Shared Admission, Quotas and Diagnostics

Add db/migrations/003_operations_assistant.sql. No change to applied migrations.
Create narrow tables for aggregate usage and expiring admission leases only:

- ai_account_usage: account_id FK, window_started_at, admitted_count;
  one fixed five-minute window per account beginning on first admission.
- ai_daily_usage: myt_day date PK, admitted_count; request capture instant selects
  the MYT day. Configurable daily cap defaults 500.
- ai_request_leases: request_id UUID PK, account_id FK UNIQUE, slot integer UNIQUE,
  expires_at timestamptz. Slots range from 1 through configured global cap.

Validate positive counts and lease timestamps. Keep lease lifetime 60 seconds,
greater than request deadline; no request may continue useful work after deadline.
Use atomic transaction, deterministic lock order and concurrency-safe upserts;
serialize admission via a transaction advisory lock with bounded acquisition time.
Expire/remove stale leases under that lock, check account/global capacity and
quotas, claim slot, increment both counters, then commit before provider work.
Rejected admission consumes no question quota. Once admitted, charge even if
unsupported, clarified, canceled or failed; no refund or automatic retry.

Release only the current request's lease in finally. Crashes recover by expiry.
Expiration/aborting does not guarantee external provider computation or billing
stops; this is an application admission cap, not an absolute provider concurrency
guarantee. Do not hold DB locks while calling AI. Retry-After uses window/day
remainder or lease expiry, rounded up to seconds.

Grant app_runtime only required SELECT/INSERT and column-specific UPDATE on
usage counters/window; SELECT/INSERT/DELETE on leases. No schema CREATE,
ownership, role changes or new grants on order/auth tables. Cleanup old usage
rows (>30 days) and expired leases through trusted operator maintenance, not an
HTTP endpoint. Add `npm run account -- cleanup-ai` using provisioning connection
with narrowly granted cleanup privileges; document daily scheduling. No transcript,
search term or customer data in these tables.

Log requestId, actorId, operation when known, outcome, durations, configured model,
and token usage if returned. Never log provider URL credentials, prompts, response
bodies or SQL bindings. Aggregate counters do not guarantee a monetary ceiling;
configure provider-side spend caps where supported. Do not retry unknown billing
outcomes automatically.

## Implementation Ownership and Order

1. Widen shared role/session contracts and implement explicit admin/order-reader
   guards together; manager provisioning, role-aware routes/safe return/copy and
   existing-list/detail actions. Verify managers cannot reach any editor/draft API.
2. Add contracts/src/operations-assistant.ts with strict shared schemas/types,
   date/search rules and distinct evidence/provider DTO boundaries.
3. Add migration 003, admission/cleanup helpers and concurrency tests under the
   actual restricted runtime role.
4. Add apps/api/src/operations-assistant/{plans,queries,provider,admission,routes}.ts
   with injected provider adapter, grounding/fallback and deadline handling.
   Register routes in app.ts and parse documented config centrally.
5. Add web API wrapper, account-bound conversation store/controller and
   pages/OperationsAssistantPage.tsx; integrate shell/auth lifecycle and evidence
   presentation without duplicating the existing API/auth frameworks.
6. Run verification and update README, .env.example and AGENTS.md for implemented
   behavior/commands only. Existing specs remain historical; document supersession.

File decomposition is an implementation guide, not a requirement to create empty
abstractions. Prefer small existing-pattern modules; no speculative framework.

## Verification and Acceptance Gates

Unit/component tests:

- Strict question/context/plan validation; date boundaries at MYT midnight,
  Monday/month/year changes and leap dates; ambiguous dates and names.
- Literal %, _, escape chars, Unicode/code-point bounds, phrase matching,
  customer AND (problem OR notes), normalization and case behavior.
- Big integer counts/quote sums, zero, ties, inactive historical technicians,
  canonical SO formatting and aggregate values beyond individual price maximum.
- Prompt injection in questions/history/stored text; no SQL/tool escalation;
  evidence/customer fields excluded from outbound provider DTOs/context.
- Invalid/truncated/oversized model output, invented facts/links, formatting
  outage and deterministic fallback. No automatic retries or repair calls.
- Conversation limits, clarification/follow-up filter carryover, fresh retrieval,
  canceled/late results, role change and auth lifecycle destruction.

Database/API integration tests use existing disposable local UTF-8 PostgreSQL
clusters with non-superuser migration owner and real app_runtime, never supplied
environment databases. Test manager login/session acceptance and explicit admin
write/draft denial, both-role order reads, anonymous/inactive/technician denial,
CSRF/body/no-store/error contracts and cookie-neutral failures.

Verify all five operations, exact count/row snapshot consistency, all-match sums,
25-row truncation, no-match versus infrastructure failure, field projections and
no model exposure of stored text. Test concurrent account/global admissions on
separate connections/instances, quota boundary/reset, crash lease expiry, release
ownership, cleanup grants, provider timeout and pool connection release.
Confirm browser/Data API roles cannot read AI usage or operational tables.

Playwright with deterministic fake provider covers desktop/mobile full flows,
manager navigation/direct links, follow-ups, clarification, unsupported completion
requests, matching excerpts/plain-text injection, evidence detail links and return,
session expiry/logout/account change, cancellation/navigation, provider failures,
fallback answers, capacity limits and keyboard/zoom/accessibility states.

Run npm run typecheck, npm run lint, npm run test:unit,
npm run test:integration, npm run test:e2e and npm run build during implementation;
report actual results, not assumed success. No tests were run to author this spec.

Before production enablement: select provider/model; verify Chat Completions URL,
output-limit parameter, context size, JSON behavior, finish reasons, timeout and
usage handling with opt-in synthetic-only smoke tests. Review retention/training,
subprocessors, residency and deletion terms; disclose actual policy. Configure
secrets, TLS/origin/proxy/connection budget, daily cap and available spend cap.
Verify runtime security and load/search plans. No external provisioning, provider
calls, migrations against shared databases or deployment is authorized by writing
this specification.

## Residual Limitations

Only recorded creation/assignment/quote data is answerable. Search is literal,
not semantic diagnosis. Results can change between questions. Stored excerpts may
contain sensitive data, and users can type it into provider-bound questions.
Provider compatibility/privacy cannot be certified before provider selection.
Grounding reduces hallucination risk but does not prove free prose correct;
structured evidence and deterministic fallbacks are the reliable interface.
Usage caps bound admissions, not exact cost or externally continuing computation.
