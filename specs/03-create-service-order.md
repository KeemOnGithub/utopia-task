# Spec 3: Create and Assign a Service Order

Status: approved integrated implementation-ready design. Spec 1 foundation is an execution prerequisite, not an unresolved contract. No application, migration, or test has been implemented or run by this specification.

## Goal, Scope, and Dependencies

An active authenticated admin creates an assigned service order, either directly or from a private manually saved draft. Supabase Postgres commits the order, assignment metadata, and any draft conversion atomically. Confirmed creation opens saved order detail. An uncertain response must not lead to a second order.

Own technician loading, canonical order/draft contracts, form/editor, domain validation, domain migrations, create/save/load/update/delete/submit/reconciliation APIs, unsaved-change protection, and Spec 1 recovery integration. Spec 2 owns order and draft lists, their listing endpoints, cursor pagination, and list-return context. Spec 4 owns submitted-order detail only.

Exclude order editing/deletion/reassignment, arbitrary status updates, technician completion, payments, management review, uploads, notifications, autosave, technician administration UI, generic workflow engines, and heuristic customer-based deduplication.

Inherit specs/01-authentication.md: TypeScript, Node 24 LTS, Fastify, pg, React/Vite/React Router, Tailwind, npm workspaces, Vitest/RTL/Fastify integration/Playwright; custom database-backed sessions, not Supabase Auth. Backend owns authorization, validation, and database access. Use its Actor, error envelope, request IDs, no-store headers, CSRF/origin checks, same-origin client, memory-only RecoveryStore, and auth-generation invalidation. Do not implement competing helpers.

AGENTS.md and DESIGN.md reflect approved real-auth, drafts and detail scope.
Preserve compatible design/accessibility rules. Repository inspection found
documentation only; no database was inspected. Future commands are not verified.

## Confirmed Decision Ledger

All decisions in this section were confirmed during discovery:

- Final order requires customer name, phone, address, problem description, service type, quoted price, and exactly one technician. Admin notes are optional. Initial status is Assigned; API/database value is `assigned`.
- Services are installation, servicing, repair. Seed Ali, John, Bala, Yusoff with stable UUIDs, separate from accounts. No preselected service or technician.
- MYR only, 0.00 through 999999.99 inclusive, at most two fractional digits. Final API money uses fixed-scale decimal strings; database stores integer sen.
- Global database sequence starts at 1; display SO-000001 onward, minimum six digits, expands without truncation, no annual reset, acceptable gaps. No reservation during form entry or draft save.
- Text limits in Unicode code points: customer 200, phone 50, address 2000, problem 5000, notes 5000. Final values trim edges, normalize line endings, preserve internal spacing. Blank notes become null. Phone requires at least one ASCII digit, not elaborate country rules.
- Drafts are manual, private to creator, incomplete, versioned, and persistent until submission or explicit deletion. No autosave, order number, operational status, or assignment metadata. Another creator's draft returns non-disclosing 404.
- Drafts preserve unfinished bounded text, including phone and price. Reject wholly blank drafts. Draft labels use saved trimmed customer name or Untitled draft; no title field.
- First save replaces /orders/new with /drafts/:draftId/edit; stay in editor after all saves. My drafts is a separate action.
- Stale-version conflict preserves local input; choices are reload saved version with discard confirmation, or explicitly save changes as a separate draft. No forced overwrite or automatic merge.
- Deletion requires confirmation, removes editable content, and returns to My drafts after confirmation of persistence. Submitted drafts cannot be edited/deleted; reopening offers View order.
- Direct order creation does not require a draft. Draft submission atomically uses current form values plus expected saved version, creates one order, and retains draft-to-order link.
- Keys and exact attempted requests survive recoverable errors and same-account reauthentication in memory. Never automatically replay mutations or generate a new submission key on reauthentication.
- Successful operation receipts initially have indefinite retention, survive draft deletion, and contain metadata/fingerprints rather than copies of customer fields.
- Active technicians only are selectable. Preserve an older unavailable draft selection visibly, but require replacement before another save/submission. Successful order replay is independent of later technician deactivation.
- Same-account recovery restores unsaved work; different-account login, forbidden access, or explicit logout destroys it. Saved drafts survive logout. No browser persistence of protected data or keys.
- Confirmed order creation navigates to detail with memory-only confirmation state. Detail independently loads the record; refresh loses the creation banner, not the order.

Decisions inherited from Spec 2: all admins can read all submitted orders; creator-only unsubmitted My drafts; 25-item forward cursor pages; Asia/Kuala_Lumpur display times; explicit post-save My drafts and post-create Service orders open fresh page one. No list row is an editable draft snapshot.

## Routes and User Flow

| Route | Behavior |
| --- | --- |
| /orders/new | Protected empty form; opening has no database side effect |
| /drafts/:draftId/edit | Protected load of latest creator-owned draft; strict UUID parameter |
| /orders/:orderId | Spec 4 saved order detail, strict UUID |
| /drafts | Spec 2 private list |

1. Spec 1 establishes active-admin session before form mounting or queries.
2. New form fetches selectable technicians. Existing draft route loads current draft and technicians; preserve form availability if technician fetch fails.
3. Admin enters data. Save draft applies structural/size/nonblank rules only. Create order applies complete final rules. Both prevent repeated activation while pending.
4. Successful first draft save establishes ID/version/baseline, replaces route without triggering a discard warning, announces Draft saved, and stays in editor. No success is inferred from a click, timeout, or optimistic state.
5. Existing save updates version/baseline; delete requires expected version and confirmation. Separate-draft conflict action uses a fresh create-draft key and no inherited draft ID/version.
6. Create order directly or submit draft with current fields. Freeze captured mutation payload while pending; disable form mutation actions and editing until resolved, so feedback cannot refer to a different payload.
7. Confirmed creation clears unsaved/pending state, bypasses leave warning for the success transition, and replaces editor history entry with saved detail plus confirmation state.
8. Detail fetch failure does not undo confirmed creation or invite another submission. View order retry is read-only.

New form has h1 Create service order. Existing active draft has h1 Edit service order draft. Both use one cohesive form surface with Customer details, Service details, Assignment and notes sections. Show All fields are required unless marked optional, with clarification that drafts may be incomplete. Before submission, order number is selectable read-only text Generated when created, never a fabricated input value.

Actions: primary Create order; secondary Save draft; Back to service orders for a new form or Back to my drafts for a draft. Saved editor also offers Delete draft as a subdued destructive action. Save draft does not imply operational assignment. An unchanged existing draft disables Save draft with helper No unsaved changes; submitting it is still allowed. New blank form cannot save until nonblank content exists, but backend enforces the rule independently.

## Frontend State Machine

Use a discriminated state, not overlapping independent loading booleans. Auth state remains above the page.

| State | Events and transitions |
| --- | --- |
| loadingDraft | Loaded active draft -> editing; submitted -> submittedDraft; 404 -> missing; failure -> loadError |
| editing | Local edit updates dirty state; structural/final failure -> fieldErrors; save/create/delete -> mutating |
| fieldErrors | Inputs retained; focus first invalid control; correcting input clears/rechecks that field; explicit action validates again |
| mutating | Capture immutable request/key/baseline; announce progress; confirmed result -> editing, detail, or drafts; definitive rejection -> editing/conflict; transport/ambiguous server error -> uncertain |
| uncertain | Preserve original operation/payload/key. Block other mutations and editing. Check result -> reconciling; explicit Retry same request -> mutating |
| reconciling | Matching completed receipt -> apply confirmed outcome except sticky key-conflict/mismatch rules below; not_found -> uncertain with explicit same-key retry; read failure -> uncertain; never automatically mutate |
| conflict | Discriminate by the Conflict Actions table; preserve local work. Only version conflict permits reload/separate draft directly; busy/key/mismatch never share that generic action set |
| submittedDraft | Noneditable message and saved order link; no save/delete/submit; preserve conflicting unsaved work in memory until discard/leave confirmation if present |
| missing | Non-disclosing Draft not found. Back to my drafts. Recovered local work may explicitly be saved as a separate draft after pending outcome reconciliation |
| loadError | Persistent error and explicit Retry; never show empty draft as fallback |

Technician loading/error/empty is an orthogonal read state: form text remains editable, selected value is not silently erased, save/submit requiring unresolved selected technician is unavailable until fetch/retry completes. An empty successful list explains No technicians are available. You can save an incomplete draft without a technician. Draft save without technician remains allowed during technician loading/error; final submission always requires a successful list load and selected active technician, with backend recheck regardless.

