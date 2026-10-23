# Spec 2: Service Orders Homepage and My Drafts

Status: approved integrated implementation-ready design. No application behavior has been implemented or verified.

## Goal and Scope

Give active admins a read-only authenticated homepage for finding persisted service orders and a separate private list for resuming manually saved drafts.

Own `/orders`, `/drafts`, their listing APIs, projections, pagination, request state, responsive presentation, and navigation requirements. Spec 1 owns the router and shared shell; coordinate integration rather than independently editing those modules.

Exclude search, filters, page-size selection, charts, KPIs, totals, polling, live updates, editing, deletion, reassignment, and status transitions. Draft deletion and save/submission actions belong to Spec 3's form, not these lists. No database draft is created just by opening the form.

## Decision Ledger

Confirmed through discovery:

- All authorized admins see all Module 1 service orders; no branch or creator restriction for orders.
- My drafts includes only saved, unsubmitted drafts belonging to the authenticated creator. Submitted and explicitly deleted drafts disappear. Retained submitted-draft order links remain Spec 3's reconciliation concern.
- Drafts have no order number or operational assignment and never appear in service-order queries or displayed order counts.
- Both lists use 25-item forward cursor pagination with frontend Previous history, newest first, no total or numbered-page jumps.
- Orders sort by creation time descending, then immutable unique ID descending. Drafts sort by last saved time descending, then ID descending.
- No automatic retries, polling, or list refetch merely on tab visibility. Spec 1's mandatory visibility-triggered session check still runs and temporarily hides protected content.
- Explicit Refresh requests the newest page; commit the reset only after success.
- Creation-time and last-saved display timezone is Asia/Kuala_Lumpur, never the browser's timezone.
- Desktop tables become labeled mobile cards when content no longer fits. All fields remain available.
- Return from existing detail restores/revalidates list location. Explicit return after successful creation opens fresh orders page one. Explicit My drafts navigation after successful draft save opens fresh drafts page one. Browser Back preserves ordinary history behavior.
- Manual database drafts persist across logout; unsaved data remains memory-only under Spec 1/3 ownership.

Resolved dependencies from Spec 1: TypeScript, Node 24 LTS, Fastify, pg, React/Vite/React Router/Tailwind, npm workspaces, Vitest/RTL, Fastify integration tests, Playwright; relative same-origin `/api`; UUID IDs; camelCase; `{data}` success; shared errors; UTC ISO timestamps with milliseconds; custom database-backed authentication; shared shell and recovery store.

Settled dependencies: Spec 3 exports canonical DTOs, MYR money, schema and
draftEditPath; Spec 4 accepts detail/return integration; Spec 1 owns cursor-safe
routing, generation and lifecycle. Foundation/schema implementation precedes
execution; there are no open shared product contracts.

AGENTS.md/DESIGN.md reflect the approved real-auth scope. Preserve compatible visual/accessibility tokens. Assessment examples do not override Spec 3 enums or currency.

Deferred: additional features listed in exclusions, deployment, and infrastructure provisioning. Do not add them to complete this spec.

## Routes, Shell, and User Flow

- `/` replaces with `/orders` under Spec 1. Protected list routes are `/orders` and `/drafts`; optional `?cursor=<token>` selects an older position.
- Shell links: Service orders and My drafts, with `aria-current="page"`. Switching sections through a shell link opens the target's newest page. No draft-count badge.
- Each list has h1, one primary Create service order link to `/orders/new`, secondary Refresh button, results region, persistent feedback region, and pagination where applicable.
- Order number links to `/orders/:orderId`. Draft label uses draftEditPath(id), `/drafts/:draftId/edit`.
- An authenticated entry fetches persisted summaries. No local submission state substitutes for this query.
- Creation opens saved detail under Specs 3/4. Explicit Service orders return fetches page one. Existing-detail return restores its originating cursor, scroll and order-link focus where possible, then revalidates.
- After successful manual draft save, choosing My drafts fetches page one. Without a save, return restores/revalidates prior location after Spec 3 resolves unsaved-change navigation.
- Resume always loads current draft/version through Spec 3. If another tab submitted/deleted it, Spec 3 owns that result; returning revalidates My drafts. No list data is an edit snapshot.

## Presentation and Accessibility

Use DESIGN.md colors, type, spacing, visible focus, and approximately 44px controls. No decorative dashboard controls. Check 360, 768, 1280 and 1440px, 200% zoom, long labels and reduced motion.

