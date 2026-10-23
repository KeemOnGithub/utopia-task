# Spec 4: View Saved Order Details and Creation Confirmation

Status: approved integrated implementation-ready design. Documentation only: no application code, packages, migrations, services, or tests were implemented or executed for this specification.

## Goal, Scope, and Dependencies

An active admin can open a persisted service order, inspect its saved customer/service/assignment/traceability fields, and navigate onward. Immediately after confirmed creation, the same screen gives persistent, accessible creation feedback without confusing order creation with job completion.

Own `/orders/:orderId` presentation, single-order retrieval API and DTO, read request state, creation-confirmation consumption, detail return behavior, and desktop/mobile acceptance. Spec 1 owns routing registration, shell, authentication, authorization helpers, shared API/error conventions and tooling. Spec 2 owns list pagination/navigation state. Spec 3 owns the canonical order schema, money, numbering, enums, technicians, metadata, migrations and creation/reconciliation response.

Exclude editing, deletion, reassignment, status transitions, technician completion, payments, manager review, WhatsApp, uploads, print/export and dashboards. Draft editing and submitted-draft resume UI remain entirely Spec 3's responsibility. Opening a submitted draft's View order link is ordinary existing-order entry, not evidence of a new creation event.

Inherit TypeScript, React, Tailwind, Vite, React Router, Node 24 LTS, Fastify, pg, npm workspaces, Supabase Postgres, Vitest/RTL, Fastify integration tests and Playwright from Spec 1. These are approved choices, not installed tooling. The inspected repository contains documentation, not application code or migrations. No database was inspected.

## Decision Ledger

Confirmed through discussion and accepted dependencies:

- All active authorized admins can read all submitted orders and all saved detail fields. No creator or branch restriction applies to orders. Draft privacy is unchanged.
- Route uses internal UUID, never order number. Saved data must be independently retrieved.
- All traceability is visible, not collapsed. Display creator/assignment account UUIDs, not names or emails. Accounts currently have no display-name contract; do not add one here.
- Header shows order number and Assigned status; sections are Customer details, Service details, Assignment and notes, and Traceability.
- Confirmation uses Spec 3's confirmed receipt and tab-local memory-only handoff, not query parameters or serialized router history. Refresh removes confirmation.
- Banner is dismissible, persists through the mounted visit and read retries, and is cleared on dismissal, navigation away, refresh, logout or account change. Back/Forward does not resurrect it.
- Confirmed creation remains a historical fact even if subsequent retrieval fails or returns 404. Authentication/permission failures hide all protected content, including that fact.
- Create another order is available only after successful detail retrieval. It starts a new empty form, not a retry of the previous submission.
- Customer phone/address remain plain selectable text, with no call/map links. Preserve multiline display; null notes show `No admin notes`.
- Display MYR through Spec 3's formatter and time in Asia/Kuala_Lumpur, independent of browser timezone.
- Explicit Service orders after creation opens fresh page one. Existing-order return restores/revalidates the originating list location where available.

Concrete Spec 4 choices in this document: GET path, strict UUID parsing, exact DTO alias, error copy, focus/retry rules and module boundaries. These fill Spec 4 ownership, not a second order/auth model.

Deferred: human-readable actor names, historical technician-name snapshots and all exclusions. No implementation task may add these implicitly.

Settled integration: Spec 1 owns generation/suspend/resume/destroy, unwrapped
apiRequest<T>, routing and safe return; Spec 2 owns cursor codec and account-bound
navigation map; Spec 3 calls this spec's handoff after confirmed creation.
Spec 1 foundation and Spec 3 migration are execution prerequisites, not open
interface decisions. All four designs are implementation-ready, not implemented.

## Routes and Exact Entry Flows

Protected route: `/orders/:orderId`. Register `/orders/new` explicitly as Spec 3's static route; it is not an invalid order identifier. Unknown extra path segments follow Spec 1's non-sensitive route-not-found behavior. Detail does not use query parameters or fragments. Do not copy arbitrary query strings into links or auth return targets. `?created=true` never creates a confirmation.

Identifiers are exactly 36-character hyphenated UUID text: hexadecimal groups 8-4-4-4-12, case-insensitive, canonicalized to lowercase. No whitespace trimming, braces, compact form or numeric/order-number identifiers. Accept UUID versions generally rather than requiring v4 for reads; Spec 3 only requires v4 for operation keys. No special nil-UUID behavior: a valid but absent UUID is missing. Validate before database casts; never interpolate it into SQL.