Network errors, request aborts after dispatch, 500/503, and unclassified infrastructure failures are conservatively uncertain for mutations. A received 401 or CSRF rejection guarantees that request performed no domain mutation, but does not resolve a previously uncertain request. 422 and known transaction-rolled-back conflicts are definitive for that request. Do not rely on HTTP status alone to infer a lost earlier attempt failed.

Read requests use AbortSignal plus request sequence and account/auth-generation binding. Late callbacks cannot replace recovered fields, change routes, expose protected data, or announce success after logout/account change. Aborting a mutation is not database cancellation. Capture recovery data before hiding protected content on 401; follow Spec 1 for forbidden/CSRF distinction and logout.

## Form Matrix and Normalization

All API request objects are strict: reject unknown properties, wrong types, arrays
where objects expected, invalid UUIDs, NUL and unpaired UTF-16 surrogates. No
implicit coercion. Count Unicode code points; check raw bounds, normalize CRLF/CR
to LF, then check normalized bounds before final trimming. No NFC/NFKC conversion.
Draft text preserves other whitespace. Final trim uses ECMAScript semantics;
shared tests pin parity with explicit SQL edge-whitespace checks, not btrim alone.

| Field / label | Frontend | Request field | Draft DB | Final DB / rules |
| --- | --- | --- | --- | --- |
| Customer name | text, autocomplete=name, max code points 200 | customerName string | customer_name text, empty allowed | customer_name text NOT NULL; trimmed nonempty, <=200 |
| Phone | tel, autocomplete=tel, 50 | phone string | phone text, empty/unfinished allowed | phone text NOT NULL; trimmed nonempty, <=50, contains [0-9]; preserve +, punctuation, internal spaces and leading zeros |
| Address | textarea, autocomplete=street-address, 2000 | address string | address text, empty allowed | address text NOT NULL; trimmed nonempty, <=2000, LF lines |
| Problem description | textarea, 5000 | problemDescription string | problem_description text, empty allowed | problem_description text NOT NULL; trimmed nonempty, <=5000 |
| Service type | native select, blank placeholder | serviceType enum or null in draft; enum in order | service_type text nullable CHECK enum | service_type text NOT NULL CHECK installation/servicing/repair |
| Quoted price (MYR) | text, inputMode=decimal, 32 raw code points; never type=number | draft quotedPriceInput string; order quotedPrice string | quoted_price_input text NOT NULL, empty/unfinished allowed, <=32 | quoted_price_sen integer NOT NULL CHECK 0..99999999; currency text NOT NULL CHECK =MYR |
| Assigned technician / Proposed technician in draft context | native select, blank placeholder | assignedTechnicianId UUID or null in draft; UUID in order | proposed_technician_id UUID nullable FK | assigned_technician_id UUID NOT NULL FK technicians |
| Admin notes (optional) | textarea, 5000 | draft adminNotes string; order adminNotes string or null | admin_notes text NOT NULL, empty allowed | admin_notes text nullable; nonblank trimmed <=5000 or null |

Draft requests send all eight fields, including empty strings and explicit null select values, on every save. No sparse PATCH merge. Empty notes stay an empty draft string, not null. Enum blank UI maps to null. Empty UUID UI maps to null. Final order requests send all eight fields; notes null or blank becomes null; other nulls rejected. Form defaults are empty strings/null selects, never zero price.

Draft nonblank means at least one trimmed text field has content (including quotedPriceInput), or service/technician is selected. Whitespace-only drafts fail form-level validation. Drafts do not accept arbitrary enum values or nonexistent/inactive selected technician IDs. An inactive stored selection may be loaded unchanged, but next save needs replacement or clearing; submission needs replacement. No draft save creates assignment actor/time.

Final price accepts trimmed ASCII `^[0-9]+(?:\.[0-9]{1,2})?$`, raw length <=32, range <=999999.99; leading zeros accepted and canonicalized. Accept 12, 12.5, 00012.50 -> 12.00, 12.50, 12.50. Reject 12., .50, -0, exponent notation, commas, currency symbols, infinity and >2 decimals. Split string, strip leading zeros, pad fractional digits, range-check using integer/string arithmetic before conversion; do not parseFloat, multiply a floating number, or round excess precision. Integer sen stays within safe JS integer range; pg integer decoding is safe. Format sen by integer quotient/remainder to fixed-scale string. Response money is always `{currency:'MYR',amount:'12.50'}`. Shared browser formatter produces MYR 12.50 without floating-point conversion; optional grouping is string-based.

Draft summary price uses the same parser on trimmed raw input: blank -> `{kind:'missing'}`; valid complete amount -> `{kind:'money',currency:'MYR',amount:'12.50'}`; any other bounded nonblank input -> `{kind:'incomplete'}`. Thus 12 is valid money, 12. is Incomplete price, and zero is never missing. Draft summary does not expose invalid raw price text.

### Messages and Accessibility

Required messages: Enter the customer name.; Enter a phone number.; Enter the address.; Describe the problem.; Select a service type.; Enter a quoted price.; Select a technician. Phone without digit: Enter a phone number containing at least one digit. Price syntax/range: Enter a price from MYR 0.00 to MYR 999,999.99 with at most two decimal places. Length: Use N characters or fewer. Technician rejection: This technician is no longer available. Select another technician. Blank draft: Enter at least one detail before saving a draft.

Map backend fieldErrors to request field names. quotedPriceInput and quotedPrice both map to the price control; assignedTechnicianId maps to technician. Form-level errors use `_form` in fieldErrors and focus a tabindex=-1 error summary. For field errors, announce a concise summary and focus first invalid control in DOM order. Set aria-invalid and aria-describedby to persistent helpers/errors. Do not erase input after backend normalization errors or failures. Unknown error field names go to summary, never disappear silently.

Progress: Creating order..., Saving draft..., Deleting draft..., Checking result... in a polite status region, with aria-busy on form/results. Confirmed save: Draft saved. Unsaved changes after a saved baseline show Unsaved changes instead of an unconditional Saved label. Operational errors are persistent alerts, focusable on explicit failed actions. Do not announce the same error repeatedly on rerender. Confirmations/conflict dialogs use accessible modal semantics, focus containment, Escape/cancel, and focus restoration; destructive confirmation starts focus on Cancel. A save success keeps action focus; route changes follow Spec 1 h1 focus.

Use DESIGN.md surfaces, tokens, approximately 1120px workspace, 44px controls, visible focus, mobile input text >=16px. Suitable short fields share two columns; multiline fields span full width. Collapse to one column; wrap actions and feedback; no horizontal overflow at 360px or 200% zoom. No sticky controls that cover errors or keyboard focus.

## Unsaved Changes and Session Recovery

Dirty comparison uses current draft-form values against the last confirmed loaded/saved baseline after LF normalization, not final order normalization. New empty form is clean. Manual save establishes its captured values as baseline only after confirmation. Navigation links, browser Back/Forward and shell logout consult the same dirty/pending guard. In-app prompt offers Stay and Discard changes and leave; it does not automatically save. beforeunload is attached only while dirty or unresolved mutation; browser-native text/availability are browser-controlled and not a guarantee on mobile termination.

Leaving an uncertain operation warns It may already have completed. Leaving does not cancel it. Refresh/closure loses never-saved input and keys. After such loss, check Service orders before recreation; identical customer fields are not a deduplication key. An existing submitted draft link remains a durable recovery path even if its in-memory key is lost.

Spec 3 payload supplied to Spec 1 RecoveryStore is versioned and runtime-validated:

```ts
type OrderEditorRecoveryV1 = {
  schemaVersion: 1;
  mode: 'new' | 'draft';
  draftId: string | null;
  draftVersion: number | null;
  fields: DraftFields;
  savedBaseline: DraftFields;
  pending: null | {
    operationKey: string;
    operation: 'createDraft' | 'saveDraft' | 'deleteDraft' | 'createOrder' | 'submitDraft';
    targetId: string | null;
    requestBody: DraftWriteRequest | DraftUpdateRequest | DraftDeleteRequest | CreateOrderRequest | SubmitDraftRequest;
    state: 'inFlight' | 'uncertain' | 'checking' | 'retryAvailable';
  };
  submissionKey: string | null;
  conflictCode: null | 'DRAFT_VERSION_CONFLICT' | 'DRAFT_ALREADY_SUBMITTED' |
    'VERSION_EXHAUSTED' | 'OPERATION_BUSY' | 'IDEMPOTENCY_CONFLICT' |
    'RECONCILIATION_MISMATCH';
  listReturnKey: string | null; // opaque reference into Spec 2 account-bound memory map
};
```

