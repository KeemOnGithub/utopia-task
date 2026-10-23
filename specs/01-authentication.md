# Spec 1: Admin Authentication and Session Lifecycle

Status: approved integrated implementation-ready design, not implemented or verified.

## Goal and Scope

Enable individually identified, active admins to authenticate, use protected
Module 1 operations, recover from session expiry, and revoke their session.
Own trusted account provisioning, password verification, throttling, sessions,
authorization, login/logout screens, protected routing, and the shared shell.

Exclude registration, self-service password recovery, Supabase Auth, role
switching, account-management HTTP endpoints, MFA, and order-domain workflows.
Operator tooling is the only account-management interface.

Repository inspection found documentation and these four specifications only:
no application configuration, lockfile, migrations, or verified commands. No database
was inspected. The existing empty `spec/` directory is left untouched.

## Decision Ledger

Confirmed through discussion:

- React, Tailwind CSS, TypeScript, Node.js 24 LTS, Fastify, Vite, React Router,
  npm, `pg`, and version-controlled SQL migrations. No ORM is required.
- Vitest, React Testing Library, Fastify injection integration tests against a
  dedicated database, and Playwright browser tests.
- One public HTTPS origin with `/api` routing to a long-running Node backend.
  Local Vite proxies `/api`. No CORS support or serverless adapter initially.
- Database-backed rate limits support shared state across backend instances.
- Individual operator-created accounts; eight-hour absolute sessions;
  concurrent sessions allowed; no sliding expiry or remember-me.
- Passwords contain 8-128 Unicode code points, without trimming, normalization,
  composition rules, or scheduled expiry. This accepts the weaker eight-character
  minimum for password-only authentication; hashing cannot fix weak passwords.
- Explicit logout clears unsaved frontend data. Session expiry preserves
  tab-local in-memory recovery data for the same account only.
- Manual database-backed drafts, not autosave, are an approved scope expansion.
  Drafts are creator-only, resumable/deletable, accept incomplete fields subject
  to structural validation, and persist until submitted or deleted. They have
  no order number or operational assignment. Version checks prevent overwrites;
  submission atomically creates an order and marks the draft submitted with a
  retained order link. Specs 2-4 own implementation of these domain features.
- This document supersedes conflicting mock-auth guidance in AGENTS.md and
  DESIGN.md. Preserve their compatible visual/accessibility requirements.
  Supporting documentation is aligned with this approved scope.

Spec 3 owns canonical MYR money (0.00..999999.99), fixed-scale response strings
and integer-sen storage, editor/draft APIs and reconciliation. Spec 2 owns both
lists; Spec 4 owns saved detail and creation handoff. These contracts are settled;
foundation implementation and deployment configuration are execution prerequisites.

Deferred: hosting provider, actual proxy addresses, dependency patch versions,
operational backup policy, and optional future MFA. A deployment is blocked
until its origin, proxy trust, database TLS, and connection budget are configured.

## Shared Foundation

Use a small npm-workspace repository with `apps/web`, `apps/api`, and
`packages/contracts`. Keep a single root package-lock.json. Select maintained
compatible dependency versions when scaffolding and pin the resolved versions
in the lockfile. Use current React and Tailwind releases compatible with Vite.

Frontend routes:

| Route | Owner and behavior |
| --- | --- |
| `/` | Spec 1: replace with `/orders` |
| `/login` | Spec 1: credential form; valid admin goes to safe return target |
| `/access-denied` | Spec 1: explanation and logout, no protected shell data |
| `/orders` | Spec 2: protected homepage |
| `/orders/new` | Spec 3: protected creation screen |
| `/orders/:orderId` | Spec 4: protected saved-order screen |
| `/drafts` | Spec 2: protected My drafts screen |
| `/drafts/:draftId/edit` | Spec 3: protected creator-owned draft editor |

Unknown routes show a non-sensitive not-found page. API misses return JSON 404,
not the SPA HTML fallback. Use camelCase JSON and opaque UUID strings for IDs.
Serialize timestamps as UTC ISO 8601 ending in `Z`, including milliseconds.