| Entry | Exact behavior |
| --- | --- |
| Existing homepage order link | Spec 2 records validated return context and links by UUID. After Spec 1 authorizes, fetch detail. No creation banner. Service orders restores the location and revalidates. |
| Direct URL/bookmark | Spec 1 restores/checks session before mounting/query. If login is needed, retain only its allowlisted route. Fetch detail; no banner and no list context. Service orders opens newest page. |
| Confirmed direct create or draft submission | Spec 3 commits/reconciles success, registers handoff, clears editor pending/dirty state, and replaces the editor history entry with detail. Detail consumes receipt and fetches independently. |
| Confirmed operation reconciliation | Only a matching completed createOrder/submitDraft result establishes the same handoff. Unknown/uncertain results never navigate as successful creation. |
| Submitted draft View order | Ordinary UUID link; no new receipt/banner. Without an originating orders-list context, Service orders opens newest page. |
| Refresh | Memory handoff/visit/list context is lost. Spec 1 checks session, detail fetches saved data, and no creation banner appears. |
| Browser Back/Forward | Ordinary history navigation and persisted refetch, without replaying consumed confirmation. Creation replaced the editor entry, so Back does not reopen that submitted editor entry. |

Focus the destination h1 through Spec 1 once on route entry. A direct invalid identifier shows local `Invalid order link` with Service orders; no detail API call. Authentication still precedes protected page mounting. A direct API request with that identifier returns 400 after authorization.

## Screen and Formatting

Use the shared shell, company navigation and identity/logout controls from Spec 1. Service orders remains the current section for detail. Do not add a separate detail navigation destination or mock identity.

Successful screen order:

1. Service orders return link and h1 `Service order SO-000001`, using the saved number; text badge `Assigned`.
2. Creation confirmation when eligible, with a labeled `Dismiss creation confirmation` button.
3. Customer details: Customer name, Phone, Address.
4. Service details: Service type, Problem description, Quoted price (MYR).
5. Assignment and notes: Assigned technician, Admin notes.
6. Traceability: Created by (account ID), Created at, Assigned by (account ID), Assigned at.
7. Secondary `Create another order` link to `/orders/new` after a successful load. No form prefilling or automatic navigation.

Show every persisted business field in ServiceOrder. Internal order/technician IDs remain route/DTO references, not extra operational fields; creator/assignment UUIDs are deliberately displayed. Do not display idempotency keys, source-draft IDs, draft values, session metadata, account emails, roles or credential fields. Assignment and creation metadata remain distinct labels even though Spec 3 currently makes their actors/times equal.

Use semantic section headings and definition lists, not disabled form controls. All text remains selectable. User strings render as text, never raw HTML. Multiline address, problem and notes use preserved LF line breaks with wrapping, e.g. white-space: pre-wrap and overflow-wrap: anywhere. Do not normalize or truncate saved values again. No tooltip-only full values. Null notes display `No admin notes`; an empty nonnull note violates the canonical contract and must not be silently presented as a valid null.

Consume Spec 3 maps: installation/servicing/repair -> Installation/Servicing/Repair; assigned -> Assigned. Assigned technician is mandatory and uses its current referenced name, including when inactive; never filter detail joins to active technicians or show an invented Unassigned fallback.

Money consumes Money `{currency:'MYR',amount:'150.00'}` and formatMoney, displaying `MYR 150.00`, including `MYR 0.00`. Do not parseFloat, round, change currency, or create a second formatter. No grouping is needed for this screen; shared formatter changes must be coordinated.

Timestamps are UTC ISO milliseconds in the DTO, displayed as `23 Oct 2026, 15:40 MYT`. Use explicit English month labels, 24-hour clock and Asia/Kuala_Lumpur timezone; append the explicit MYT label instead of relying on environment-specific timezone abbreviations. Use `<time dateTime={timestamp}>`. Consume Spec 2's date formatter rather than duplicate it; move to a shared browser-safe location only through owner coordination if necessary. UUIDs, order numbers and prices use tabular numerals where useful.