Account ID and exact allowlisted returnPath live in Spec 1's outer RecoverySnapshot. Include submission key when a logical attempt exists, not a new key invented on restore. pending requestBody is the immutable attempted body; fields and savedBaseline are separate. Capturing an in-flight operation restores it as uncertain. Invalid/mismatched snapshots are destroyed, never submitted. No credentials or tokens enter this payload; no localStorage, sessionStorage, URLs, logs, telemetry, or broadcasts.

Same-account recovery: no automatic mutation. Uncertain operations require user Check result or explicit same-key retry. Otherwise reload current draft version without overwriting recovered local values; unchanged version restores editor, changed version enters conflict, submitted enters submittedDraft, deleted enters missing with separate-draft option. Read-only technician reload is allowed. Cross-account success and explicit logout clear all recovery state before protected page mounting. Visibility rechecks follow Spec 1 and must not overwrite edits.

Use Spec 1 suspend/resume/destroy, not independent visibility handlers. Keep
fields, baseline, dirty/conflict state privately through temporary verification;
restart interrupted draft/technician/reconciliation GETs once on same-account
resume without replacing edited values. Dispatched mutations become uncertain;
only reconciliation reads may restart, never the mutation. Destroy clears all.

## Exportable Canonical Types

Place browser-safe domain types in packages/contracts/src/service-orders.ts and packages/contracts/src/drafts.ts. Branded runtime types are optional, not required abstractions. Here string IDs mean validated UUIDs and timestamp strings mean UTC ISO with milliseconds.

```ts
type ServiceType = 'installation' | 'servicing' | 'repair';
type OrderStatus = 'assigned';
type Money = { currency: 'MYR'; amount: string }; // canonical fixed scale, bounded
type TechnicianRef = { id: string; name: string };
type SelectableTechnician = TechnicianRef; // endpoint contains active rows only
type DraftFields = {
  customerName: string; phone: string; address: string;
  problemDescription: string; serviceType: ServiceType | null;
  quotedPriceInput: string; assignedTechnicianId: string | null;
  adminNotes: string;
};
type OrderFields = {
  customerName: string; phone: string; address: string;
  problemDescription: string; serviceType: ServiceType;
  quotedPrice: string; assignedTechnicianId: string;
  adminNotes: string | null;
};
type ServiceOrder = {
  id: string; orderNumber: string;
  customerName: string; phone: string; address: string;
  problemDescription: string; serviceType: ServiceType;
  quotedPrice: Money; assignedTechnician: TechnicianRef;
  adminNotes: string | null; status: OrderStatus;
  createdByAccountId: string; createdAt: string;
  assignedByAccountId: string; assignedAt: string;
};
type DraftRecord = {
  id: string; version: number; fields: DraftFields;
  createdAt: string; lastSavedAt: string;
  proposedTechnician: (TechnicianRef & { isActive: boolean }) | null;
  lifecycle: { state: 'active' } | {
    state: 'submitted'; orderId: string; orderNumber: string; submittedAt: string;
  };
};
```

Draft creator is derived backend-side and not needed in private editor DTO. Submitted draft content is retained but not rendered as editable; draft GET may return fields to its creator only. Final creator/assignment metadata is distinct from draft creator/save metadata: an order's createdAt/assignedAt are submission time, not draft first-save time. API actor references expose UUIDs, not account email/hash/session.

Display maps: installation -> Installation, servicing -> Servicing, repair -> Repair; assigned -> Assigned. Seed IDs: Ali 10000000-0000-4000-8000-000000000001; John ...0002; Bala ...0003; Yusoff ...0004 (full same prefix, final twelve digits 000000000002/3/4). Migration must spell all IDs in full and seed idempotently by ID, not by mutable names. No technician is a session account.

Spec 2 OrderSummary is Pick<ServiceOrder, 'id'|'orderNumber'|'customerName'|'serviceType'|'assignedTechnician'|'quotedPrice'|'status'|'createdAt'>. DraftSummary is:

```ts
type DraftSummary = {
  id: string;
  customerName: string | null; // trim saved value; blank -> null
  serviceType: ServiceType | null;
  proposedTechnician: TechnicianRef | null; // may be inactive; not an assignment
  quotedPrice: {kind:'missing'} | {kind:'incomplete'} | ({kind:'money'} & Money);
  lastSavedAt: string;
};
```

Primary label: customerName ?? 'Untitled draft'. Null summary service/technician shows Not provided; incomplete price shows Incomplete price. Summary excludes version/full payload/actors. Technician names are current referenced display names, not immutable historical snapshots; no rename UI is in scope. Resume link builder is draftEditPath(id) -> `/drafts/${id}/edit` after UUID validation.

## API Conventions and Contracts

All endpoints require active admin, Spec 1 no-store/errors/request IDs; mutations
require exact origin, JSON and X-CSRF-Protection: 1. Body limit is 192 KiB
(196608 UTF-8 bytes), including DELETE JSON. The largest field set is 12282
code points; escaped supplementary Unicode can require 12 ASCII bytes per point
(147384 bytes), plus bounded keys/envelope/UUID/version well below 1 KiB.
This also covers six-byte BMP escapes, escaped controls and CRLF within the
raw bounds. Enforce raw text code-point bounds before LF normalization as well
as normalized bounds; do not permit arbitrary padding. Reject compressed request
bodies (unsupported Content-Encoding) with 415; count actual received bytes,
including chunked bodies, independent of Content-Length. Test maximum fields
with literal four-byte Unicode, surrogate-pair JSON escapes, BMP escapes and
CRLF, exact 196608-byte admission then schema validation, and 196609-byte 413.
Body admission is not semantic acceptance. No automatic mutation retries.
Protected read endpoints have no business side effects.

Every mutation requires `Idempotency-Key: <UUID v4>` generated with browser crypto.randomUUID(), not timestamps/random Math.random. Missing/invalid key is 400 MALFORMED_REQUEST. One account-wide key namespace spans all five operations; reusing a key across routes/operations conflicts. Keys are not credentials. Never accept actor, order number, status, currency, or server timestamps in input. GETs reject unknown query parameters. Standard common errors/statuses from Spec 1 apply, including 401, 403, 413, 415, 429 if infrastructure applies, 500/503. No new domain rate limiter.

### GET /api/technicians

200 `{ "data": { "technicians": [{"id":"10000000-0000-4000-8000-000000000001","name":"Ali"}] } }`. Return all active technicians in deterministic display_name then id ascending order; no pagination for four seeds. Empty is 200 with empty array, not 404. No body/query. Failure has persistent Retry, not a fabricated fallback list. Fetch on editor entry/recovery; no polling. Backend validates selected reference again in mutation transaction.

### Request Shapes

```ts
type DraftWriteRequest = { fields: DraftFields };
type DraftUpdateRequest = { expectedVersion: number; fields: DraftFields };
type DraftDeleteRequest = { expectedVersion: number };
type CreateOrderRequest = { fields: OrderFields };
type SubmitDraftRequest = { expectedVersion: number; fields: OrderFields };
```

expectedVersion accepts every integer 1..2147483647. Draft version starts 1;
successful save/submission increments once. Only save/submit at the maximum
current matching version returns 409 VERSION_EXHAUSTED, never overflow/wrap.
Delete at maximum version is allowed because it does not increment. Check
ownership/lifecycle/version before exhaustion, and receipt replay before all
these checks. Same-key replay never increments. Unchanged API saves increment
once even though UI avoids them. Test maximum version load, save, submit, delete
and historical replay plus out-of-range/noninteger request rejection.

### Draft Endpoints

| Endpoint | Success | Notes |
| --- | --- | --- |
| POST /api/drafts | 201 DraftSavedResult | New UUID generated server-side; no client draft ID |
| GET /api/drafts/:draftId | 200 `{data:DraftRecord}` | Creator predicate in SQL; submitted is returned, not 404 |
| PUT /api/drafts/:draftId | 200 DraftSavedResult | Complete replacement fields; expectedVersion required |
| DELETE /api/drafts/:draftId | 200 DraftDeletedResult | JSON body carries version; deliberate metadata response for reconciliation |
| POST /api/drafts/:draftId/submit | 201 OrderCreatedResult | Current form OrderFields plus expectedVersion |

GET /api/drafts listing belongs exclusively to Spec 2. DraftSavedResult is `{draftId,version,savedAt}`. DraftDeletedResult is `{draftId,deleted:true}`. All success bodies use `{data:result}`. Save responses intentionally contain no echoed customer fields: captured request is the acknowledged saved baseline, and receipt replays remain minimal. New save sets createdAt=lastSavedAt=savedAt; later save preserves createdAt. On replay savedAt/version are original, not current. UI loads latest draft before further mutations after a reconciled/replayed save; if later state differs, handle conflict/submitted/deleted rather than resetting its version blindly.