Successful JSON is `{ "data": ... }`. Errors are:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Check the highlighted fields.",
    "fieldErrors": { "email": ["Enter a valid email address."] },
    "requestId": "server-generated-uuid"
  }
}
```

Omit fieldErrors except for field validation; values are arrays of strings keyed
by field name. Generate request IDs on the server, return `X-Request-ID`, and
never echo arbitrary client request IDs. Never return SQL, stack traces,
passwords, hashes, tokens, or internal account-status explanations.

Common errors: 400 MALFORMED_REQUEST; 401 UNAUTHENTICATED; 403 FORBIDDEN;
403 CSRF_REJECTED; 404 NOT_FOUND; 413 PAYLOAD_TOO_LARGE;
415 UNSUPPORTED_MEDIA_TYPE; 422 VALIDATION_ERROR; 429 RATE_LIMITED;
503 SERVICE_UNAVAILABLE; 500 INTERNAL_ERROR. Domain conflicts use 409 with
Spec 3-defined codes. Distinguish CSRF_REJECTED from authorization FORBIDDEN:
the former does not cause the frontend access-denied transition.

The shared API client uses relative `/api` URLs and explicit
`credentials: 'same-origin'`. Mutations send JSON and
`X-CSRF-Protection: 1`, including logout with `{}`. No automatic mutation retry.
Treat transport errors as unconfirmed outcomes, not authentication failures.
Use `Cache-Control: no-store` for all API responses. Do not persist protected
responses in browser storage or service workers.

`apiRequest<T>` returns the single unwrapped `data: T`, never the envelope.
For a 204 call use `apiRequest<void>`; do not parse a body. Other success statuses
require a JSON object with data; malformed success is a local consistency error.
Throw `ApiError` with status, code, message, optional fieldErrors, requestId and
parsed Retry-After seconds for structured failures; malformed failures retain
status with sanitized generic copy. Transport/abort errors remain distinct.
The client never writes cookies, retries mutations, or interprets every 403 as
FORBIDDEN. AuthProvider alone owns browser auth transitions. Only committed
successful login sets a session cookie; only successful explicit logout deletes
it. Protected APIs, current-session verification and all auth failures emit no
Set-Cookie, including deletion. Shared authorization/error handling is cookie-neutral;
domain SQL and client JavaScript never write cookies.

## Database and Trust Boundary

Use a dedicated non-public `app_private` schema. Runtime queries are
parameterized and use a non-owner, non-superuser database role granted only the
required table/sequence operations. Migration/provisioning credentials are
separate from runtime credentials. Use direct Postgres via `pg`, not a browser
Supabase client or service-role API key.

The runtime role name is `app_runtime` (LOGIN, NOSUPERUSER, NOBYPASSRLS,
NOINHERIT, no ownership/CREATE or privileged memberships). Migration/provisioning
connections are trusted separate roles; runtime never receives their credentials.
Schema USAGE and explicit object grants are required, not schema CREATE.

Revoke schema/table/sequence access from PUBLIC, anon, and authenticated roles;
exclude this schema from PostgREST exposure. Migration ownership remains with a
separate trusted role. All application authorization is enforced in the backend;
custom session cookies do not establish `auth.uid()`. Verify direct anonymous
Data API access cannot reach accounts, sessions, drafts, or orders. Specs 2-4
must apply the same access boundary to their migrations. This design uses
database privileges rather than pretending Supabase Auth RLS identifies users.

Spec 1 owns these migrations under `db/migrations/001_auth.sql`:

| Table | Columns and constraints |
| --- | --- |
| accounts | id UUID PK; email text NOT NULL UNIQUE; password_hash text NOT NULL; role text NOT NULL CHECK IN ('admin','technician','manager'); is_active boolean NOT NULL DEFAULT true; created_at timestamptz NOT NULL DEFAULT now(); updated_at timestamptz NOT NULL DEFAULT now() |
| sessions | token_hash bytea PK CHECK octet_length=32; account_id UUID NOT NULL FK accounts ON DELETE CASCADE; created_at timestamptz NOT NULL DEFAULT now(); expires_at timestamptz NOT NULL CHECK expires_at > created_at |
| login_limits | kind text CHECK IN ('email','ip'); key_hash bytea CHECK octet_length=32; window_started_at timestamptz NOT NULL; attempt_count integer NOT NULL CHECK >0; PRIMARY KEY(kind,key_hash) |

Accounts.email must equal its trimmed lowercase form, be nonempty, and be at
most 254 characters, with database checks. Application validation accepts ASCII
email addresses with conventional email syntax; internationalized email is not
supported initially. No provider-specific dot removal or plus-address rewriting.
Role values allow denial tests, not non-admin product workflows. CLI creates
only admins. Add indexes on sessions(account_id), sessions(expires_at), and
login_limits(window_started_at). Never hard-delete accounts referenced by orders;
deactivate them. Account deletion is not an exposed operation.

Expired session/limit cleanup is an operator command, run daily by the host
scheduler: delete expired sessions and rate-limit rows older than 24 hours.
Cleanup is not required for expiry correctness. Logs must not contain SQL bind
parameters. CI/test databases must be isolated and synthetic.

### Auth Database Grant Matrix

Migration 001 grants USAGE on app_private and only these auth-object privileges
to app_runtime, with no grant option, ownership or privileged role membership:

| Object | app_runtime privileges | Purpose / denied operations |
| --- | --- | --- |
| app_private.accounts | SELECT; column UPDATE(password_hash) only | Credential/session joins, locked login recheck and CAS rehash. No INSERT/DELETE or UPDATE of id/email/role/is_active/created_at/updated_at |
| app_private.sessions | SELECT, INSERT, DELETE | Resolve sessions, insert fresh sessions, revoke presented session at login/logout. No UPDATE, expiry extension, TRUNCATE or maintenance endpoint |
| app_private.login_limits | SELECT, INSERT; column UPDATE(window_started_at,attempt_count) only | Create buckets, lock, reset window and increment counts. No key/kind UPDATE, DELETE or TRUNCATE |

No auth sequence grants are needed (UUID/default time generation is not a serial
sequence). Revoke inherited/default broad table grants before applying this matrix.
SELECT exposes password hashes only to the trusted backend role, never HTTP DTOs.
Column UPDATE(password_hash) permits PostgreSQL SELECT ... FOR UPDATE on accounts
without granting UPDATE of identity/role/activation columns. Successful login
locks exactly its account with FOR UPDATE after Argon2 verification, rechecks the
verified hash/status/role, optionally performs `UPDATE ... SET password_hash=$new
WHERE id=$id AND password_hash=$verified`, and inserts the session in that same
transaction. Rehash does not write updated_at; that column tracks trusted account
administration here. No trigger may require broader runtime account privileges.
Operator replacement/deactivation/revoke-sessions also take account FOR UPDATE
before deleting sessions, ensuring login recheck serializes with these operations.
Protected session/domain authorization is an ordinary unlocked SELECT; it does
not inherit this credential-login lock or promise cancellation of authorized work.

Limiter admission locks rows FOR UPDATE in the specified deterministic order;
column UPDATE on either mutable limiter column permits that lock. Its INSERT
or upsert changes only the granted mutable columns; no deletion is used to reset
buckets. All statements use schema-qualified relations and parameterized values.

Separate trusted provisioning/CLI role has schema USAGE, accounts SELECT/INSERT
and UPDATE(password_hash,is_active,updated_at), sessions SELECT/DELETE, and
login_limits SELECT/DELETE for documented account commands and cleanup-auth.
Cleanup uses this trusted connection, not app_runtime: delete expired sessions
and >24-hour-old limiter rows. Runtime's session DELETE is necessary for auth,
but never exposed as arbitrary/all-session deletion through HTTP. Migrations
remain owned by the separate trusted migration role. Neither trusted role nor
its credentials/memberships is available to runtime. Role/email changes and test
nonadmin fixtures require trusted migration/operator SQL outside the web API;
the account CLI exposes only its listed commands.

## Passwords and Operator Tooling

Use maintained Node `argon2` with Argon2id, memoryCost 65536 KiB, timeCost 3,
parallelism 1, random salt >=16 bytes, and hashLength 32 bytes. Store the encoded
hash with parameters. Benchmark the approved settings during implementation and
report performance; do not silently weaken them. Rehash after successful
verification if parameters differ, using a compare-and-swap update so concurrent
password replacement cannot be overwritten. Apply that CAS in the locked login
transaction described in the grant matrix, not an independent post-login write.

Count code points using `Array.from(password).length`, not JavaScript string
length. Reject unpaired UTF-16 surrogates. Accept spaces and Unicode otherwise.
Login accepts the same 8-128 range and never truncates. Unknown emails and
ineligible accounts perform a dummy verification with the same Argon2 policy.
Use a precomputed dummy encoded hash, not per-request hash generation. The
generic response is a mitigation, not a constant-time guarantee.

Operator commands: create-admin, replace-password, activate, deactivate,
revoke-sessions, and cleanup-auth. Require interactive hidden password and
confirmation prompts for creation/replacement; never accept passwords as argv,
environment variables, logs, committed seeds, or HTTP payloads to an admin API.
Email/account ID may be command arguments. Reject duplicate normalized emails.
Replacement, deactivation, and revoke-sessions lock the account row FOR UPDATE and delete
its sessions in the same transaction. Activation never restores sessions.
Log only operation, target account ID, outcome, timestamp, and operator identity
from the trusted operating environment. Infrastructure access governs this CLI;
it is not authenticated through the web session. Never ship operator credentials
to the runtime/frontend.

## Login-Attempt Protection

Admit at most five attempts per normalized email and thirty per canonical client
IP in a 15-minute window anchored at the first admitted attempt. These are
attempts, not failures; success does not reset counters. Unknown emails count.
Malformed/structurally invalid requests are rejected before credential checking;
all schema-valid login requests consume admission before Argon2 work.

Hash limiter keys using HMAC-SHA-256 with a backend-only random secret and a
kind prefix. Normalize IPs through a maintained IP parser: IPv4-mapped IPv6 is
IPv4; other IPv6 uses canonical full-address identity, not client text. This
does not prevent IPv6 address rotation or distributed attacks. Never log raw
limiter keys. Secret rotation resets effective limits and must be documented.

Within a transaction, create/lock both bucket rows in deterministic kind/key
order. Reset elapsed windows, inspect both counts, and increment both only when
both allow admission. Prevent races with row locks/upserts. Blocked attempts do
not increment or extend windows. Return 429 with generic text and Retry-After
as the ceiling of seconds until all exhausted buckets can admit, minimum 1.
Do not disclose which bucket blocked. Fail closed with 503 if limiter storage
fails. An attacker can temporarily exhaust a known email's allowance; this is
an accepted tradeoff, not an account lockout requiring operator intervention.

Fastify trustProxy defaults to false. Deployment must list exact trusted proxy
addresses/CIDRs; the backend must not be publicly reachable around that proxy,
and the proxy must overwrite incoming forwarding headers. Do not use blanket
trustProxy=true or trust arbitrary X-Forwarded-For. Node resolves the canonical
client through this configured chain. A real proxy smoke test is a deployment
gate. Database limits are not volumetric DDoS protection: host-level connection
and request limits are still required. Bound concurrent password verifications
per process to four; reject excess work with 503 and no unbounded queue. Size
host memory for these Argon2 operations plus application/database pools.

## Sessions and Authorization

Generate 32 random bytes using node:crypto.randomBytes and encode base64url
without padding (43 characters). Store only SHA-256(token) as bytea; token
entropy makes a slow password hash unnecessary for session lookup. Never log
Cookie/Set-Cookie headers or request bodies containing credentials.

Create sessions with database time and expires_at = created_at + eight hours.
Validate expiry with database time on every protected operation. No sliding
extension, idle timeout, fingerprint binding, or persistent browser token store.
Join the account on every request; do not cache active status/role. Actor IDs
always come from this join, never a supplied JSON field.

Every protected request, including current-session, requires an active admin.
Missing, malformed, unknown, expired sessions or inactive accounts return 401
without Set-Cookie. An active non-admin session returns 403 FORBIDDEN, also
without Set-Cookie. An invalid cookie remains unusable until successful login
replaces it or explicit logout deletes it (or natural browser expiry removes it).
Retaining it does not grant access; every request revalidates it. Existing role
changes are observed on the next request. Requests already authorized may finish; deactivation is not
retroactive cancellation. Spec 3 must authorize within its mutation transaction
and lock the actor account consistently if it requires serialization against
operator revocation. Do not promise immediate cancellation of in-flight work.

Successful login locks/rechecks the account FOR UPDATE after verification, ensuring its
password hash, active status and role have not changed before insertion. Revoke
the session presented by that browser, if any, and insert a fresh session in
the same transaction; never reuse its token. Other sessions remain valid.

Production cookie: `__Host-session`, HttpOnly, Secure, SameSite=Lax, Path=/,
no Domain, Max-Age=28800, Expires matching the database deadline. Local HTTP
cookie: `dev_session`, same attributes except Secure omitted and no __Host-
prefix. Development exception is permitted only in development with a loopback
configured origin. Production startup rejects non-HTTPS origins or insecure
cookie configuration. Explicit successful logout alone deletes the cookie using
the same name/path/security attributes, Max-Age=0 and expired Expires.

### Cookie Response Ordering and Concurrent Auth

Ordinary protected 401/403 and every current-session response emit no Set-Cookie:
a delayed failure for an old token must not delete a newer valid login cookie.
Failed login/logout also emit none. The only cookie writers are committed login
success and successful explicit logout (including idempotent missing-token logout).
Frontend generations/AbortSignal control callbacks, not browser Set-Cookie
processing; ignoring/aborting a response cannot undo a cookie already applied.

Logout revokes only the token presented on that request, never all browser/account
sessions. Concurrent login in another tab may establish a different session that
logout does not revoke. Browser cookie response arrival order is not database
commit order: a delayed logout deletion may remove the newer login cookie, leaving
its valid server session unreachable; a delayed successful login may set its
cookie after logout, leaving a valid session, or a revoked token that still fails
authorization. Overlapping logins can likewise leave the browser holding a
different session/account from an earlier response's JSON. No global sign-out or
cross-tab linearization guarantee is provided. Unreachable sessions expire normally.

Disable overlapping login/logout within one tab; BroadcastChannel signals hide
and invalidate sibling UI best effort, not a lock or proof of current cookie state.
After successful login, verify GET /api/auth/session freshly before mounting
protected content, using its verified identity rather than blindly trusting login
JSON. Received auth-change/completion signals likewise trigger fresh verification
as below. Such checks are point-in-time observations; later cookie responses can
still change identity. Backend authorization remains mandatory on every operation.

## Origin and CSRF Policy

Configure a single canonical PUBLIC_ORIGIN, including port where applicable.
For every POST/PUT/PATCH/DELETE under /api, before any side effects:

1. Require Origin to match PUBLIC_ORIGIN exactly; reject missing, null,
   malformed, or mismatching origins with 403 CSRF_REJECTED.
2. Require application/json (optional charset accepted) and the exact custom
   header X-CSRF-Protection: 1. Missing custom header is 403 CSRF_REJECTED;
   incorrect media type is 415.
3. Apply byte limits and JSON framing validation. Authentication endpoints cap
   JSON bodies at 4 KiB (sufficient for escaped bounded credentials). Reject
   nonidentity Content-Encoding with 415. Domain schema/field validation follows
   requireAdmin; Spec 3 defines canonicalization/transaction/replay ordering.
   Other specs set explicit bounded payload limits.

Apply this to login and logout, not just authenticated mutations. Do not enable
CORS, reflect origins, accept form submissions, or use Referer as a fallback.
No separate CSRF token is required with this same-origin-only contract. Safe GET
requests must have no business mutations, session renewal or cookie writes,
including invalid-session cleanup. XSS defeats these browser protections: render text
without raw HTML, use a production self-only script policy without unsafe-inline
or unsafe-eval, frame-ancestors 'none', X-Content-Type-Options: nosniff, and
Referrer-Policy: no-referrer. Host fonts/assets locally. Production TLS terminator
owns HSTS; document its configuration rather than inferring TLS from user headers.

## Endpoint Contracts

### POST /api/auth/login

Public but CSRF-protected and rate-limited. Body:

```json
{ "email": "admin@example.test", "password": "example only" }
```

Reject unknown fields; validate email and password as above. 422 includes field
errors for structural validation. For schema-valid wrong credentials, unknown
account, inactive account, or non-admin: 401 INVALID_CREDENTIALS with message
`Invalid email or password.` and no fieldErrors or new cookie. Do not clear a
previous valid session merely because a login attempt failed.

Success: 200, fresh Set-Cookie, no token in JSON:

```json
{
  "data": {
    "user": { "id": "uuid", "email": "admin@example.test", "role": "admin" },
    "expiresAt": "2026-10-23T23:00:00.000Z"
  }
}
```

Other outcomes: 400 malformed JSON; 403 CSRF_REJECTED; 413; 415; 429;
503 when database/limiter unavailable or verifier capacity exhausted; sanitized
500 for unexpected failures. Never issue a cookie before transaction commit.
Lost login responses may leave an unused session that expires normally.

### GET /api/auth/session

No body. 200 returns the same data shape as login without token renewal.
401 UNAUTHENTICATED: `Your session has expired. Sign in again.` (also used
for missing/invalid sessions); do not clear/set cookies. 403 FORBIDDEN:
`You do not have access to this portal.` 503 on database unavailability.
Never turn infrastructure failures into 401 or redirect HTML from API routes.

### POST /api/auth/logout

Body `{}`; CSRF protected but does not require admin authorization. Hash the
presented token, delete that session if present, commit, clear cookie, return
204 with no body. Missing/malformed/expired/already-revoked tokens are idempotent
204; no token must not require a database lookup. Known-format token with a
database failure returns 503 and does not claim successful revocation. Non-admin
and inactive sessions may log out. Clear-cookie is not a substitute for deletion.

204 confirms revocation/absence only of the presented token, not that another
concurrent login session was revoked or that the cookie jar is now empty. A retry
presents the cookie then current in the browser and may revoke a different session;
never describe retries as guaranteed revocation of every earlier session. See
cookie ordering above for the deliberate delayed-deletion limitation.

### Protected Domain APIs

Every technician/order/draft endpoint calls shared backend authorization before
returning protected data or performing domain side effects. Unauthorized direct
requests receive JSON 401/403 regardless of frontend navigation. Draft access
also requires creator ownership; domain specs must choose non-disclosing 404 for
another creator's draft. Do not trust client account/role/assignment actor fields.

## Frontend Flows and Accessibility

Auth states: checking, anonymous, authenticated, recovering, forbidden,
unavailable, and signingOut/unconfirmedLogout. Keep this state above route pages;
Spec 1 owns router, shell, API client, identity and logout. Do not mount protected
pages or start their queries until session checking succeeds.

On initial load call current-session. Show `Checking your session...` in a status
region; 401 leads to login, 403 to Access denied, network/503 to a persistent
retry screen without falsely logging out or exposing cached protected content.
On success show the requested protected route. Anonymous navigation retains only
an allowlisted internal return path in memory or validated query state. Accept
only known route patterns with UUID identifiers; reject external/protocol-relative
URLs, backslashes, arbitrary query strings and fragments. Default to /orders.

Safe-return allowlist includes all protected routes in the table, with strict
36-character hyphenated UUID IDs canonicalized lowercase (all UUID versions).
Only /orders and /drafts may carry exactly one nonempty cursor parameter, no
other keys or fragments. Decode query once, validate with Spec 2's browser-safe
cursor codec (kind must match route, <=1024 base64url characters); rebuild using
URLSearchParams rather than concatenating untrusted strings. Reject duplicate
keys, malformed escapes, encoded path separators and external URLs. Invalid
return targets fall back to /orders, not an arbitrary caller-provided fallback.

Login uses a main landmark, h1 `Sign in`, visible email/password labels,
autocomplete=username/current-password, type=email/password, required convention,
and keyboard submit. Disable repeated submit while pending; announce `Signing
in...`. Client validation focuses the first invalid field and uses aria-invalid
and aria-describedby. Focus email on initial login; operational/credential errors
focus a persistent error summary with role=alert and tabindex=-1. Preserve email;
clear password after completed failed login, but not before a result is known.
Do not persist passwords. On success clear password, verify current-session as
specified above, then navigate with replacement and focus the destination h1.
Rate-limit feedback gives retry guidance and disables
submit until Retry-After elapses; backend remains authoritative.

Protected page route changes focus the new h1; use semantic navigation with
aria-current. Follow DESIGN.md tokens, 44px controls, visible focus, and mobile
16px input text. No decorative or mock identity controls. Shell shows current
email and a real Sign out action. Access denied shows a clear explanation and
Sign out; no orders or recovery payload is rendered there.

For a protected API 401, cancel/ignore stale reads and hide protected content.
Retain tab-local unsaved draft plus submission key in a parent memory store,
bound to the previous account ID; render inline reauthentication, not a modal.
Deduplicate simultaneous 401 transitions. Same-account success restores exact
allowlisted route and recovery payload; different-account success destroys it
before mounting any protected page. Never automatically replay a mutation.
Forbidden clears protected data/recovery and opens Access denied. CSRF errors
show an operational error rather than masquerading as lost admin access.

Explicit logout immediately destroys unsaved recovery data and cached protected
content. Warn about unsaved changes before the user confirms logout; saved
database drafts are unaffected. While revoking show `Signing out...`. Success
navigates to /login, focuses h1, and broadcasts confirmed logout. Network/503
shows `Sign-out could not be confirmed. Retry.` with retry; protected content
remains hidden and no session check automatically reopens it in that tab. A page
reload may restore the still-valid cookie session; explain this on the failure
screen. Never claim that clearing React state revoked a server session.

Use BroadcastChannel with non-sensitive messages only: logout-started hides
protected content and destroys unsaved state in sibling tabs; logout-confirmed
announces completion of that presented-token request, not global anonymous state.
After received logout-started/logout-confirmed or login/session-change, freshly
check current-session while content remains hidden; only the result establishes
current identity. A sibling may find a concurrent valid login and resume with
fresh state (never restored destroyed memory). A tab with its own signingOut or
unconfirmedLogout intent remains hidden despite verification success until that
intent is resolved and the user explicitly signs in/rechecks; signals never
automatically reopen it. On visibility returning to visible, recheck the
session and temporarily hide protected content until resolved. API authorization
remains the security boundary even if a tab misses a message. No guarantee that
already displayed data can be erased from an offline/suspended browser.

### Shared Auth Lifecycle and Invalidation

AuthProvider exports `{accountId, authGeneration, phase}` and synchronous lifecycle
subscriptions. authGeneration is a tab-local monotonically increasing integer,
starting at 0; increment before initial verification, every visibility/session
verification, first deduplicated protected UNAUTHENTICATED/FORBIDDEN transition, login attempt,
and explicit/received logout. Requests capture generation and account at dispatch;
only matching authenticated bindings may commit any data/navigation/focus.
The check/login result itself must match its initiating generation. Old 401/403
callbacks cannot invalidate a newer verified generation. Concurrent failures in
one generation trigger exactly one transition. Reads are aborted at invalidation.

Failed credential login remains on login/recovery with retained same-account
snapshot and no domain resume; a failed attempt is not a successful account
change. Initial anonymous 401 retains only a validated desired route. A deliberate
login while already authenticated first suspends content; wrong credentials do
not revoke its server session or destroy private memory. Explicit Retry session
verification can restore that session without a credential retry.

Events are `suspend(reason)`, `resume(accountId,generation,reason)` and `destroy(reason)`.
Suspend synchronously hides protected DOM without destroying parent-owned editor,
list navigation, or detail visit state. All nondestructive visibility, sessionChange
and deliberate login suspensions retain verified ready read snapshots privately;
pending reads retain their exact target/intent
and restart once on successful same-account resume. It does not refetch completed
reads. A network/503 verification failure stays hidden/unavailable with explicit
Retry, retains private state and never logs out. A 401 discards protected read
snapshots but preserves same-account editor recovery, list context and private
detail receipt; after this confirmed 401 reauthentication refetches reads.
Without a confirmed 401, successful same-account verification/login rebinds ready
snapshots rather than refetching them. Successful same-account checks
rebind retained state to the new generation, never revive old callbacks.

Destroy synchronously clears all protected snapshots, recovery, navigation maps,
receipts and pending UI before different-account login mounts content, FORBIDDEN,
explicit logout or either logout-started/logout-confirmed broadcast. These logout
signals are destructive even if revocation fails. A login/session-change broadcast only suspends and verifies;
it carries no identity. Initial check has no retained account. After suspension,
dispatched mutations become uncertain and reconcile through their original key;
never restart/resend automatically. Even a late successful mutation callback
cannot apply across generations. Same-account resume may restart reconciliation
GETs, but not writes. Cookie authentication on each backend request remains the
security boundary. Spec 3's dirty/pending guard runs before voluntary route leave
or logout confirmation, not before involuntary suspension/destruction.

Expose `subscribeAuthLifecycle(listener): () => void` with a discriminated event
`{type:'suspend'|'destroy',reason,binding}` or
`{type:'resume',reason,binding:{accountId:string,authGeneration:number}}`.
Suspend reasons are initialCheck, visibility, sessionChange, unauthenticated,
login; destroy reasons are accountChanged, forbidden, logout, remoteLogout.
Resume reason identifies initialCheck, visibility, sessionChange or login.
`binding` on suspend/destroy is the previous account (nullable) and the new
generation. Invoke subscribers synchronously before rendering auth transition;
domain stores above route gates retain or destroy as specified. Repeated checks
for the same trigger/generation may coalesce. Each received auth signal invalidates
any earlier check, starts a new generation and dispatches a fresh session GET;
never reuse a check dispatched before that signal. Explicit retry likewise creates
a new generation. A post-login verification GET belongs to that login flow and
must be dispatched after its successful response, never reuse an older check.
Only protected UNAUTHENTICATED/FORBIDDEN responses enter this lifecycle;
INVALID_CREDENTIALS and CSRF_REJECTED do not. Auth endpoint failures are handled
by their initiating login/check/logout flow, not recursively by a global handler.

Router exports `registerLeaveGuard(guard: () => Promise<boolean>): () => void`;
Spec 3 registers one editor guard, true means leave. Router awaits it for voluntary
internal navigation/Back/Forward and logout before changing URL or clearing state;
cancel keeps route/form. Successful save route replacement and confirmed creation
use one explicit bypass for that transition only. Auth suspension never consults
it. Logout confirmation and guard share one prompt, not duplicate discard dialogs.

## Spec 3 Recovery Adapter

Expose a tab-local adapter holding opaque payloads, not a generic persisted
draft platform. Spec 3 supplies the typed form payload and idempotency state.

```ts
type RecoverySnapshot = {
  accountId: string;
  returnPath: string;
  payload: unknown; // owned and validated by Spec 3
};
interface RecoveryStore {
  capture(snapshot: RecoverySnapshot): void;
  takeFor(accountId: string): RecoverySnapshot | null;
  clear(): void;
}
```

takeFor destroys a mismatched snapshot. No snapshot enters localStorage,
sessionStorage, URLs, telemetry, or broadcast messages. Refresh/closure loses it.
Spec 3 must preserve logical submission keys, saved-draft ID/version, and
uncertain-outcome state in its payload. Saving a draft is a protected mutation;
expiry cannot silently save it. After reauthentication, reconcile uncertain
submissions before enabling a new logical submission. Never assign a new key
merely because authentication expired. Saved drafts remain in the database
after logout/deactivation, but are accessible only through an active creator's
authorized session. Domain implementation must enforce ownership independently.

## Modules and Signatures

Use these concrete boundaries; do not add generic service/repository frameworks.

| File | Contract, side effects and errors |
| --- | --- |
| packages/contracts/src/api.ts | ApiErrorBody, SessionData, Actor; browser-safe types only, no server secrets |
| apps/api/src/config.ts | loadConfig(env): Config; validates mode/origin/proxy/DB limits; throws startup error without secret values |
| apps/api/src/db.ts | createPool(config): Pool; backend-only connections; transaction helper rolls back on errors |
| apps/api/src/auth/password.ts | hashPassword(password): Promise<string>; verifyPassword(hash,password): Promise<boolean>; validation/policy errors and bounded Argon2 work |
| apps/api/src/auth/rate-limit.ts | admitLogin(db,email,ip,now): Promise<{allowed:boolean,retryAfterSeconds?:number}>; atomic bucket changes; throws unavailable |
| apps/api/src/auth/session.ts | resolveSession(db,token): Promise<SessionData>; typed unauthenticated/forbidden/unavailable errors; never returns hashes |
| apps/api/src/auth/authorize.ts | requireAdmin(request,reply): Promise<Actor>; called by each protected route; actor attached in typed request context |
| apps/api/src/auth/routes.ts | registerAuthRoutes(app): void; login/session/logout validation, transactions, cookies, sanitized responses |
| apps/api/src/security.ts | assertMutationOrigin(request): void; rejects unsafe origin/header/media type before side effects |
| apps/api/src/errors.ts | sendApiError(reply,error,requestId): void; maps known errors, logs sanitized unexpected errors |
| apps/api/src/cli/accounts.ts | runAccountCommand(args,hiddenPrompt): Promise<void>; trusted provisioning connection, transactional revocation, sanitized audit output |
| apps/web/src/api/client.ts | apiRequest<T>(path,options): Promise<T>; typed ApiError or transport error, credentials/headers, no mutation retries |
| apps/web/src/auth/AuthProvider.tsx | owns session state, refreshSession(), login(credentials), logout(); clears protected caches and invokes recovery boundaries |
| apps/web/src/auth/recovery.ts | RecoveryStore above; memory-only, explicit destructive clear |
| apps/web/src/auth/ProtectedRoute.tsx | renders checking/recovery/forbidden/unavailable/content; no backend security claim |
| apps/web/src/pages/LoginPage.tsx | accessible credential form; no domain persistence |
| apps/web/src/App.tsx | router, safe return-path resolver, shell and route-level focus |

SessionData is `{user:{id:string,email:string,role:'admin'},expiresAt:string}`;
Actor is `{accountId:string,role:'admin'}`. Credentials remain local to the login
call and are never included in React diagnostic state. Backend transaction
helpers may expose PoolClient to Spec 3 for atomic authorization/domain writes.
All database exceptions map to sanitized responses; no browser module imports
backend modules. Tests inject clocks/random generators only at narrow boundaries.

`authorizeAdmin(db: Pick<PoolClient,'query'>, token: string|null): Promise<Actor>`
uses the same session/account join, database-time expiry and typed errors as
resolveSession; no response/cookie side effects and no independent pool query.
requireAdmin parses the cookie through one shared parser, calls this helper and
maps auth errors without Set-Cookie. Mutation routes first requireAdmin before domain
validation, then call authorizeAdmin on their transaction client again before
receipt lookup. Neither check locks actor rows or promises cancellation after
authorization. Domain routes reuse shared cookie-neutral error mapping for
transaction auth failures. They never write cookies or send success before commit.

## Configuration and Setup

Backend-only variables: DATABASE_URL (runtime role), PROVISION_DATABASE_URL
(CLI only), MIGRATION_DATABASE_URL (migration only), LOGIN_LIMIT_HMAC_SECRET
(at least 32 random bytes), PUBLIC_ORIGIN, NODE_ENV, PORT, TRUSTED_PROXY_CIDRS,
and DB_POOL_MAX. Validate pool size against deployment connection budget; use
an explicitly configured Supabase direct/session-pool connection suitable for
transactions and verify TLS certificates. Never disable TLS certificate checking
to make a remote connection work. Local dedicated Postgres may explicitly use
non-TLS only on loopback/development. Secrets live in untracked local env files
or host secret storage; examples contain placeholders only.

Frontend contains no database URL, password, HMAC key, or Supabase privileged
key. No VITE_* secret is permitted. API URLs are relative, not configurable
cross-origin endpoints. Local browser origin is fixed, for example
http://localhost:5173, with PUBLIC_ORIGIN matching and Vite proxying API requests.
Do not mix localhost and 127.0.0.1 cookies/origins. Separate test database config
must prevent accidental use of production credentials.

Scaffolding must supply and document root scripts: npm run dev, npm run build,
npm run typecheck, npm run lint, npm run test:unit, npm run test:integration,
npm run test:e2e, npm run db:migrate, and npm run account -- <command>.
These are required future script names, NOT currently available or verified
commands. Migrations use a small ordered SQL runner with a migration ledger,
checksums, transaction boundaries, and advisory lock; never mutate applied
migrations. Test reset must refuse non-test database targets. Document dedicated
test database setup and browser installation when tooling is implemented.

## Verification and Acceptance

Unit tests:

- Password boundaries including emoji/code-point length, whitespace, unpaired
  surrogates, Argon2 parameters and rehash compare-and-swap behavior.
- Email normalization, safe return targets, cookie mode/startup validation,
  token generation/hash shape, error sanitization, and recovery identity checks.
- Exact origin/custom-header/media-type handling, including login/logout.

Database/API integration tests:

- Correct active admin login sets only protected cookie and returns safe data;
  bad password/unknown/inactive/non-admin have equivalent credential failures.
- Unique normalized email and foreign-key/check constraints; CLI rejects
  duplicate accounts and never emits passwords; revocation transactions work.
- Raw session tokens are absent from storage/logs; session lookup survives
  process recreation; expiry at the exact deadline rejects access.
- Direct anonymous calls to every protected domain endpoint return 401;
  active non-admin sessions return 403, including current-session. No protected
  handler performs domain side effects before authorization.
- Deactivation, password replacement and revoke-all invalidate all sessions;
  activation does not revive them; logout only revokes its own session.
- Concurrent rate-limit admission never exceeds either allowance; attempts
  across two API instances share limits; window/reset/Retry-After are exact;
  blocked requests do not extend windows; database outage fails closed.
- Forged proxy headers do not change IP without configured proxy trust;
  malformed token/cookie input is safe; errors never expose internal SQL.
- Missing/cross-origin/null Origin, absent custom header and wrong media type
  cannot login/logout/create records; rejected requests have no side effects.
- Logout is idempotent, including forbidden/inactive sessions; database failure
  returns 503, not false success; no-store headers apply to failures as well.
- PUBLIC/anon/authenticated and anonymous Data API cannot read or mutate private
  tables; app_runtime is constrained by the explicit auth/domain grant matrices.
- As app_runtime on isolated Postgres, account SELECT/FOR UPDATE and CAS
  password_hash UPDATE succeed; INSERT/DELETE and updates to id/email/role/
  is_active/created_at/updated_at fail. Rehash during login requires no broader
  grant. Concurrent operator password replacement/deactivation blocks on the
  login account lock (and vice versa); recheck prevents stale credential login.
- Runtime session SELECT/INSERT/DELETE succeed, UPDATE/expiry extension and
  TRUNCATE fail. Limiter INSERT, SELECT FOR UPDATE, window reset/count UPDATE
  succeed; key/kind UPDATE, DELETE and TRUNCATE fail. Trusted cleanup deletes
  expired sessions/old limits; no runtime cleanup/maintenance route exists.
  Verify no inherited/default grants or role membership bypasses these denials.
- Every protected endpoint and GET /api/auth/session, including 401/403/503,
  emits no Set-Cookie; failed login/logout emit none. Only committed login success
  and successful explicit logout write cookies. Delay an old-token 401/session
  verification until after a fresh login: response cannot delete/replace its cookie.
- With separate sessions A/B, logout presenting A deletes only A while concurrent
  login commits B; B remains valid in SQL regardless of cookie response ordering.

Browser acceptance:

- Login, refresh, deep-link restoration, logout, browser Back, and independent
  direct API denial; no protected-content flash during restoration.
- Loading, validation, bad credentials, throttling, network outage, forbidden,
  and unavailable states have persistent accessible feedback and useful focus.
- Expiry during an edited form restores same-account unsaved state/key after
  login without submission; different-account login destroys it. Refresh loses
  memory-only changes; saved database drafts are unaffected.
- Lost create response never triggers automatic replay/new idempotency key;
  Spec 3 integration reconciles it. Failed draft save is not shown as saved.
- Logout clears unsaved data in notified tabs; failed logout shows unconfirmed
  state and retry; successful retry revokes only its presented session. Returning a stale
  tab to foreground rechecks session before showing protected content.
- Delay logout's deletion until after a concurrent login Set-Cookie, then reverse
  response order in another test. Assert the documented browser-cookie outcomes,
  not global logout: deletion can remove the newer cookie, or later login can
  establish a valid session. Generation/abort guards must not be credited with
  cancelling Set-Cookie. Login/received signals verify the actual current session
  before displaying content; differing verified account destroys prior memory.
- Across visibility, sessionChange and deliberate login suspensions, ready list/
  detail snapshots remain hidden and rebind on verified same-account resume with
  no extra domain GET; pending reads restart exactly once. Network failure retains
  hidden state; confirmed 401 discards customer snapshots and requires refetch
  after auth. Logout signals destroy memory before fresh verification; a valid
  concurrent session starts fresh, never restores destroyed work or reopens a
  tab's unresolved logout intent. Test out-of-order checks/signals as well.
- Keyboard-only navigation, screen-reader status/error announcements, visible
  focus, 200% zoom, and layouts at 360/768/1280/1440px without horizontal overflow.
- Production HTTPS smoke test confirms Secure/__Host cookie, origin checks,
  proxy IP attribution, no CORS and security headers; local exception does not
  leak into production. Automated local tests alone do not verify deployment.

## Ordered Implementation Tasks

1. Scaffold shared foundation and scripts. Own root package/config/lockfile,
   apps/api bootstrap, apps/web bootstrap and packages/contracts. Establish
   build/typecheck/lint/unit scripts and document actual versions. No domain UI.
2. Implement auth migrations, role grants and migration runner. Own db/ and
   backend db/config modules. Verify on isolated Postgres, including denied
   anonymous access. Coordinate migration numbering with Specs 2-4.
3. Implement password and operator tooling. Own password/CLI modules and focused
   tests. Verify code-point policy, uniqueness, revocation and sanitized output.
4. Implement shared CSRF/error handling, limiter and session helpers. Own API
   security/auth modules. Verify races, proxy assumptions, expiry and outages.
5. Implement three auth endpoints and shared authorization hook. Verify complete
   injection/database suite before exposing domain route integration.
6. Implement API client, AuthProvider, login, shell, routing and recovery store.
   Own Spec 1 web modules. Verify accessible states and no protected-content flash.
7. Integrate domain pages through agreed Actor/error/recovery contracts. Specs
   2-4 own domain modules, draft contracts and domain tests; do not overwrite
   their files. Use the ownership and acceptance matrix below.
8. Add browser acceptance coverage and operator/setup documentation; align
   AGENTS.md/DESIGN.md in line with approved real auth. Run
   established scripts and report results and any deployment-only gaps.

Each task depends on preceding shared contracts; domain teams may develop
against the exported types after task 1 but cannot claim end-to-end auth until
tasks 2-6 pass. Completion requires actual checks, documented setup, isolated
test data, no secrets committed, and explicit reporting of unverified deployment
behavior. No task authorizes provisioning, deployment, commits or shared-DB edits.

## Exportable Shared Contract

- Stack: TypeScript/Node 24/Fastify/pg; React/Vite/React Router/Tailwind; npm.
- API prefix /api, camelCase, `{data}` success, structured error/fieldErrors,
  401 invalid session versus 403 FORBIDDEN permission denial. CSRF_REJECTED is
  a separate operational error. UTC ISO timestamps; opaque UUID IDs.
- Auth endpoints: POST /api/auth/login, GET /api/auth/session,
  POST /api/auth/logout. SessionData/Actor shapes are defined above.
- Protected/current-session responses never set/delete cookies. Login success
  replaces, explicit logout success deletes; logout revokes its presented token
  only. Concurrent auth cookie response ordering is not controlled by UI generations.
- Same-origin credentials, JSON plus X-CSRF-Protection: 1 on mutations, exact
  Origin validation. Never use browser database credentials or frontend guards
  as authorization. No automatic mutation retry.
- Each protected endpoint checks current session/account/role. Derive actors on
  backend. Draft access additionally requires creator ownership.
- Spec 1 owns shell/router/auth/client/errors. Domain specs own screens,
  validation and database workflows; coordinate shared files before changes.
- Eight-hour absolute expiry. Recovery is same-account, memory-only, no automatic
  replay. Spec 3 owns payload/key/version and uncertain-submission reconciliation.
- Spec 2 owns draft listing; Spec 3 owns editor and draft lifecycle; Spec 4 owns
  detail. Saved drafts survive logout; unsaved changes do not.
- Spec 3 money is MYR, integer sen in SQL, fixed-scale decimal response strings.

## Shared Ownership and Integrated Acceptance

| Concept | Authoritative owner | Consumers |
| --- | --- | --- |
| Auth generation, lifecycle, cookies, Actor, API transport/errors, routes/guards | Spec 1 | Specs 2-4 |
| Cursor codec, account-bound list-return map, Page, KL date formatter | Spec 2 | Specs 1, 3, 4 |
| Money, enums, technicians, domain DTOs/schema, validation, versions/receipts | Spec 3 | Specs 2, 4 |
| Detail DTO alias, creation handoff/visit, detail GET and return adapter | Spec 4 | Specs 2, 3 |

| Integrated journey | Required evidence during implementation |
| --- | --- |
| Login -> older orders -> detail -> return | Exact cursor/UUID ordering, account-bound focus/scroll restore and fresh query |
| Create -> confirmed receipt -> independent detail | One committed order, matching ID/number/time banner; refresh removes banner |
| Save -> drafts -> resume -> submit | Incomplete values preserved, latest version loaded, atomic order/link/receipt, draft excluded |
| Nondestructive visibility/sessionChange/login check | Hidden ready snapshots/edits/visit retained; same-account rebind, interrupted GET restarts once, no write resend |
| Expiry during dispatched mutation | Same key/body retained, same-account reconciliation, no duplicate; changed account destroys memory |
| Network outage and failed logout | Outage never implies logout; logout remains hidden/destructive with explicit revocation retry |
| Runtime SQL privilege boundary | Narrow technician lock function succeeds; general technician writes and anonymous access fail |
| Auth SQL privileges | Exact account rehash/lock, session and limiter operations succeed; forbidden column/maintenance writes fail |
| Delayed cookie responses | Old protected/session 401 has no Set-Cookie; concurrent login/logout obey presented-token scope and honest response-order limits |
| Conflicts and limits | Every Spec 3 discriminator has safe actions; escaped-Unicode body and max-version deletion tested |

All four specs are approved implementation-ready designs, not implemented
features. Deployment origin/proxy/TLS/pool settings and actual dependency versions
remain environment configuration, not unresolved product/interface decisions.

## Security Review Outcome

The design explicitly covers credential enumeration mitigation, login CSRF,
session fixation, token leakage, rate-limit races, proxy spoofing, revocation
races, unsafe redirects, infrastructure failures and cross-account draft leaks.
Residual limitations include weak eight-character passwords without MFA,
targeted email throttling, distributed/IPv6 attacks, no retroactive cancellation
of authorized requests, indefinite saved-draft retention, browser cookie response
ordering during concurrent auth (no global logout guarantee), and best-effort
clearing of already displayed data in other tabs. These are documented limitations, not
claims that planned controls have been implemented or tested.