Follow DESIGN.md tokens and approximately 1120px content width. Desktop uses one cohesive surface with clear section dividers, suitable short definition pairs in two columns, and full-width multiline content. Narrow screens collapse to one column and wrap actions/UUIDs/long unbroken text. DOM order matches reading order; do not use CSS columns that reorder sections. No sticky actions, horizontal page overflow, hidden fields or duplicate accessible desktop/mobile representations. Verify 360/768/1280/1440px, 200% zoom, keyboard focus, contrast and reduced motion. Interactive targets are approximately 44px minimum.

## Creation Confirmation Protocol

Spec 3 result remains `OrderCreatedResult = {orderId,orderNumber,createdAt}`. Register only after its validated successful creation response or matching completed operation receipt. Bind handoff to current account and auth generation; no form object, query flag, draft row or list row establishes it. Receipt is UI evidence of a backend-confirmed result, not authorization or a security token.

Use a tab-local in-memory store outside the page, keyed by accountId and orderId.
A handoff contains receipt and returnIntent newestOrders. Never use history.state
for receipt storage; no localStorage, sessionStorage, URL, logs, telemetry,
service worker or broadcasts. Router state may carry only an opaque Spec 2
navigation key, not even validated return context. Resolve that key through the
current account's memory map; refresh loses map and context.

Consume the handoff once into a detail visit owned above transient auth-gate
rendering. Consumption is idempotent for StrictMode replay: reserve/consume through
a stable visit ID, not destructive take during render. Real route departure ends
visit/receipt/creation intent; StrictMode replay is not departure. Nondestructive
visibility/sessionChange/deliberate login gates retain visit and ready detail
privately, never rendered while checking; same-account resume rebinds ready data.
Only confirmed 401 discards customer data and requires refetch after auth.
Different-account login, FORBIDDEN, explicit logout and either logout broadcast
destroy visit/handoff before mounting fresh content.

Banner/state behavior:

| State | Feedback |
| --- | --- |
| Receipt present; initial read pending | `Order SO-000001 was created. Loading saved order details...` as persistent polite feedback. h1 remains generic `Service order` until saved data loads. |
| Loaded record matches receipt ID, number and createdAt | `Order SO-000001 created successfully.` Persistent, dismissible polite status. |
| Transport/500/503/429 read failure | `Order SO-000001 was created, but its details could not be loaded.` Separate read error and explicit Retry loading. No create-again action. |
| 404 after receipt | Keep the confirmed-created feedback and explain `Order not found. Its saved details are not available.` Retry loading and Service orders. Do not claim the creation failed or automatically recreate it. |
| Returned ID/number/createdAt mismatches receipt | Suppress normal success banner, withhold record display and show `The saved order details could not be verified. Retry loading or return to Service orders.` Do not show potentially wrong customer data or expose mismatch values. Receipt remains private for another read verification. |
| Malformed successful DTO | Treat as read consistency error, not missing/empty/success. Keep historical receipt feedback if present; offer read retry. |
| Dismissal | Remove creation feedback for the visit without removing ordinary errors, clearing newestOrders return intent, or changing persistence. Retry cannot resurrect it. |
| 401/403 | No receipt/order fields rendered; delegate to shared auth flow. |
| Refresh/direct link/history return after departure | No banner; ordinary read screen. |

Do not call creation `Order complete`. Do not claim retrieval failure rolled back a committed creation. No timers, dialogs, sole transient toast, automatic navigation or mutation retry. Announce each meaningful state transition once, not on every render. Creating another is an intentional new workflow, available only when detail is successfully verified.

## Retrieval API and DTO

`GET /api/service-orders/:orderId`, no body or query parameters. Authorize active admin independently through Spec 1 requireAdmin before domain parsing/query. Reject request bodies and all query keys, including duplicate/empty/created/cursor parameters, with 400 MALFORMED_REQUEST. Ensure Fastify validation order does not leak domain existence before auth. Decode the route segment once through framework routing, validate strict UUID and canonicalize. Malformed URL encoding is a sanitized 400 at framework boundary; it must never execute domain SQL.

Export browser-safe `type OrderDetail = ServiceOrder` and `type OrderDetailResponse = {data:OrderDetail}` from packages/contracts/src/order-detail.ts, importing ServiceOrder from Spec 3. No duplicate schema or second money/actor convention. Exact fields:

```ts
type OrderDetail = {
  id: string;
  orderNumber: string;
  customerName: string;
  phone: string;
  address: string;
  problemDescription: string;
  serviceType: ServiceType;
  quotedPrice: Money;
  assignedTechnician: TechnicianRef;
  adminNotes: string | null;
  status: OrderStatus;
  createdByAccountId: string;
  createdAt: string;
  assignedByAccountId: string;
  assignedAt: string;
};
```