Own/foreign/missing draft access: nonowner/missing both 404 NOT_FOUND, message Draft not found. On write, check ownership before disclosing version/lifecycle. Stale active version: 409 DRAFT_VERSION_CONFLICT, message This draft changed in another tab. Reload it or save your changes as a separate draft. No fieldErrors; GET current owned record for comparison. Submitted draft on save/delete/different-key submit: 409 DRAFT_ALREADY_SUBMITTED; same non-field error convention, followed by GET for owned order link. Check submitted state before expected-version mismatch. Exact successful submit replay returns its original success regardless of subsequent draft state.

### POST /api/service-orders

Direct creation uses CreateOrderRequest and returns 201 `{data:OrderCreatedResult}`. Spec 2 owns GET /api/service-orders; no route collision. OrderCreatedResult is `{orderId,orderNumber,createdAt}`. It is a confirmed creation receipt, not a replacement for fetching detail. Both create endpoints return this same shape. Exact replay returns original 201/result, not a newly constructed order number or timestamp.

Synthetic create request:

```json
{"fields":{"customerName":"Demo Customer A","phone":"+60 12 345 6789","address":"12 Demo Street\nShah Alam","problemDescription":"Air conditioner is not cooling.","serviceType":"repair","quotedPrice":"150.00","assignedTechnicianId":"10000000-0000-4000-8000-000000000001","adminNotes":null}}
```

Synthetic confirmed result:

```json
{"data":{"orderId":"30000000-0000-4000-8000-000000000001","orderNumber":"SO-000001","createdAt":"2026-10-23T07:40:00.000Z"}}
```

Synthetic incomplete draft create request and result:

```json
{"fields":{"customerName":"Demo Customer A","phone":"+60","address":"","problemDescription":"","serviceType":null,"quotedPriceInput":"12.","assignedTechnicianId":null,"adminNotes":""}}
```

```json
{"data":{"draftId":"20000000-0000-4000-8000-000000000001","version":1,"savedAt":"2026-10-23T07:40:00.000Z"}}
```

Synthetic submit body wraps the create fields above with expectedVersion:1. Synthetic draft GET shape:

```json
{"data":{"id":"20000000-0000-4000-8000-000000000001","version":1,"fields":{"customerName":"Demo Customer A","phone":"+60","address":"","problemDescription":"","serviceType":null,"quotedPriceInput":"12.","assignedTechnicianId":null,"adminNotes":""},"createdAt":"2026-10-23T07:40:00.000Z","lastSavedAt":"2026-10-23T07:40:00.000Z","proposedTechnician":null,"lifecycle":{"state":"active"}}}
```

### GET /api/order-editor-operations/:operationKey

Read-only reconciliation; UUID v4 key, no query/body. Scope query by Actor.accountId, never client creator. Always 200 for a structurally valid key whether unknown or owned completed; another account's receipt is indistinguishable from unknown. No pending receipt is published.

```ts
type OperationCheck =
  | {state:'not_found'}
  | {state:'completed'; operation:'createDraft'; targetDraftId:null; result:DraftSavedResult}
  | {state:'completed'; operation:'saveDraft'; targetDraftId:string; result:DraftSavedResult}
  | {state:'completed'; operation:'deleteDraft'; targetDraftId:string; result:DraftDeletedResult}
  | {state:'completed'; operation:'createOrder'; targetDraftId:null; result:OrderCreatedResult}
  | {state:'completed'; operation:'submitDraft'; targetDraftId:string; result:OrderCreatedResult};
```

Envelope is `{data:OperationCheck}`. not_found means no committed visible receipt at read time, not guaranteed nonexecution. Reconcile successful draft saves by GET current draft: original save metadata remains true even if now deleted/submitted/newer. Completed deletes return to newest My drafts; completed order operations navigate to detail. An operation type/target mismatch against local captured intent is a client consistency error: do not mutate/navigate blindly; retain state and show a safe error.

### Errors and Exact Mapping

422 VALIDATION_ERROR uses Spec 1 message Check the highlighted fields. and fieldErrors. For fields nested under fields in requests, error keys remain flat control names, not `fields.customerName`. `_form` carries blank-draft error. Invalid service value is serviceType; absent/nonexistent/inactive selected reference is assignedTechnicianId. Body/version structure errors use 400 MALFORMED_REQUEST; validly structured but semantically invalid fields use 422. Wrong/null field types are 422; malformed JSON/missing fields object/unknown envelope fields are 400. UUID syntax for technician field is 422; route/key UUID syntax is 400.

```json
{"error":{"code":"VALIDATION_ERROR","message":"Check the highlighted fields.","fieldErrors":{"quotedPrice":["Enter a price from MYR 0.00 to MYR 999,999.99 with at most two decimal places."]},"requestId":"40000000-0000-4000-8000-000000000001"}}
```

409 IDEMPOTENCY_CONFLICT: This request key was already used for a different request. No fieldErrors. Do not automatically replace its key and resubmit. A known rolled-back lock timeout returns 409 OPERATION_BUSY with message This operation is still being processed. Check its result or retry the same request. It does not prove another attempt failed. Unexpected SQL errors are sanitized 500/503 and considered uncertain by the client. No SQL/constraint names/customer values are exposed or logged.

### Discriminated Conflict Actions

`conflict` is a union keyed by code, retaining captured local work; do not expose
one generic Reload/Save separately dialog for every 409.

| Discriminator | Safe actions |
| --- | --- |
| DRAFT_VERSION_CONFLICT | GET latest owned draft; explicit discard-confirmed reload or new-key separate draft; no force overwrite |
| DRAFT_ALREADY_SUBMITTED | GET owned draft, View order; local unsaved fields may explicitly become separate draft after original uncertainty resolved; never retry submission with new key |
| VERSION_EXHAUSTED | Explain draft cannot be saved/submitted further; explicit separate draft or expected-version deletion with confirmation; no retry increment |
| OPERATION_BUSY | Keep original key/body frozen; Check result or explicit exact same-key retry; no reload/discard/separate mutation while uncertain |
| IDEMPOTENCY_CONFLICT | Freeze intent, Check result; do not auto replace key or offer overwrite. A matching operation/target receipt may establish historical completion only; do not claim conflicting local fields were saved. Preserve them for deliberate separate work after review/discard |
| RECONCILIATION_MISMATCH (local, not API code) | Receipt operation/target differs from captured intent: retain input/key, block apply/navigation/writes, allow read-only check retry or guarded leave. Never treat another result as this submission's success |

All errors have persistent actionable feedback, no fieldErrors on these conflicts.
Busy/uncertain and mismatch states cannot silently unlock a new logical mutation.
Keep key-conflict/mismatch discrimination sticky in editor/recovery state through
GET retries and auth suspension. In these states, generic completed-receipt
handling cannot reset baseline, clear input or create a success handoff.
For IDEMPOTENCY_CONFLICT a matching type/target proves only the earlier key's
historical result, not payload equality (fingerprint is private). Show an explicit
View earlier order/read current draft action, no creation banner for the
conflicting intent; deliberate discard/review is required before separate work.
A mismatch remains blocked until guarded leave/discard; no mutation-based repair.
Test conflict recovery across same-account login, not just immediate UI.
VERSION_EXHAUSTED message is `This draft has reached its version limit. Save
your changes as a separate draft or delete this draft.` No mutation/receipt is
written on this rejection. Test each conflict discriminator independently, with
local input preservation, permitted/forbidden actions and no automatic new key.

## Database Schema and Migration Ownership

Spec 3 owns db/migrations/002_service_orders_and_drafts.sql after Spec 1's 001_auth.sql. Spec 2 must not create duplicate tables/indexes. Use app_private, migration-owner credentials, and minimum runtime-role grants following Spec 1. No browser/anon/authenticated grants; no dependence on auth.uid(). Database defaults use trusted UUID generation (Postgres gen_random_uuid); verify availability, do not silently install extensions into shared environments.

All text is PostgreSQL text with explicit char_length bounds; all input text columns reject chr(0) implicitly through Postgres and application validation. Final required text has nonblank/edge-whitespace checks and phone [0-9] check; enum/range/FK/null invariants are database-enforced as well as application-validated. Draft text can be empty, never null; nullable selects represent absence. Use a local SQL helper/check expression for agreed whitespace if necessary, not a generic domain framework. Reject CR in persisted normalized multiline fields; server LF normalization is authoritative. Database checks should not silently trim.