Orders field order: order number, customer name, service type, assigned technician, quoted price, status, creation time. Do not include phone, address, problem description or notes.

Draft field order: customer label, service type, proposed technician, quoted price, Last saved. Derive primary label from nonblank saved customer name, otherwise `Untitled draft`. No title field, UUID label, completion percentage, order number or operational status. Missing optional draft summary values show `Not provided`; zero money is not missing. Proposed technician is never labeled Assigned.

Consume Spec 3 display maps Installation/Servicing/Repair and Assigned, and
formatMoney for MYR. Order technician is nonnull, never Unassigned. Draft price
missing shows Not provided; incomplete shows Incomplete price; money includes zero.

Use absolute timestamps such as `23 Oct 2026, 15:19 MYT`, explicitly formatted with `timeZone: 'Asia/Kuala_Lumpur'`, English month labels and 24-hour time. Use `<time dateTime={utcTimestamp}>`; summary API timestamps follow Spec 1. Prices/identifiers use tabular numerals. Status includes readable text, never color alone. Render all user text as text, not HTML.

Desktop: semantic table, caption identifying the list, column headers with scope=col; explicit primary links, no clickable rows. Mobile: semantic list of cards with primary link and labeled definition-list values. Use a content-driven breakpoint; render one accessible representation, not duplicate tab stops. Wrap long values without page overflow or tooltip-only information.

Results region has an accessible label and aria-busy during fetch. Polite status announces loading and success, e.g. `25 service orders loaded` or `8 drafts loaded`. Persistent operational errors use accessible alert feedback without repeated announcements from rerenders. After successful Next/Previous focus a tabindex=-1 results heading and scroll it into view. Refresh retains button focus. Failed navigation retains focus and the prior page. Initial route-entry focus follows Spec 1's h1 policy. Return restoration may focus the originating item after route focus; if absent, use results heading. Avoid a restoration-induced scroll jump by restoring after layout. Do not unexpectedly refocus after background revalidation.

Display `Showing 25 orders` / `Showing 8 drafts`, not a total or page number. Hide pagination on empty first page. Otherwise show Previous, Next and, on older pages, Back to newest. Previous is disabled without history; Next is disabled without hasNextPage. Disable pagination and Refresh while fetching; creation/item links remain usable. Back to newest follows Refresh's transactional navigation behavior.

## Frontend State and Request Rules

States: initialLoading, ready, firstPageEmpty, locationEmpty, fetchingWithResults, initialError, retainedResultsError, invalidLocation. Authentication/recovery/forbidden states are owned above the page by Spec 1.

| Event | Transition and visible result |
| --- | --- |
| Protected route mounts | Only after successful session check; initialLoading, then ready/empty/error |
| Initial first-page empty | Orders: `No service orders yet.` Drafts: `No saved drafts yet. Save a draft from the service order form to continue later.` Keep Create service order |
| Direct older location empty | `No orders at this list location` or draft equivalent; Back to newest; do not imply database is empty |
| Next/Previous | Retain current results while loading target; commit cursor URL/history/results together only on success |
| Next unexpectedly empty | Retain page/URL/history, announce `No more orders` / `No more drafts`, disable Next until successful revalidation of that page |
| Refresh/Back to newest | Fetch without cursor; on success clear Previous history, commit newest URL/results; failure keeps old page/URL/history |
| Recoverable failure | Initial failure is error panel, not empty state. Existing results remain with persistent error and Retry |
| Retry | Repeat the exact failed target/intent; no automatic retry or history advance on failure |
| Invalid cursor 400 | Invalid-location feedback and Back to newest; no silent fallback |
| 401 | Hide and clear protected list data, abort/ignore reads; delegate same-account recovery to Spec 1 |
| 403 FORBIDDEN | Clear list/navigation data and delegate Access denied; CSRF_REJECTED is not authorization denial |
| 429 | Persistent retry guidance, honor Retry-After before enabling retry; no automatic request |
| Transport/500/503 | Recoverable operational error; never reinterpret as logout |

Keep current cursor in URL; keep cursor stack, scroll and originating item ID in
an account-bound tab-local memory map only. Router history.state may contain only
an opaque random navigation key, never context. Resolve keys only in the current
account's map. Refresh loses map/history/scroll even if a history key survives.
A direct older page offers Next and Back to newest, Previous disabled until
local history exists. Popstate fetches the target without pushing another entry.