The expanded shape is explanatory; implementation aliases/imports canonical types, not a separately maintained type. Validate boundary data using canonical enum/money/text/timestamp rules plus exact expected ID; never invent fallback values for malformed records. Backend DTO mapping enforces this before responding, and frontend guards against invalid/mismatched success data before display.

Exact synthetic success, HTTP 200:

```json
{"data":{"id":"30000000-0000-4000-8000-000000000001","orderNumber":"SO-000001","customerName":"Demo Customer A","phone":"+60 12 345 6789","address":"12 Demo Street\nShah Alam","problemDescription":"Air conditioner is not cooling.","serviceType":"repair","quotedPrice":{"currency":"MYR","amount":"150.00"},"assignedTechnician":{"id":"10000000-0000-4000-8000-000000000001","name":"Ali"},"adminNotes":null,"status":"assigned","createdByAccountId":"50000000-0000-4000-8000-000000000001","createdAt":"2026-10-23T07:40:00.000Z","assignedByAccountId":"50000000-0000-4000-8000-000000000001","assignedAt":"2026-10-23T07:40:00.000Z"}}
```

| HTTP/code | Meaning and frontend behavior |
| --- | --- |
| 200 | Exactly one persisted detail DTO. Never return null or an empty collection for a miss. |
| 400 MALFORMED_REQUEST | Invalid identifier/body/query. Invalid-link state; no automatic retry of unchanged invalid input. |
| 401 UNAUTHENTICATED | Missing/expired/invalid session or inactive account; hide protected content and delegate same-account recovery. |
| 403 FORBIDDEN | Active non-admin; clear protected detail/handoff/navigation state and open shared Access denied. Never disguise as missing order. |
| 404 NOT_FOUND | Authorized, valid identifier with no order row. Ordinary entry: `Order not found.` and Service orders. Receipt entry adds historical confirmation and read retry above. |
| 429 RATE_LIMITED | Only if shared infrastructure applies. Honor Retry-After, disable Retry until allowed, no automatic request. |
| 503 SERVICE_UNAVAILABLE | Database or infrastructure unavailable; persistent read retry, not logout or missing data. |
| 500 INTERNAL_ERROR | Sanitized unexpected failure; persistent read retry. |

All responses, including errors, use Spec 1 Cache-Control: no-store, generated X-Request-ID and shared envelope. GET has no business mutation/session renewal and needs no mutation CSRF header. No new detail-specific rate limiter or error framework.

Sanitized error examples; X-Request-ID equals requestId:

```json
{"error":{"code":"MALFORMED_REQUEST","message":"Invalid order link.","requestId":"60000000-0000-4000-8000-000000000001"}}
```

```json
{"error":{"code":"NOT_FOUND","message":"Order not found.","requestId":"60000000-0000-4000-8000-000000000002"}}
```

```json
{"error":{"code":"UNAUTHENTICATED","message":"Your session has expired. Sign in again.","requestId":"60000000-0000-4000-8000-000000000003"}}
```

```json
{"error":{"code":"FORBIDDEN","message":"You do not have access to this portal.","requestId":"60000000-0000-4000-8000-000000000004"}}
```

```json
{"error":{"code":"SERVICE_UNAVAILABLE","message":"Could not load the service order. Try again.","requestId":"60000000-0000-4000-8000-000000000005"}}
```

500 uses INTERNAL_ERROR with `Could not load the service order. Try again.` No fieldErrors for retrieval. Never echo the supplied ID, SQL, constraints, stack traces, customer values, cookies, hashes or account-status explanations. Frontend consistency errors are local operational feedback, not fabricated API status codes.

## Database Projection and Security

Use backend pg, restricted runtime role and app_private from Specs 1/3. No browser Supabase client, service-role key, Supabase Auth identity or duplicated credential/session queries. Every HTTP retrieval invokes shared session/account/active-admin checks; frontend route guarding is not access control.

One parameterized query selects from app_private.service_orders o, INNER JOIN app_private.technicians t ON t.id=o.assigned_technician_id, WHERE o.id=$1::uuid. No creator filter; both admins can read the order. Select only id, order_number_value, customer_name, phone, address, problem_description, service_type, quoted_price_sen, currency, assigned_technician_id, t.display_name, admin_notes, status, created_by_account_id, created_at, assigned_by_account_id and assigned_at, using explicit aliases.