Add a draft CHECK requiring at least one nonblank text field or nonnull select, using the same explicit whitespace set as validation. The whitespace set for final edge checks and draft nonblank checks is ECMAScript trim: U+0009..000D, U+0020, U+00A0, U+1680, U+2000..200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF. Unicode test fixtures must verify parity between JavaScript and SQL; default SQL btrim alone is not sufficient. Active-technician eligibility is transaction validation, not a CHECK that falsely claims to inspect another table.

| Table / object | Columns and constraints |
| --- | --- |
| technicians | id uuid PK; display_name text NOT NULL CHECK nonblank and <=100; is_active boolean NOT NULL DEFAULT true |
| service_order_number_seq | bigint sequence START 1, NO CYCLE; owned by order_number_value column; gaps accepted |
| service_orders | id uuid PK DEFAULT gen_random_uuid(); order_number_value bigint NOT NULL DEFAULT nextval(...) UNIQUE CHECK >0; customer_name, phone, address, problem_description, service_type, quoted_price_sen, currency, assigned_technician_id, admin_notes with matrix constraints; status text NOT NULL DEFAULT 'assigned' CHECK ='assigned'; created_by_account_id uuid NOT NULL FK accounts ON DELETE RESTRICT; assigned_by_account_id uuid NOT NULL FK accounts ON DELETE RESTRICT; created_at timestamptz NOT NULL DEFAULT now(); assigned_at timestamptz NOT NULL DEFAULT now(); source_draft_id uuid nullable UNIQUE FK service_order_drafts ON DELETE RESTRICT |
| service_order_drafts | id uuid PK DEFAULT gen_random_uuid(); creator_account_id uuid NOT NULL FK accounts ON DELETE RESTRICT; version integer NOT NULL DEFAULT 1 CHECK >0; eight draft columns from matrix; created_at timestamptz NOT NULL DEFAULT now(); last_saved_at timestamptz NOT NULL DEFAULT now(); submitted_order_id uuid nullable UNIQUE FK service_orders ON DELETE RESTRICT; submitted_at timestamptz nullable; CHECK both submitted columns null or both nonnull |
| order_editor_operations | account_id uuid NOT NULL FK accounts ON DELETE RESTRICT; operation_key uuid NOT NULL; operation_type text NOT NULL CHECK five operation names; target_draft_id uuid nullable; request_fingerprint bytea NOT NULL CHECK octet_length=32; result_draft_id uuid nullable; result_version integer nullable; result_order_id uuid nullable FK service_orders ON DELETE RESTRICT; result_order_number_value bigint nullable; result_timestamp timestamptz NOT NULL; PRIMARY KEY(account_id,operation_key); CHECK result column shape matches operation type |

Create drafts before orders without submitted_order_id FK, then orders, then add draft submitted FK; all within migration transaction. Operations target/result draft IDs intentionally have no FK so receipt survives active-draft deletion. Save receipt contains version and saved time; delete receipt contains draft ID and deletion timestamp; order receipt contains order ID, number value and creation timestamp. No request body, customer text, technician selection, or full response snapshots in receipt. Fingerprint is not anonymization of guessable input; it remains private metadata and is never returned by APIs.

service_orders checks created_by_account_id=assigned_by_account_id and created_at=assigned_at for this creation-only scope. Insert using one database-captured mutation timestamp for both. Source draft uniqueness backs one-order-per-draft even if application code races. Cross-table source/submitted link equality is set atomically by domain code and verified by integration tests; do not claim a plain FK alone enforces bidirectional consistency. No other runtime code path may write these columns. Add result-shape checks: create/save draft has result_draft_id and positive result_version, no order result; delete has draft result ID but no version/order; create/submit order has order ID/positive number, no save-version result. All receipts have server timestamp. Draft result ID equals target for save/delete; submit target is nonnull; direct/createDraft target is null.

Expose orderNumber by pure formatting from unique order_number_value: `SO-` plus digits padded to minimum six, never PostgreSQL lpad(value,6,'0') without guarding width (lpad truncates longer values). SQL projection uses lpad(value::text, greatest(6,length(value::text)), '0'). No separately editable number string. Sequence bigint travels as pg string for formatting; never convert unbounded bigint to JS Number. Sequence exhaustion is a persistence error, never wrap/reuse.

Indexes: service_orders(created_at DESC,id DESC); partial service_order_drafts(creator_account_id,last_saved_at DESC,id DESC) WHERE submitted_order_id IS NULL; service_orders(assigned_technician_id), service_orders(created_by_account_id), service_orders(assigned_by_account_id); drafts(proposed_technician_id); operations(result_order_id). PK/UNIQUE provide receipt lookup, number uniqueness, source/submitted links. Draft partial index does not cover submitted rows; add drafts(creator_account_id) for owner FK/history queries. Avoid redundant indexes on unique columns. Runtime grants SELECT/INSERT orders and receipts, SELECT/INSERT/UPDATE/DELETE drafts, SELECT technicians, and sequence USAGE; no order UPDATE/DELETE, no receipt UPDATE/DELETE, no technician writes. Migration-owner seeds technicians. Account hard-deletion remains excluded.

### Restricted Technician Lock Function

Postgres row-locking SELECT requires UPDATE privilege, so runtime must not issue
technician SELECT FOR SHARE directly. Migration 002 creates
`app_private.lock_active_technician(p_id uuid) RETURNS boolean`, LANGUAGE plpgsql,
VOLATILE SECURITY DEFINER, SET search_path = pg_catalog. Its fixed body selects
`t.is_active INTO v_active FROM app_private.technicians AS t WHERE t.id=p_id
FOR SHARE` and returns `COALESCE(v_active,false)`. Lock the row even when inactive;
missing returns false. No dynamic SQL, arbitrary relation/column input, writes,
commit, actor inference or public API exposure. All relation references are schema
qualified and builtins resolve in pg_catalog. Caller separately authorizes admin.

Exact function definition (migration also applies the ownership/grants below):

```sql
CREATE FUNCTION app_private.lock_active_technician(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_active boolean;
BEGIN
  SELECT t.is_active INTO v_active
  FROM app_private.technicians AS t
  WHERE t.id = p_id
  FOR SHARE;
  RETURN COALESCE(v_active, false);
END;
$$;
```

Owner is dedicated NOLOGIN NOSUPERUSER NOBYPASSRLS role
`app_technician_lock_owner`, with USAGE app_private and SELECT plus column-level
UPDATE(is_active) on technicians solely to permit row locking; it owns no table
or schema, has no CREATE/schema, other domain or account privileges. Migration
role creates/transfers function ownership using provisioning permissions, then
revokes temporary CREATE/membership privileges. Runtime has no membership in
this owner and no SET ROLE path. Revoke EXECUTE from PUBLIC, anon, authenticated
and any default-grant roles in the same migration transaction; grant EXECUTE on
this exact uuid signature only to `app_runtime`. Runtime retains SELECT only on
technicians. app_private is not PostgREST exposed. Trusted operator deactivation
uses UPDATE is_active on the same row (no delete/reinsert), which conflicts with
FOR SHARE and waits until caller transaction commits/rolls back. Function locks
persist in the caller's transaction, not merely through function return. Invoke
only after draft lock and after receipt replay check, on the same PoolClient.

Restricted-role tests SET ROLE app_runtime: helper succeeds in a transaction,
direct SELECT FOR SHARE and INSERT/UPDATE/DELETE fail, owner role cannot be
assumed, PUBLIC/anon/authenticated cannot execute. Two real connections verify
deactivation waits through helper return until commit/rollback; if deactivation
wins first, helper returns false. Check search_path hijacking cannot redirect
relations, and exact receipt replay after deactivation bypasses the helper.

Operational draft fields/creator/created_at are not updated after submission. Saved draft lifecycle is derived from submitted_order_id, not an ambiguous order status column. Orders id/created_at are immutable; draft id/creator/created_at immutable, last_saved_at changes only on manual save; submission increments version and sets submitted_at but preserves last_saved_at (it is no longer listed). After acquiring locks and validating, capture clock_timestamp() once in Postgres for the mutation and explicitly use it for changed timestamps and receipt result_timestamp; order creation/assignment and draft submission share this value. Defaults are safeguards, not frontend timestamp inputs. Do not use transaction-start now() for a save that waited on a lock: a later winning save could otherwise move last_saved_at backwards. Serialize DTOs to milliseconds; Spec 2 cursors use exact database precision. Wall-clock adjustments remain an infrastructure limitation, not a strict monotonic-clock promise.

### Narrow Listing Projections for Spec 2