Spec 1 suspend/resume/destroy is authoritative: nondestructive visibility,
sessionChange and deliberate login privately retain completed rows and restart
interrupted reads once with exact target/intent on
same-account verification. A 401 clears rows but retains navigation for refetch;
network verification failure keeps state hidden, not logged out. Destroy clears
the map synchronously. Never leave loading dependent on an invalidated callback.

Each request has AbortSignal plus monotonically increasing request ID and auth-generation/account binding. Only the latest mounted request in the current auth generation may commit data, URL, feedback, history or focus. Abort on unmount or superseding fetch; cancellation is not an error. Clearing state after 401/logout/forbidden also invalidates in-flight callbacks, so a late 200 cannot expose data. Deduplicate auth transitions through Spec 1. Never store protected data in localStorage, sessionStorage, service workers or broadcast messages.

After confirmed 401, same-account reauthentication refetches the requested
location, not cached rows. Without a confirmed 401, same-account verification/
deliberate login rebinds hidden ready rows without refetch. Different-account login
destroys both navigation histories. Keep the validated cursor in Spec 1 safe-return.
An old cursor never transfers ownership. Explicit/logout-signal destruction clears
caches/history; saved database drafts remain. All domain auth failures are
cookie-neutral under Spec 1, even delayed 401; no list handler deletes cookies.

## Listing API Contracts

### Requests

- `GET /api/service-orders` or `GET /api/service-orders?cursor=<token>`
- `GET /api/drafts` or `GET /api/drafts?cursor=<token>`

No request body; reject any body with 400 after authentication. Authenticate/
authorize using Spec 1 before domain parameter validation/query. Reject any query
key except cursor, duplicate cursor, empty cursor, arrays/objects and tokens over
1024 characters with 400 MALFORMED_REQUEST. No creator/sort/limit/status/filter
parameters. Detect duplicate keys rather than parser last-value behavior.
Authenticated reads have no business mutations or session renewal.

Cursor: versioned base64url-encoded structured metadata containing version, list kind, exact database ordering timestamp and UUID boundary. Use fixed schema, bounded decoded input, strict timestamp/UUID validation, and reject cross-list/unsupported versions. Preserve full Postgres timestamp precision; never round-trip the boundary through JavaScript Date or the millisecond summary timestamp. No customer fields. Cursor signing is not required: altering a valid position changes traversal only, never access scope. Validate before parameterized SQL; no raw SQL fragments from cursors. A syntactically valid boundary need not correspond to a currently existing record. Do not expire cursors solely on elapsed time.

Exact codec shared with Spec 1 safe-return: unpadded canonical base64url of UTF-8
JSON with only `{v:1,kind:'orders'|'drafts',at:string,id:string}`, written in that
property order. Reject noncanonical base64url, padding, invalid UTF-8, duplicate
JSON keys, unknown keys and decoded bytes >768. `at` is UTC
`YYYY-MM-DDTHH:mm:ss.ffffffZ`, six fractional digits, valid Gregorian year
0001..9999/date/time, seconds 00..59, no offsets/leap seconds. `id` uses Spec 4
strict UUID shape canonicalized lowercase. Encode timestamp directly from a SQL
UTC text projection with six fractional digits, not pg's Date parser. For SQL,
bind validated at as timestamptz. Browser codec validates calendar components
without losing fractional digits. Cursors are public traversal metadata, never
customer fields or ownership evidence.

### Response Types

```ts
type Page<T> = {
  items: T[];
  pagination: { nextCursor: string | null; hasNextPage: boolean };
};
type OrderSummary = Pick<ServiceOrder,
  'id'|'orderNumber'|'customerName'|'serviceType'|'assignedTechnician'|
  'quotedPrice'|'status'|'createdAt'>;
// Import and re-export DraftSummary from Spec 3 drafts.ts.
type ListingResponse<T> = { data: Page<T> };
```

Import ServiceOrder and DraftSummary from Spec 3 contracts. Draft customerName,
serviceType and proposedTechnician are nullable; quotedPrice is the
missing/incomplete/money union. Draft projection excludes version/full payload;
load current version via Spec 3. Neither summary exposes actors or sensitive details.

200 always returns a page, including empty results. Fetch 26 rows, return at most 25; hasNextPage is true iff an extra row exists. nextCursor is generated from the last returned row iff hasNextPage, otherwise null. Never generate it from the lookahead row. Empty page returns items=[], hasNextPage=false, nextCursor=null.

