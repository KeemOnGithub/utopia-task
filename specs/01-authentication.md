# Spec 1: Admin Authentication and Session Lifecycle

Status: approved design, not implemented or verified.

## Goal and Scope

Enable individually identified, active admins to authenticate, use protected
Module 1 operations, recover from session expiry, and revoke their session.
Own trusted account provisioning, password verification, throttling, sessions,
authorization, login/logout screens, protected routing, and the shared shell.

Exclude registration, self-service password recovery, Supabase Auth, role
switching, account-management HTTP endpoints, MFA, and order-domain workflows.
Operator tooling is the only account-management interface.

Repository inspection found documentation only: no application configuration,
lockfile, migrations, existing specifications, or verified commands. No database
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
  Documentation alignment is an implementation task, not performed here.

Proposed for cross-spec agreement: money is serialized as fixed-scale decimal
strings, not JSON numbers. Spec 3 must confirm currency, scale, ranges, and
database representation. Authentication does not depend on that decision.

Unresolved dependencies: Specs 2-4 must allocate draft list/edit/detail endpoints
and screens, and Spec 3 must implement the recovery/idempotency adapter below.
These are integration gates, not permission to invent domain behavior here.

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
| `/drafts` | Reserved protected My drafts screen; domain ownership to coordinate |

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

## Database and Trust Boundary

Use a dedicated non-public `app_private` schema. Runtime queries are
parameterized and use a non-owner, non-superuser database role granted only the
required table/sequence operations. Migration/provisioning credentials are
separate from runtime credentials. Use direct Postgres via `pg`, not a browser
Supabase client or service-role API key.

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

## Passwords and Operator Tooling

Use maintained Node `argon2` with Argon2id, memoryCost 65536 KiB, timeCost 3,
parallelism 1, random salt >=16 bytes, and hashLength 32 bytes. Store the encoded
hash with parameters. Benchmark the approved settings during implementation and
report performance; do not silently weaken them. Rehash after successful
verification if parameters differ, using a compare-and-swap update so concurrent
password replacement cannot be overwritten.

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
Replacement, deactivation, and revoke-sessions lock the account row and delete
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
and clear the cookie. An active non-admin session returns 403 FORBIDDEN; retain
its cookie only so logout can revoke it. Existing role changes are observed on
the next request. Requests already authorized may finish; deactivation is not
retroactive cancellation. Spec 3 must authorize within its mutation transaction
and lock the actor account consistently if it requires serialization against
operator revocation. Do not promise immediate cancellation of in-flight work.

Successful login locks/rechecks the account after verification, ensuring its
password hash, active status and role have not changed before insertion. Revoke
the session presented by that browser, if any, and insert a fresh session in
the same transaction; never reuse its token. Other sessions remain valid.

Production cookie: `__Host-session`, HttpOnly, Secure, SameSite=Lax, Path=/,
no Domain, Max-Age=28800, Expires matching the database deadline. Local HTTP
cookie: `dev_session`, same attributes except Secure omitted and no __Host-
prefix. Development exception is permitted only in development with a loopback
configured origin. Production startup rejects non-HTTPS origins or insecure
cookie configuration. Cookie deletion uses the same name/path/security attributes
with Max-Age=0 and an expired Expires value.

## Origin and CSRF Policy

Configure a single canonical PUBLIC_ORIGIN, including port where applicable.
For every POST/PUT/PATCH/DELETE under /api, before any side effects:

1. Require Origin to match PUBLIC_ORIGIN exactly; reject missing, null,
   malformed, or mismatching origins with 403 CSRF_REJECTED.
2. Require application/json (optional charset accepted) and the exact custom
   header X-CSRF-Protection: 1. Missing custom header is 403 CSRF_REJECTED;
   incorrect media type is 415.
3. Apply body limits and schema validation. Authentication endpoints cap JSON
   bodies at 4 KiB. Other specs set their own explicit bounded payload limits.

Apply this to login and logout, not just authenticated mutations. Do not enable
CORS, reflect origins, accept form submissions, or use Referer as a fallback.
No separate CSRF token is required with this same-origin-only contract. Safe GET
requests must have no business mutations or session renewal. Cookie cleanup on
invalid session is permitted. XSS defeats these browser protections: render text
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
for missing/invalid sessions); clear cookie. 403 FORBIDDEN:
`You do not have access to this portal.` 503 on database unavailability.
Never turn infrastructure failures into 401 or redirect HTML from API routes.

### POST /api/auth/logout

Body `{}`; CSRF protected but does not require admin authorization. Hash the
presented token, delete that session if present, commit, clear cookie, return
204 with no body. Missing/malformed/expired/already-revoked tokens are idempotent
204; no token must not require a database lookup. Known-format token with a
database failure returns 503 and does not claim successful revocation. Non-admin
and inactive sessions may log out. Clear-cookie is not a substitute for deletion.

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

Login uses a main landmark, h1 `Sign in`, visible email/password labels,
autocomplete=username/current-password, type=email/password, required convention,
and keyboard submit. Disable repeated submit while pending; announce `Signing
in...`. Client validation focuses the first invalid field and uses aria-invalid
and aria-describedby. Focus email on initial login; operational/credential errors
focus a persistent error summary with role=alert and tabindex=-1. Preserve email;
clear password after completed failed login, but not before a result is known.
Do not persist passwords. On success clear password, navigate with replacement,
and focus the destination h1. Rate-limit feedback gives retry guidance and disables
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
protected content and clears unsaved state in sibling tabs; logout-confirmed
sets anonymous state. A received login/session-change signal triggers a session
check, not trust in the message. On visibility returning to visible, recheck the
session and temporarily hide protected content until resolved. API authorization
remains the security boundary even if a tab misses a message. No guarantee that
already displayed data can be erased from an offline/suspended browser.

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
- Database roles/anonymous Data API cannot read or mutate private tables.

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
  state and retry; successful retry revokes server session. Returning a stale
  tab to foreground rechecks session before showing protected content.
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
   their files. Block draft acceptance until cross-spec ownership is settled.
8. Add browser acceptance coverage and operator/setup documentation; align
   AGENTS.md/DESIGN.md mock identity references with approved real auth. Run
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
- Same-origin credentials, JSON plus X-CSRF-Protection: 1 on mutations, exact
  Origin validation. Never use browser database credentials or frontend guards
  as authorization. No automatic mutation retry.
- Each protected endpoint checks current session/account/role. Derive actors on
  backend. Draft access additionally requires creator ownership.
- Spec 1 owns shell/router/auth/client/errors. Domain specs own screens,
  validation and database workflows; coordinate shared files before changes.
- Eight-hour absolute expiry. Recovery is same-account, memory-only, no automatic
  replay. Spec 3 owns payload/key/version and uncertain-submission reconciliation.
- Persisted manual drafts are approved but domain endpoint/UI allocation remains
  unresolved across Specs 2-4. Saved drafts survive logout; unsaved changes do not.
- Decimal-string money is proposed pending Spec 3 agreement; do not silently
  establish currency, precision, range or database representation here.

## Security Review Outcome

The design explicitly covers credential enumeration mitigation, login CSRF,
session fixation, token leakage, rate-limit races, proxy spoofing, revocation
races, unsafe redirects, infrastructure failures and cross-account draft leaks.
Residual limitations include weak eight-character passwords without MFA,
targeted email throttling, distributed/IPv6 attacks, no retroactive cancellation
of authorized requests, indefinite saved-draft retention, and best-effort clearing
of already displayed data in other tabs. These are documented limitations, not
claims that planned controls have been implemented or tested.