Orders select required summary columns from service_orders INNER JOIN technicians. Drafts select id/customer_name/service_type/proposed_technician_id/quoted_price_input/last_saved_at with LEFT JOIN technicians, WHERE creator_account_id=$actor AND submitted_order_id IS NULL before pagination. Raw price is selected backend-side only for summary parsing, not returned; no full draft payload or phone/address/notes needed. Trim customer name in shared projection helper. Final order technician is nonnull; draft technician nullable and may be inactive, so never INNER JOIN active-only technicians for drafts.

Ordering/index predicates are exactly Spec 2's timestamp/UUID descending keysets. Saves can move drafts between pages; accepted no-snapshot semantics. No number/status filters are used to detect drafts.

## Transactions, Idempotency, and Reconciliation

### Keys and Payload Identity

Generate one UUID v4 when a user explicitly starts a logical mutation after client validation. Reuse its captured body/key for transport retries and reauthentication. A corrected request after definitive 422, a conflict-resolved separate draft, or a new manual save is a new logical mutation with a fresh key. Never replace a key merely due to timeouts, 500/503, auth expiry, or not_found reconciliation. No initial receipt expiry or scheduled cleanup; account-scoped receipts live indefinitely, including after draft deletion.

Fingerprint is SHA-256 over UTF-8 deterministic JSON of `{contractVersion:1,operation,targetDraftId,expectedVersion,fields}` with fixed property order, explicit nulls and no unknown fields. Omit absent concepts only by fixed contract (use null expectedVersion/fields for operations that lack them). For draft operations fields are LF-normalized raw draft strings/nulls, preserving whitespace; delete fields=null. For order operations fields are final normalized strings, canonical fixed-scale quotedPrice, and null notes. Thus semantic final equivalents (12 versus 12.00, trimmed customer edges) replay; different draft whitespace, version, target, operation, technician, or meaningful final text conflicts. Never include cookies/session token/key in the fingerprint. Store only digest, not full payload. Syntax/type/bound validation needed for canonicalization runs before receipt lookup; successful replay bypasses later current technician/lifecycle/version validation. Keep contractVersion=1 behavior stable for retained receipts; future changes require explicit migration/version compatibility design.

Serialize using JSON.stringify on a freshly built object in the displayed outer
property order, with fields in DraftFields/OrderFields declaration order (one
property per declaration, left to right); lowercase all UUIDs first. Never hash
client key order or undefined. Advisory key is the first eight digest bytes of
UTF-8 `${accountId}:${operationKey}` (lowercase UUIDs), SHA-256, read as signed
big-endian int64; pass its decimal string to pg_advisory_xact_lock(bigint).

### Mutation Algorithm

All writes use one pg PoolClient transaction. Use READ COMMITTED, bounded database statement/lock timeouts (initially lock_timeout 5s, statement_timeout 15s scoped SET LOCAL), rollback on any failure, and always release client. No external side effects inside transaction.

1. Enforce shared Origin/header/media/encoding/body-byte and JSON framing safety
   first (these transport errors may precede auth). Run shared requireAdmin before
   route/key/version/field domain validation, so unauthenticated invalid domain
   requests yield 401/403, not field/existence information. Then strict structure,
   types, Unicode/raw bounds, normalization and pure semantic validation produce
   the canonical fingerprint. Start transaction and call Spec 1 authorizeAdmin
   on this PoolClient again before receipt/domain queries. Do not perform mutable
   eligibility, ownership/version or technician checks during canonicalization.
2. Acquire the transaction-scoped advisory lock using the exact derivation above.
   Hash collisions cause extra serialization, never replace exact PK lookup.
   Same algorithm across API instances; lock releases on commit/rollback.
3. SELECT receipt by exact account/key. If present, compare fingerprint and operation/target; mismatch -> 409 IDEMPOTENCY_CONFLICT, no writes. Match -> return stored original result/status after transaction completes. Replay is authorized even if target draft was deleted or selected technician deactivated; never recreate missing draft.
4. For targeted drafts, SELECT ... WHERE id=$id AND creator_account_id=$actor FOR UPDATE. No row -> 404. If submitted -> DRAFT_ALREADY_SUBMITTED (exact replay already returned). Check expected version, then exhaustion only for save/submit. No successful receipt on rejection.
5. If selected technician is nonnull, call app_private.lock_active_technician($id)
   on this client. False ->422 assignedTechnicianId. Lock lasts until commit.
   Never direct runtime SELECT FOR SHARE or general technician UPDATE grants.
   No technician lock before draft lock; null selection/delete needs none.
6. Capture the database mutation timestamp after locks/validation. Perform exactly the domain mutation: createDraft INSERT; saveDraft UPDATE full fields/version/time; deleteDraft DELETE; createOrder INSERT complete order; submitDraft INSERT order with source_draft_id then UPDATE locked draft with submitted link/time/version. Submit does not first persist current edited draft fields or create a separate assignment row. The submitted order is authoritative for final submitted values; retained draft fields remain last manually saved values.
7. INSERT successful operation receipt with original result metadata in the same transaction. Uniqueness/check/FK failures roll back all domain and receipt writes. For submit, order and draft link cannot partially commit.
8. COMMIT before sending success. Only committed receipt/result is reconciliable. A commit-acknowledgment loss is uncertain, not guaranteed rollback. Do not send 201 before commit.

Account activity/session validity is checked within the transaction at authorization time. Do not lock actor accounts or promise serialization against operator revocation; Spec 1 permits already-authorized requests to finish. Expiry/revocation after authorization does not retroactively cancel writes. Session cookies never supply actor fields; created/assigned actor always equals resolved accountId.

Concurrent identical keys serialize at advisory lock: winner commits; waiter at READ COMMITTED sees receipt and replays. Winner rollback leaves no receipt; waiter may execute the original mutation. Lock timeout rolls back this attempt and returns OPERATION_BUSY; later check/retry uses same key. Different keys on the same draft serialize at its row lock: one changes version/submits/deletes; another sees current committed version/lifecycle/missing state and cannot silently overwrite. Different keys on a never-saved form intentionally represent distinct orders; no customer-data uniqueness heuristic.

Reconciliation reads committed receipts only and does not create receipts, renew sessions, or mutate drafts. Do not publish pending rows with expired leases: no lease/reaper framework is needed. A repeated successful draft save returns its original version; current-draft GET determines what can be edited now. Deleting active drafts does not delete receipts; submitted drafts and their order links remain retained. Successful delete replay returns original deleted:true even when row absent; a new unrelated delete key against missing row is 404.

### Failure Matrix

| Failure | Persistence and UI |
| --- | --- |
| Client validation | No request/key dispatch; preserve values, focus error |
| Backend 422 | Transaction rollback, no receipt/order/draft changes; preserve values, correction/new attempt allowed |
| FK/check/insert/receipt failure | Entire transaction rollback if known; sanitized error; client conservatively reconciles if server outcome uncertain |
| Stale version | No mutation; preserve values; explicit reload or separate draft |
| Same key changed payload | No mutation; show conflict; do not automatically assign new key |
| Concurrent draft submission | Only one order; loser gets already-submitted or exact replay; GET draft reveals saved order link |
| Response lost after commit | Receipt/order persist; Check result or same-key retry returns original result |
| Session expires before authorization | 401 and no mutation for that attempt; memory recovery, no auto replay |
| Session expires after authorized request | Request may commit; recovery must reconcile original key |
| Draft deleted after successful save response lost | Save receipt proves historical success; draft GET 404, no accidental recreation |
| Database unavailable during read/check | Persistent Retry, no false missing/expired/saved claim |

## Creation Confirmation and Spec 4 Handoff

Navigate with replacement to `/orders/${orderId}` and memory-only navigation context `{creationConfirmation:{orderId,orderNumber,createdAt},returnIntent:'newestOrders'}` only from a confirmed create result/receipt. Keep this context in a tab-local in-memory handoff store keyed by orderId, not React Router's serialized history.state (which can survive reload). Spec 4 consumes it into mounted page memory; full reload clears it. No success query flag, timer dialog, optimistic order object, or draft list row substitutes for persistence.

Spec 4 independently fetches saved order by UUID through its authenticated API. After successful load and equality of ID/number with confirmation, show persistent polite status Order SO-000001 created successfully. If detail load fails, explain Order SO-000001 was created, but its details could not be loaded. Retry loading; never offer create-again. If returned record mismatches confirmation, suppress creation banner and show safe consistency feedback. Confirmation state is memory-only, cleared on logout/account change, and consumed into mounted detail state; reload/bookmark has no banner. Detail still works without it. Focus destination h1 and announce success without competing focus moves.