Status codes: 200; 400 MALFORMED_REQUEST for query/cursor errors; 401 UNAUTHENTICATED; 403 FORBIDDEN; 429 RATE_LIMITED if shared infrastructure applies; 503 SERVICE_UNAVAILABLE; sanitized 500 INTERNAL_ERROR. Empty lists are not 404. Use Spec 1 errors, request IDs and Cache-Control: no-store on success and failure. Do not add a list-specific rate limiter or error envelope.

Synthetic exact empty response:

```json
{"data":{"items":[],"pagination":{"nextCursor":null,"hasNextPage":false}}}
```

Synthetic error examples (X-Request-ID matches requestId):

```json
{"error":{"code":"MALFORMED_REQUEST","message":"This list location is no longer valid. Return to the newest page.","requestId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}}
```

```json
{"error":{"code":"UNAUTHENTICATED","message":"Your session has expired. Sign in again.","requestId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}}
```

```json
{"error":{"code":"SERVICE_UNAVAILABLE","message":"Could not load service orders. Try again.","requestId":"cccccccc-cccc-4ccc-8ccc-cccccccccccc"}}
```

Exact synthetic nonempty fixtures:

```json
{"data":{"items":[{"id":"30000000-0000-4000-8000-000000000001","orderNumber":"SO-000001","customerName":"Demo Customer A","serviceType":"repair","assignedTechnician":{"id":"10000000-0000-4000-8000-000000000001","name":"Ali"},"quotedPrice":{"currency":"MYR","amount":"150.00"},"status":"assigned","createdAt":"2026-10-23T07:40:00.000Z"}],"pagination":{"nextCursor":null,"hasNextPage":false}}}
```

```json
{"data":{"items":[{"id":"20000000-0000-4000-8000-000000000001","customerName":null,"serviceType":null,"proposedTechnician":null,"quotedPrice":{"kind":"incomplete"},"lastSavedAt":"2026-10-23T07:40:00.000Z"}],"pagination":{"nextCursor":null,"hasNextPage":false}}}
```

## Database Query and Consistency

Use backend pg and app_private under Spec 1's restricted runtime role; no browser
Supabase client or privileged credentials. Spec 3 owns scalar domain columns.
Select only summary/technician columns, not SELECT * or full draft payload.

Order query shape: `WHERE (o.created_at,o.id) < ($1::timestamptz,$2::uuid)`
when cursor supplied; `ORDER BY o.created_at DESC,o.id DESC LIMIT 26`. Only
persisted orders, never union drafts. Spec 3 defines immutable keys/server times.

Draft query adds creator ID from Actor plus the canonical unsubmitted predicate, then analogous `(last_saved_at, id)` keyset boundary and ordering. No client creator ID. Creator filtering applies in SQL before LIMIT; never fetch all creators and filter in React. Avoid joins that duplicate rows or drop allowed nullable technician references; exact join type follows Spec 3 nullability.

Spec 3 migration 002_service_orders_and_drafts.sql owns indexes on
app_private.service_orders(created_at DESC,id DESC) and
app_private.service_order_drafts(creator_account_id,last_saved_at DESC,id DESC)
WHERE submitted_order_id IS NULL. Use those exact tables/columns/predicate.
Orders INNER JOIN technicians; drafts LEFT JOIN technicians without active-only
filter. Project quoted_price_sen/currency for orders and backend-only
quoted_price_input for draft parsing, per Spec 3 Narrow Listing Projections.
Do not duplicate migrations. Verify plans on multi-page synthetic data; tiny
fixtures need not use an index scan.

Each request reads current committed data in one SQL statement; no long-lived transaction or snapshot token. New inserts ahead of an order cursor do not shift subsequent pages. Timestamp ties are deterministic by Postgres UUID ordering. No guarantee for backdated inserts behind the boundary or future mutations outside this scope. Draft saves change ordering and can cause omissions/repeats across requests; approved tradeoff. Previous refetches a boundary, not an immutable historical page. Refresh is the recovery path. No misleading global count or strict snapshot promise.

## Module Ownership and Signatures

Concrete files within Spec 1's foundation:

| File | Responsibility and contract |
| --- | --- |
| packages/contracts/src/listings.ts | Export Page, OrderSummary, re-export Spec 3 DraftSummary and response types; browser-safe only |
| packages/contracts/src/listing-cursor.ts | Browser-safe exact cursor codec shared by API and Spec 1 safe-return validation |
| apps/api/src/listings/cursor.ts | Re-export shared codec and map its validation errors to typed MALFORMED_REQUEST |
| apps/api/src/listings/queries.ts | listOrderSummaries(db,position): Promise<Page<OrderSummary>>; listDraftSummaries(db,actor,position): Promise<Page<DraftSummary>>; narrow parameterized queries, lookahead and DTO mapping |
| apps/api/src/listings/routes.ts | registerListingRoutes(app): void; strict query validation, requireAdmin, creator derivation, shared error mapping/no-store |
| apps/web/src/api/listings.ts | fetchOrders(cursor,signal): Promise<Page<OrderSummary>>; fetchMyDrafts(cursor,signal): Promise<Page<DraftSummary>>; shared apiRequest, typed errors, no retries |
| apps/web/src/listings/useListing.ts | Cursor navigation/request state and auth-generation guard, history, refresh/retry targets; small shared hook only because both screens use identical behavior |
| apps/web/src/pages/OrdersPage.tsx | Order presentation, detail links, accessible list states |
| apps/web/src/pages/DraftsPage.tsx | Private draft presentation, derived labels and Spec 3 resume adapter |
| apps/web/src/listings/format.ts | KL timestamp formatting; consume rather than redefine Spec 3 money/enum formatters |

CursorPosition contains exact database timestamp text and UUID; kind distinguishes orders/drafts. Queries receive Pool/PoolClient-compatible query capability from Spec 1, not frontend credentials. Database errors propagate through shared sanitized handling. Fetch wrappers call apiRequest<Page<T>> which already unwraps data; never unwrap again. Do not redefine ApiError or Actor.

Spec 1 owns App.tsx, AuthProvider, safe return resolver, shell and shared client. Spec 3 owns canonical domain contracts/form/resume loader/migrations. Spec 4 owns detail page. Integration edits to owned shared files must be coordinated rather than overwritten.

## Tests and Acceptance

Unit:

- Cursor round-trip with microsecond timestamp precision, UUID ties, invalid base64url/JSON/schema/version/kind, empty/oversize cursor, repeated/unknown parameters.
- Pagination 0/1/25/26 rows, last-returned-row cursor, hasNextPage consistency and empty metadata.
- KL time independent of browser timezone, UTC day rollover, semantic datetime, fixed English 24-hour output.
- Draft fallback label, blank customer handling, missing/incomplete/money prices including zero; canonical formatter parity with Spec 3.
- Request reducer/hook: overlap, out-of-order completion, abort, auth generation changes, exact retry intent, refresh failure without navigation reset, Previous history loss on reload.

Database/API integration on isolated synthetic Postgres:

- Anonymous 401, active non-admin 403, expired/deactivated account denial, outages 503 rather than 401, sanitized errors and no-store headers.
- Identical timestamps across >25 orders yield deterministic UUID order with no skip/duplicate in static traversal; include timestamp differences below one millisecond.
- Traverse multiple pages, exactly 25, 26 and final partial page; first/direct older empty results; valid boundary whose record no longer exists.
- Insert newer orders between page requests: current cursor continues without offset shift and refresh exposes new rows.
- Two admins: orders visible to both; each draft list includes only its own unsubmitted records, even with another creator's cursor or tampered valid boundary.
- Submitted/deleted drafts excluded; incomplete drafts project safely; saved drafts survive logout, without unsaved-memory values appearing in listings.
- Draft save reorders results; tests assert deterministic per-request ordering, not snapshot consistency.
- Projection never includes private detail fields, credential fields, draft full payload or editing version. Grants deny direct anonymous Data API access per Spec 1.

Browser acceptance:

- Login lands on orders; shell links, create/detail/resume links and active navigation work without nonfunctional controls.
- Loading, first empty, older-location empty, errors, Retry, invalid cursor and defensive empty Next all have distinct accessible feedback.
- Next/Previous, Back to newest, browser Back/Forward, direct cursor URL and reload behave as specified; no failed request commits URL/history.
- Returning from detail restores item focus/scroll and revalidates; missing originating row uses heading. Explicit return after creation fetches newest orders; after save fetches newest drafts.
- Leaving during pending read and late success after logout/401 never repopulate protected content; different-account recovery clears all list state.
- Expiry and forbidden behavior delegates correctly; network failure never logs out. Visibility rechecks auth without unnecessary list refetch.
- Ready lists survive hidden nondestructive visibility/sessionChange/deliberate
  login checks for the same account without domain refetch; interrupted GETs
  restart once. Confirmed 401 discards rows/refetches after auth, destroy clears
  all. Late list 401 carries no Set-Cookie and cannot erase a newer login cookie.