No account join is needed: actor UUIDs already reside on the order. Never SELECT *, join sessions/accounts for display, or return password hashes/emails. Shared authorization separately joins accounts as Spec 1 requires, without placing those columns in this DTO. Do not join drafts/receipts. Technician deactivation must not hide historical orders; no t.is_active predicate. FK and restricted deletion ensure technician existence; a missing required relationship is an integrity failure, not an Unassigned fallback. No rows is 404; invalid projection data is sanitized internal failure.

Reuse Spec 3 pure number formatting for pg bigint string, never JS Number conversion; integer-sen conversion and canonical enum mapping are reused. Serialize timestamptz as UTC ISO with milliseconds. The order PK and technician PK support this lookup; no new migration/index is needed. Spec 3 alone owns 002_service_orders_and_drafts.sql. No order writes, locking workflow, session renewal or audit-table insertion is introduced by viewing/retrying.

No protected data enters browser persistent storage, broadcast payloads or service-worker caches. Avoid protected response/body/SQL-parameter logging. Use existing shared security headers and text rendering; do not create page-specific auth or CSP strategies.

## Read State, Retry, and Accessibility

States: invalidLink, loading, ready, missing, loadError, consistencyError. Auth checking/recovering/forbidden/unavailable are owned above the page. Confirmation eligibility/dismissal is separate visit state, not evidence that detail is ready.

On route/account change remove prior order data before starting a new read. No stale order flashes while fetching another identifier. Show generic h1 `Service order`, descriptive `Loading saved order details...`, and aria-busy on the detail region. Do not show empty fields as though they are saved data. Keep Service orders usable during reads and failures; no Create another order until ready. Ready uses saved number in h1/document title; do not move focus again merely because loading completed.

Each read carries AbortSignal, increasing request sequence, requested ID, account ID and auth generation. Only latest mounted current-account/current-generation results may commit record, receipt feedback, navigation or focus. Abort on unmount/superseding read. Cancellation is not failure. A late 200 after logout/401/403 cannot restore protected data. Duplicate auth failures go through Spec 1's deduplicated transition.

No polling or automatic failure retries. Spec 1's nondestructive visibility,
sessionChange and deliberate login suspensions all hide and privately retain ready
detail snapshots plus visit/dismissal state. Successful same-account resume rebinds
ready state without domain refetch; an interrupted pending GET restarts exactly
once with its exact target. A confirmed 401 discards the customer snapshot but
retains private visit/receipt; after auth, fetch detail afresh. Do not automatically
replay creation. These rules follow shared suspend/resume/destroy, not an independent
visibility-only policy.

Destroy clears detail, visit, handoff and callbacks synchronously. Network/503
verification retains private state hidden, never implies logout. Receipt
registration requires a current authenticated binding; generation changes invalidate
callbacks, not retained same-account receipts. Detail/session verification 401s
never delete cookies; Spec 1's response-order limits apply, and no frontend guard
claims to undo a delayed Set-Cookie or globally log out concurrent login sessions.

Retry loading repeats only GET for the same canonical order ID. Disable repeated activation while pending. Clear the prior read error while loading; retain eligible historical creation feedback unless dismissed. Success replaces error with saved fields; another failure remains actionable. For an ordinary 404 no Retry is required; Service orders is the recovery path. Receipt-backed 404 offers read retry without claiming eventual availability.

Errors are persistent, concise alerts. On initial asynchronous failure announce without stealing route h1 focus. After explicit Retry failure focus a tabindex=-1 error summary. On Retry success focus the detail section heading so removal of the retry button does not lose focus. Live regions announce loading, failure and eligible success once per transition; avoid duplicate assertive/polite copies of the same message. Focus destination h1 on navigation, never the success banner. Dismissing confirmation moves focus to the detail heading when ready, otherwise the stable h1, not body. Keep focus visible and logical, with semantic main/nav/headings. No forced focus on background auth revalidation success.

## Navigation Contract

Use explicit links/actions rather than history.go(-1), which might leave the application. Consume Spec 2 memory-only validated return context:

```ts
type OrderListReturn = {
  pathname: '/orders';
  cursor: string | null;
  originatingItemId: string | null;
  scrollY: number;
};
type DetailReturnIntent =
  | {kind:'newestOrders'}
  | {kind:'restoreOrders'; context:OrderListReturn};
```