Spec 4 accepts this interface and additionally compares createdAt. Spec 3 calls
rememberCreatedOrder(binding,receipt) before replacement navigation; Spec 4 owns
the function/store. Explicit Service orders requests fresh page one. Existing
detail uses Spec 2's account-bound opaque context key, never serialized context.
No URL establishes confirmation or authorization.

## Concrete Modules and Function Contracts

Use Spec 1 foundation paths; no generic repository/service/workflow layers. Functions below may share one cohesive module if small. Domain modules never import browser code, and browser modules never import pg/server helpers.

| File | Responsibilities, signatures, effects |
| --- | --- |
| packages/contracts/src/service-orders.ts | ServiceType/OrderStatus/Money/OrderFields/ServiceOrder/OrderCreatedResult; enum maps and pure parsePrice(input): validated sen/canonical amount or field error; formatMoney(Money): string; no I/O |
| packages/contracts/src/drafts.ts | DraftFields/Record/save/delete/check/request/recovery types; pure draftEditPath, deriveDraftPriceSummary, deriveDraftLabel; strict recovery validator |
| apps/api/src/order-editor/validation.ts | normalizeDraftFields(unknown): DraftFields; normalizeOrderFields(unknown): normalized fields plus quotedPriceSen; throws typed field errors; no DB access; draft nonblank enforcement |
| apps/api/src/order-editor/operations.ts | fingerprintOperation(intent): Buffer; executeEditorMutation(client,actor,intent,key): Promise<typed result>; transaction-scoped key lock, receipt lookup, draft row/version checks, writes and receipt insert; assumes active transaction/authenticated Actor; no COMMIT or response |
| apps/api/src/order-editor/queries.ts | listSelectableTechnicians(db): Promise<TechnicianRef[]>; loadOwnedDraft(db,actor,id): Promise<DraftRecord>; checkOwnedOperation(db,actor,key): Promise<OperationCheck>; parameterized narrow queries, typed not-found; no mutation |
| apps/api/src/order-editor/routes.ts | registerOrderEditorRoutes(app): void; all endpoints above, transaction lifetime plus in-transaction shared authorization, validation/CSRF hooks, response mapping/status; never shadow listing GET routes |
| apps/web/src/api/order-editor.ts | fetchTechnicians(signal), fetchDraft(id,signal), checkOperation(key,signal); createDraft/saveDraft/deleteDraft/createOrder/submitDraft take explicit captured body/key; shared apiRequest; no retries or key generation inside wrappers |
| apps/web/src/order-editor/state.ts | typed reducer/state transitions, baseline/dirty comparison, immutable pending capture; no network side effects |
| apps/web/src/order-editor/recovery.ts | capture/validate/restore typed payload through Spec 1 RecoveryStore; memory only, account bound; does not submit |
| apps/web/src/order-editor/OrderForm.tsx | accessible grouped fields, price raw text, field errors, actions/loading; controlled data and events, no DB/auth implementation |
| apps/web/src/pages/CreateOrderPage.tsx | new/draft mode based on route; orchestrates reads/mutations/reconciliation/conflicts and success navigation; may use a small editor hook if needed, not required |
| apps/web/src/order-editor/navigation.ts | dirty/pending guard integration with shared router/logout; accessible confirmations and native beforeunload registration |
| db/migrations/002_service_orders_and_drafts.sql | domain schema, seeds, checks, grants, sequence, indexes only |

Typed results: DraftSavedResult `{draftId:string,version:number,savedAt:string}`; DraftDeletedResult `{draftId:string,deleted:true}`; OrderCreatedResult `{orderId:string,orderNumber:string,createdAt:string}`. executeEditorMutation returns result plus original HTTP status/operation discriminator; handlers unwrap/serialize once through shared conventions. Use errors.ts mapping for typed validation/not-found/conflict/busy/unavailable errors; no separate error envelope. Pure client validation reuses browser-safe rules where practical, but backend remains authoritative.

Use Spec 1 authorizeAdmin(client,token) and shared cookie-neutral error mapping inside
transactions, plus requireAdmin before domain validation. apiRequest<T> already
returns unwrapped data. Router/logout guards and lifecycle are Spec 1 interfaces.
Editor routes never emit Set-Cookie, including preliminary/transactional 401/403.
Logout revokes only its presented session; frontend state clearing cannot cancel
another tab's concurrent login or browser cookie response processing.

## Verification Plan

All data is synthetic. Integration tests use isolated configured Postgres and at least two independent connections/API instances, not mocked queries for transaction claims. Never reset a shared/production database.

### Unit Tests

- Each required final field rejects empty/whitespace/null; optional blank notes -> null. Unicode code points at limit pass; limit+1 and unpaired surrogates/NUL reject. CRLF/CR normalize; internal spaces/newlines survive; leading/trailing agreed whitespace trims.
- Phone +60, leading zero, punctuation/internal spaces accepted if digit exists; alphabet-only fails. No numeric coercion or country-specific rejection.
- Price 0, 0.00, 12, 12.5, 00012.50 and 999999.99 yield exact expected sen/strings. Negative/exponent/commas/.5/12./three decimals/1000000 reject. Large leading-zero input bounded. Round trip all boundary sen values without floats.
- Draft partial phone/price and empty fields pass; wholly blank fails; selected enum counts as nonblank. Missing/invalid types, unknown keys, invalid enum/UUID reject. Draft whitespace preserved; summary blank/money/incomplete states match exact display labels.
- Fingerprint deterministic property order; normalized final equivalents match; draft raw differences, version/target/operation changes differ. Keys are not regenerated during timeout/recovery/retry; new corrected logical operation uses a fresh key.
- State transitions freeze attempted body, preserve fields/baseline/key during uncertainty/401, refuse competing mutations, handle not_found without false failure, and ignore stale account-generation callbacks.
- Recovery validator checks bounds/discriminators/UUIDs/route compatibility; mismatched account or invalid schema clears snapshot. No browser persistence call exists.
- Number formatting 1 -> SO-000001, 999999 -> SO-999999, 1000000 -> SO-1000000; bigint beyond JS safe integer retains exact digits.

### Database and API Integration Tests

- Bypass React: directly POST incomplete final data, forged actor/status/number fields, invalid precision, >max money, nonexistent/inactive technician, oversize text/body, and unknown properties. Expect documented 400/413/422; no order, draft mutation, or successful receipt.
- Anonymous/expired/inactive ->401; active nonadmin ->403. Missing/bad Origin/header/content type cannot mutate. All endpoints return no-store/request IDs and sanitized errors. Database outage is not 401 or empty data.
- With valid transport/JSON framing, unauthorized invalid fields/route/key/version
  return auth errors before domain validation. Revocation between preliminary and
  transaction auth denies receipt lookup/writes. Matched replay at maximum version,
  after submission/deletion and technician deactivation bypasses mutable checks.
  Body-byte/encoding errors may precede auth but never perform domain queries.
- Two admins cannot load/save/delete/submit each other's drafts; all return indistinguishable 404, no version/lifecycle/receipt disclosure. Foreign operation key checks return not_found. Both may view submitted order through Spec 4 as Spec 2 permits.
- Save incomplete draft: no order row, number sequence untouched, no assignment metadata; creator/time/version correct. Save preserves raw fields. Update increments once, created_at immutable, last_saved_at server-generated. Delete removes content, not receipts. Saved drafts survive logout.
- Direct create returns correct canonical persisted fields, exact sen, assigned status, actor IDs from session, equal creation/assignment timestamps, unique number. No client metadata is trusted.
- Draft submit with edited unsaved fields creates order from current request, retains original last-saved draft fields/time, increments version, sets order link/submitted timestamp, and removes from draft listing. No intermediate save request required.
- Inject failure after order INSERT, after draft link UPDATE, and before/at receipt INSERT: rollback leaves no order, no submitted link/version change, no receipt. Sequence gaps are allowed. Never assert gapless numbering.
- Concurrent distinct creates across two instances yield unique IDs/numbers. Concurrent same-key identical creates/save/submit/delete yield one mutation and identical original results. Same key changed normalized payload/target/operation ->409 and no second write. Same key different accounts is independent.
- Same-key replay after technician deactivation succeeds with original order result. Save replay after later save returns original version; latest GET returns newer version. Save replay after deletion does not recreate row; delete replay stays deleted:true.
- Different-key concurrent saves at one expected version: exactly one wins; other DRAFT_VERSION_CONFLICT, no lost overwrite. Concurrent save/submit/delete respects row lock: only first valid version wins, and submitted draft cannot subsequently mutate. Different-key concurrent submit produces exactly one order even if frontend disabled state bypassed.
- Block same-key winner transaction, issue second connection: waiter does not execute duplicate writes. Commit -> waiter replays; rollback -> waiter may execute. Lock timeout ->OPERATION_BUSY with no partial writes. Reconciliation before commit returns not_found; after commit returns completed.
- Simulate dropped response after commit for every mutation: same-key retry/check confirms original result. Simulate commit acknowledgment uncertainty without assuming rollback. No automatic new key/request from client.
- Auth expiry before transactional authorization produces no mutation; expiry/revocation after authorization may commit, consistent with Spec 1. Recovery uses original key.
- Check grants deny anon/Data API and runtime order UPDATE/DELETE, receipt modification and technician writes. Constraints independently reject null required fields, invalid enums/ranges/FKs/status. Test source_draft uniqueness and order/draft bidirectional application invariant.
- Spec 2 multi-page projections: inactive/null draft technician survives LEFT JOIN; incomplete price is safe; only creator/unsubmitted rows; exact timestamp cursor/index support. No full payload/actor exposure in summaries.