- Draft resume obtains latest version; concurrent submission/deletion is handled by Spec 3, then return refresh removes dead items.
- Keyboard, screen-reader loading/result/error announcements, focus behavior, long text, 200% zoom and 360/768/1280/1440 layouts; all fields readable without horizontal page overflow.

## Ordered Small-Agent Tasks

1. Consume settled canonical imports, fixtures, routes, SQL names, Spec 1 lifecycle and unwrapped API contract; implement shared cursor codec first.
2. After Spec 1 scaffolding and Spec 3 schema are available, implement listings contracts and cursor codec with unit tests. Own listings contract/codec files only; coordinate domain imports.
3. Implement narrow SQL projections and indexes through Spec 3 migration ownership. Verify isolated-database pagination precision, ties, ownership, exclusions and insert behavior.
4. Implement two GET routes using shared authorization/error contracts. Verify Fastify injection tests, duplicate-query rejection, no-store and outages.
5. Implement fetch adapters and navigation/request-state hook. Verify stale-response, exact retry, auth-generation and history tests before UI integration.
6. Implement OrdersPage and DraftsPage, semantic desktop/mobile layouts and focus/status behavior. Consume canonical formatters and draftEditPath.
7. Coordinate Spec 1 shell/router/safe-return changes and Specs 3/4 explicit return actions. Verify browser journeys, expiry/logout, saved drafts and back navigation.
8. Review contract consistency and run established checks. Record actual results and remaining deployment-only gaps; never confuse design readiness with working code.

Spec 1 requires future root commands `npm run build`, `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:integration`, `npm run test:e2e`, and `npm run db:migrate`. They are not currently established or verified. Do not claim they ran. Migration/test execution requires isolated configured databases; this specification grants no provisioning, deployment or shared-database modification permission.

Implementation completion requires the exact DTO fixtures, passing available unit/integration/browser checks, private draft isolation, stable order keyset traversal under new inserts, complete failure/auth states, accessible mobile/desktop presentation and no application secrets in browser code. Design approval is not evidence of implementation correctness.

## Integration Contract

Consumes Spec 1: Actor/requireAdmin, API errors/request IDs/no-store, same-origin
client, generation/lifecycle, protected routing/shell, safe cursor return and
focus. Recovery after confirmed 401 refetches; nondestructive same-account
verification rebinds ready snapshots; different-account/logout destroys memory.

Consumes Spec 3: canonical summary types/formatters, schema projections, immutable
order ordering keys, mutable draft last-saved semantics, creator/unsubmitted
predicate, indexes, latest-draft loader and draftEditPath. List rows are not
editable form state.

Consumes Spec 4: detail route integration and originating list return context. Explicit post-create Service orders action requests newest page; existing-detail return preserves location.

Exports: protected `/orders` and `/drafts`; GET `/api/service-orders` and GET
`/api/drafts`; fixed Page/summary contracts; kind-specific cursors; descending
timestamp/UUID order; no totals; private unsubmitted drafts; fresh-page intents.
`rememberListReturn(binding,context): string` stores validated
`{pathname:'/orders'|'/drafts',cursor,originatingItemId,scrollY}` in memory and
returns an opaque UUID key; `resolveListReturn(binding,key)` returns context or
null only for the same account; `clearListNavigation()` destroys the map.
`openOrders(intent: DetailReturnIntent):void` implements Spec 4 newest/restore
behavior; draft editor has analogous `openDrafts` with newest/restore intent.
Validate cursor kind, UUID item ID and finite nonnegative scrollY. Private stores
rebind on verified same-account resume, clear on destroy, never enter history
except the opaque key. Context is not authorization. Spec 1 owns shared routing
calls; Spec 2 owns map, cursor stack, revalidation and restoration.

## Critical Review and Remaining Risks

Spec 1 accepts only this validated cursor query on list return targets and owns
visibility checks. Millisecond DTO times cannot reconstruct SQL cursors. Draft
mutable ordering intentionally lacks snapshot guarantees. Exclude submitted
drafts through submitted_order_id IS NULL, not order-number heuristics. SQL
schema, money/nullability and resume behavior are settled by Spec 3.