Accept only /orders, Spec 2-valid bounded cursor shape, UUID originatingItemId or null, and finite nonnegative scrollY. Discard malformed/external context and fall back to newest; never trust supplied hrefs. Cursor stack remains Spec 2's memory, not a detail-owned duplicate. Context contains no customer data and is never authorization evidence.

Creation return intent wins over an older originating list context and survives banner dismissal during that visit. Explicit Service orders calls Spec 2 newest-page intent, triggering a fresh no-cursor query, not stale first-page cache reuse. Existing detail returns to the validated cursor, revalidates current rows, restores scroll/order-link focus after layout; missing row falls back to results heading, with no late background focus stealing. Direct/reloaded detail has no context and opens newest. After navigation away and browser return, creation intent is gone, so ordinary detail rules apply. Browser Back keeps normal history semantics, including a previously older list page; it is not the explicit Service orders action.

## Modules and Function Contracts

Concrete boundaries; keep cohesive code, not generic repository frameworks. Inputs/outputs below use canonical types and shared ApiError/Actor, not duplicate definitions.

| File / owner | Contract and effects |
| --- | --- |
| packages/contracts/src/order-detail.ts / Spec 4 | Export OrderDetail alias, OrderDetailResponse; browser-safe validation consuming canonical rules. No I/O or auth implementation. |
| apps/api/src/order-detail/queries.ts / Spec 4 | loadOrderDetail(db: Pick<Pool,'query'>, orderId:string): Promise<OrderDetail>; assumes validated canonical UUID; one parameterized SELECT; typed not-found/unavailable/integrity errors; no writes. PoolClient-compatible query typing may follow established foundation. |
| apps/api/src/order-detail/routes.ts / Spec 4 | registerOrderDetailRoutes(app:FastifyInstance): void; GET registration, shared requireAdmin before domain checks, strict parameter/query/body validation, DTO mapping, shared errors/no-store. |
| apps/web/src/api/order-detail.ts / Spec 4 | fetchOrderDetail(orderId:string, signal:AbortSignal): Promise<OrderDetail>; shared apiRequest<OrderDetail>, one unwrap, validate exact record ID/shape; ApiError/transport/local consistency error; no retries or handoff creation. |
| apps/web/src/order-detail/handoff.ts / Spec 4, consumed by Spec 3 | rememberCreatedOrder(binding,receipt):void; beginDetailVisit(binding,orderId,visitId): DetailVisit; dismissCreation(visitId):void; endDetailVisit(visitId):void; clearDetailState():void. Memory only; account/auth guards, StrictMode-safe visit claim, receipt single consumption, no network. |
| apps/web/src/order-detail/useOrderDetail.ts / Spec 4 | useOrderDetail(orderId): {state,retry}; orchestrates guarded GET, cancellation and read transitions; no mutation/auth duplication. May live in page if equally small. |
| apps/web/src/pages/OrderDetailPage.tsx / Spec 4 | Render exact sections/states/feedback/actions, consume visit/context, focus and accessible announcements. No database access or create request. |
| apps/web/src/order-detail/navigation.ts / Spec 4 | resolveDetailReturn(creationIntent,context):DetailReturnIntent; pure validation/fallback. Delegate actual restore/newest behavior to Spec 2. |
| apps/web/src/App.tsx, AuthProvider, api/client / Spec 1 | Register route, stable visit lifecycle, route focus and auth invalidation callbacks; shared client final unwrapping. Coordinated integration only. |
| apps/web/src/listings/* / Spec 2 | Export detail-link return context and list navigation adapter; owns cursor stack, refresh, focus/scroll restoration. |
| packages/contracts/src/service-orders.ts, order-editor/*, 002 migration / Spec 3 | Canonical DTO/rules/formatters and confirmed result production; invoke handoff before replacement navigation. |

`binding` is `{accountId:string,authGeneration:number}` from Spec 1, and `receipt` is OrderCreatedResult. `DetailVisit` contains visitId, orderId, eligible receipt or null, dismissal and return intent; it never contains a ServiceOrder snapshot. `beginDetailVisit` is coordinated with committed route lifecycle, not invoked destructively during render. Duplicate begin for the same live visit returns the same claim; end is a real route-leave event. Auth checks may rebind a retained same-account visit to a new verified generation without making old callbacks valid.

Spec 2 exports `openOrders(intent:DetailReturnIntent):void`, using its account-bound
map/router/list store for newest or restore. Resolve opaque keys before calling;
do not accept serialized context from history. Different-account/forbidden/logout
destruction synchronously calls clearDetailState and clears query data/callbacks.
Same-account 401 retains private visit receipt/return intent, not customer data.

## Verification Scenarios

Unit and component tests:

- UUID uppercase canonicalization, exact grouping/length, no trimming, braces, compact/numeric/order-number/encoded-separator rejection; syntactically valid absent UUID follows missing behavior.
- DTO uses canonical fields/nullability/enums, exact money including zero/max, order number beyond six digits, expected record ID; malformed/mismatched 200 is never shown as saved detail.
- Reused formatter gives exact MYR string and KL timestamp across browser timezone/day rollover; semantic time datetime remains UTC. LF/long Unicode content renders as text; null notes fallback; no HTML injection.
- Handoff only from confirmed create/check results, account-bound matching, ID/number/time comparison, dismissal through retry, refresh loss, real departure loss, StrictMode replay stability, no storage/history-state persistence.
- Loading/ready/missing/error/consistency transitions, exact read retry, duplicate activation prevention, abort/out-of-order completion, late results after auth invalidation, pending read resumption after verified auth.
- For each visibility/sessionChange/deliberate-login suspension: ready snapshot
  and dismissed banner remain private/hidden, same-account resume rebinds without
  detail refetch; an interrupted GET restarts once. Confirmed 401 instead clears
  customer data and refetches after auth; network failure retains hidden state,
  and destroy clears all. A delayed detail 401 emits no cookie deletion and cannot
  overwrite a newer login cookie or restore stale UI.
- Initial focus, retry success/failure focus, dismiss focus, announcements without repeated rerenders, no Create another order outside ready.
- Return context validation rejects external/malformed cursor/item/scroll data, creation intent beats older location, dismissal does not reset intent.

Database/API integration on isolated synthetic Postgres:

- Valid admin gets exact persisted fields, actor IDs and timestamps; values differ deliberately from any client/form fixture to prove retrieval authority. Two different admins can read the same order.
- Direct anonymous/malformed/expired/inactive session requests return 401; active nonadmin returns 403, including invalid/missing IDs, without exposing order data. Database auth outage is 503, never missing/401.
- Valid missing UUID is 404; invalid route UUID/body/any query is 400 for authorized caller, not a Postgres cast/500. Framework malformed-encoding 400 is sanitized.
- Technician deactivation does not hide order/name; no account display join or credential/customer leakage beyond intended DTO. Narrow projection omits source draft/receipts/session/credential metadata.
- 200/400/401/403/404/500/503 all carry no-store/request IDs/shared envelopes. Sanitization removes SQL/bind/customer/token data. GET leaves order/draft/receipt/session-expiry records unchanged.
- Canonical number from bigint and money from integer sen are exact; UTC timestamp serialization matches creation receipt milliseconds.
- Runtime and anonymous Data API privileges follow Specs 1/3; no new browser database access or order writes.

Browser acceptance:

1. From older homepage page, open order, inspect all saved fields, return with cursor/scroll/link focus restored and rows revalidated. Missing originating row falls back to heading. Browser Back/Forward follows history without new banner.
2. Create directly and submit saved draft: each confirmed result replaces editor with independently fetched detail and matching persistent `Order ... created successfully.` banner; no job-completion implication. Reconciled successful creation follows the same path.
3. Dismiss banner, retry/read state changes and navigate away/back: it does not reappear. Refresh/bookmark/direct URL loads the order with no creation banner. A forged created query or arbitrary history state cannot produce success.
4. After confirmed creation, fail detail with network/503/404: preserve historical success, show distinct read failure, Retry loading makes GET only, no second create or Create another order. Successful retry shows saved data and eligible success; explicit Service orders opens newest page.
5. Receipt mismatch or malformed success body withholds detail/success and gives safe consistency recovery. No customer details from a different record are displayed.
6. Direct link without session signs in and restores valid detail route; refresh checks session before querying. Invalid identifier, missing order, loading, error/retry and 429 countdown are distinct, accessible states.
7. Expiry hides protected fields/banner, same-account login refetches without mutation and may resume private visit confirmation; different-account/forbidden/logout destroys it. Late response cannot restore prior-account data. Visibility session checks obey Spec 1 without gratuitous domain polling.
8. Create another order appears only after verified load and opens empty /orders/new. No automatically copied customer data, auto-navigation, editing or status controls.
9. Keyboard/screen reader, long multiline/UUID text, contrast, reduced motion, 200% zoom and desktop/mobile sizes meet DESIGN.md without horizontal page overflow or focus loss.

## Ordered Small-Agent Tasks

1. Consume Spec 1 lifecycle/client/router, Spec 2 navigation map and Spec 3 producer contracts. Use settled DTOs; implement stable route visits with StrictMode tests.
2. After Spec 1 foundation and Spec 3 canonical types, implement OrderDetail alias/boundary validation and focused tests in Spec 4 contracts. Reuse canonical money/number/enum rules; coordinate shared validators if missing.
3. After 001/002 schema availability, implement narrow detail query and GET route in order-detail backend files. Coordinate route bootstrap registration with Spec 1; do not touch Spec 2 listing routes or add migrations. Verify isolated API/auth/projection/error tests.
4. Implement read wrapper/state plus memory handoff/visit lifecycle and return validator in Spec 4 web files. Gate on stale-read, account-change, StrictMode, dismissal/history and exact GET-retry tests before UI integration.
5. Implement OrderDetailPage sections/responsive states/focus/announcements. Integrate Spec 1 shell/router and Spec 2 return adapter through owners. Verify RTL and desktop/mobile behavior.
6. Coordinate Spec 3 confirmed create/reconciliation -> handoff -> replacement route. Verify direct-create, draft-submit, read-failure-after-success, refresh and no-duplicate-creation browser journeys.
7. Cross-review all four implemented boundaries, run established checks and record actual results and deployment-only checks. Design approval is not evidence code/tests exist.

Required future commands inherited from Spec 1: `npm run build`, `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:integration`, `npm run test:e2e`, `npm run db:migrate`. None is currently established or verified in the inspected documentation-only repository. Implementation agents must inspect package scripts first, use the single npm lockfile, and run relevant available checks against isolated configured databases. This spec grants no permission to install/provision/deploy or mutate a shared environment during specification work.

Implementation completion requires exact DTO/API behavior, authorized persisted retrieval for both entry paths, refresh/direct-link independence, correct memory-only confirmation lifetime, read-only recovery after confirmed creation, correct list restoration/newest intent, no credential/storage leaks, passing available unit/integration/browser checks, and documented unverified checks. Do not claim deployment security based only on local tests.

## Integration Contract

Consumes Spec 1: Actor/requireAdmin; active-admin custom sessions and 401/403 behavior; same-origin unwrapped apiRequest; shared errors/request IDs/no-store/security; router/safe-return/h1 focus; auth generation and synchronous invalidation; shell/current identity/logout. No Supabase Auth or competing auth SQL.

Consumes Spec 2: OrderListReturn, current cursor/history, KL time formatter, validated restore/newest adapter, revalidation and scroll/item-focus restoration. Explicit post-create return requests fresh page one; Browser Back does not impose that reset.

Consumes Spec 3: ServiceOrder/ServiceType/OrderStatus/Money/TechnicianRef/OrderCreatedResult, canonical validation and formatters; app_private schema/002 migration; nonnull historical technician reference; creator/assignment UUIDs and equal server times; confirmed receipt from create/submit/reconciliation and replace navigation.

Exports: protected `/orders/:orderId`; authorized `GET /api/service-orders/:orderId`; OrderDetail alias/response above; strict UUID behavior; persistent read and missing/error states; account-bound memory-only creation handoff and single-visit lifecycle; independent load/receipt verification; no-refresh/no-history-replay banner; restore versus newest return intent; no order writes.

Explicit acceptance of Spec 3: its creation handoff, independent detail fetch, receipt-vs-fetch-failure distinction, saved field schema, actor UUIDs, MYR, Assigned status, and fresh-list intent are accepted. Comparison additionally checks createdAt, already supplied by both canonical contracts. Spec 4 owns no draft endpoints or schema expansion.

Consistency review: no sessionStorage or history-stored receipt/context. Actor
UUIDs require no account schema change. Explicit list navigation differs from
browser history. Matching-fetch banner coexists with historical-created feedback
during read failure; neither makes a read error a failed creation. Supporting
documents reflect approved real auth/drafts/detail. Remaining deployment settings
and implementation verification are not unresolved interface decisions.