### Browser Tests

- Desktop/mobile complete direct-create and save/resume/submit journeys; required inline errors focus first field, backend-only errors map correctly. Real persisted detail loads after redirect/refresh.
- Technician loading/error/retry/empty states preserve inputs; incomplete technician-free draft can save; final create blocked without selected active technician. Stale selected technician yields actionable inline error, never silently reassigned.
- Save progress prevents duplicate activation; confirmed save stays editor and replaces route first time. Label/last-saved state changes only after confirmation. Unsaved edits after save are visibly unsaved.
- Two-tab conflict retains losing input; reload requires discard confirmation; separate-draft choice creates another draft only by explicit action. Deletion confirm cancellation has no effect; confirmed result returns fresh My drafts. Submitted resume is noneditable with View order.
- Lost responses enter uncertainty, block edits/new mutations, retain exact key/body, support Check result then explicit same-key retry. not_found never triggers blind new submission. Detail fetch failure after confirmed create offers read retry, not create-again.
- Same-account reauthentication restores fields/baseline/draft/version/key/state without automatic mutation; changed saved version opens conflict. Different-account/explicit logout clears memory; saved drafts remain private. Late responses after logout cannot navigate or repopulate data.
- In-app links, browser Back, logout and supported beforeunload warn only when dirty/pending; cancel retains form; clean/success transitions do not warn. Refresh loses memory-only unsaved work, not saved draft.
- Persistent confirmation uses saved order number, appears after matching detail fetch, and disappears on full reload. Explicit Service orders/My drafts actions request newest list pages; ordinary return context behaves per Spec 2.
- Keyboard-only operation, semantic labels/selects, modal focus/Escape restoration, live announcements without duplicates, focus ring/error contrast, reduced motion, 200% zoom, and 360/768/1280/1440 widths without overflow.

## Ordered Small-Agent Tasks and Gates

1. Consume settled ownership/contracts below and Spec 1's integrated acceptance matrix. Foundation precedes domain execution; do not redefine shared helpers or DTOs.
2. After Spec 1 scaffolding, implement domain contracts/price normalization/summary formatters/recovery validation and unit tests. Own packages/contracts/src/service-orders.ts and drafts.ts plus focused tests; coordinate listings imports rather than duplicate types.
3. After 001_auth, implement 002 domain migration/seeds/grants/indexes on dedicated test DB. Own only 002; do not modify an applied migration. Verify numbering boundaries, constraints, privileges and Spec 2 keyset support.
4. Implement backend validation, read queries, fingerprints and transactional mutations/receipts. Own apps/api/src/order-editor/*.ts. Gate completion on rollback, ownership, concurrency, changed-key payload and response-loss integration tests, not only happy-path injections.
5. Register endpoint routes using Spec 1 security and transaction-compatible authorization. Verify exact JSON/status/error examples, request limits, no-store and no secret/PII logging. Coordinate app bootstrap registration with Spec 1; do not shadow Spec 2 GET endpoints.
6. Implement editor API wrappers/state/recovery integration and pure state tests before UI. Own apps/web/src/api/order-editor.ts and order-editor/*; verify no mutation retry inside shared client/wrappers, no new key on expiry, stale-response suppression.
7. Implement grouped accessible form, new/resume page, save/delete/conflict/uncertain flows and navigation guards. Coordinate Spec 1 shared router/logout hook rather than overwrite App/AuthProvider. Gate on RTL and browser failure-flow coverage.
8. Integrate Spec 2 canonical summaries/resume links/fresh-list intents and Spec 4 detail confirmation. Run end-to-end create and draft journeys with real API/test DB; verify submitted/deleted list removal and same-account recovery.
9. Perform consistency/security/accessibility review and run established checks. Record actual results, schema assumptions and deployment-only gaps. Update implementation documentation via assigned owners; no provisioning, deployment, commit or shared-DB mutation is authorized here.

Spec 1 requires future root scripts: npm run build, npm run typecheck, npm run lint, npm run test:unit, npm run test:integration, npm run test:e2e, npm run db:migrate. They do not exist as verified commands in the inspected repository. Run relevant ones only after foundation establishes them and isolated test configuration exists. Verify migrations on a fresh test database and replay migration ledger safely; never invent passing results.

Completion criteria: exact agreed contracts implemented, isolated checks pass, no partial/duplicate same-key writes, creator-only drafts with safe version conflicts, correct money/numbering/actor/timestamps, no success before commit, usable uncertainty/session recovery without replay, accessible responsive workflows, and saved detail independently retrievable. Domain design approval is not proof of implementation or deployment correctness.

## Accepted Cross-Spec Contracts

### Spec 1

- Router/safe-return includes /drafts/:draftId/edit and validated list cursors.
- Spec 3 owns editor/mutations; Spec 2 owns lists; OrderEditorRecoveryV1 is the
  typed payload for no-replay same-account recovery.
- authorizeAdmin(client,token), generation/lifecycle and router/logout guard
  are shared; apiRequest unwraps once. No retroactive revocation promise.
- Idempotency-Key accompanies domain mutations under unchanged CSRF policy.
- Supporting documents reflect real auth/drafts/detail and canonical MYR money.

### Spec 2

- Canonical imports are ServiceType, assigned status, nonnull TechnicianRef,
  Money and DraftSummary above, with Spec 2 property names and pagination.
- Draft price adds Incomplete price, distinct from Not provided; no arbitrary invalid raw amount is rendered or coerced. Customer summary trims to null; no title field.
- Consume app_private.service_orders/service_order_drafts and specified indexes/joins, creator/unsubmitted predicate, last_saved_at semantics, and draftEditPath. Reuse canonical formatters.

Exact order summary fixture for Spec 2:

```json
{"id":"30000000-0000-4000-8000-000000000001","orderNumber":"SO-000001","customerName":"Demo Customer A","serviceType":"repair","assignedTechnician":{"id":"10000000-0000-4000-8000-000000000001","name":"Ali"},"quotedPrice":{"currency":"MYR","amount":"150.00"},"status":"assigned","createdAt":"2026-10-23T07:40:00.000Z"}
```

Exact draft summary fixture for Spec 2:

```json
{"id":"20000000-0000-4000-8000-000000000001","customerName":"Demo Customer A","serviceType":null,"proposedTechnician":null,"quotedPrice":{"kind":"incomplete"},"lastSavedAt":"2026-10-23T07:40:00.000Z"}
```

### Spec 4

- Accept canonical ServiceOrder fields, nonnull technician, assigned status, MYR Money, actor UUIDs and UTC timestamps; use existing restricted backend access and Spec 1 errors.
- Accept order-detail route and memory-only confirmed-creation state/independent load/banner contract, detail-failure messaging and explicit newest-orders return intent.
- Spec 4 does not own draft editing or submitted-draft resume UI. Spec 3 returns an order link for that handoff.

These contracts are integrated into Specs 1, 2 and 4. No business or shared-interface
decision remains open. Implementation and real test execution remain required.

## Consistency Review and Residual Limitations

UI, API and database agree: draft text may be partial, orders may not; selected draft technician is not an assignment; money never persists as float; number comes from DB only on order creation; final actors/time come from backend transaction; draft submit and receipt commit with order; version/key checks cover different concurrency hazards; receipts survive deletion without copying customer content; same-account recovery preserves exact pending request rather than replaying it.

Accepted limitations: indefinite private draft/receipt retention; minimal receipts retain account/target linkage and fingerprints; no lost-key deduplication for never-saved forms after refresh; no gapless numbering; no historical technician-name snapshot; no instant revocation of authorized in-flight work; browser unload warnings/clearing in suspended tabs are best effort; Spec 2 draft pagination is not a snapshot. These are deliberate boundaries, not claims that the workflow is infallible.
