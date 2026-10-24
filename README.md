# Sejuk Sejuk Service: Module 1

An admin operations application implementing the four integrated specifications in
`specs/`: real authentication, persisted service-order lists, private manual
drafts, transactional order creation/assignment, and read-only saved-order detail.
The assessment's mock-login suggestion is superseded by the approved real-auth
contracts. There are no technician completion/payment, manager, WhatsApp, AI, or
upload features.

## Requirements

- Node **24 LTS** and npm; one root `package-lock.json` and npm workspaces.
- An explicitly authorized, dedicated PostgreSQL/Supabase project for application
  setup. Do not point migration or operator commands at a shared environment
  without approval. PostgreSQL must use UTF-8 and provide `gen_random_uuid()`.
- Separate trusted migration and provisioning connections, and an unprivileged
  `app_runtime` connection. No Supabase Auth or browser Supabase client is used.
- Chromium for browser tests: `npx playwright install chromium`.

Resolved versions include TypeScript 5.9.3, Fastify 5.12.7, pg 8.23.1,
React 19.3.1, React Router 7.18.4, Vite 7.3.7, Tailwind 4.3.3,
Argon2 0.44.0, Vitest 5.0.5, and Playwright 1.64.1. The lockfile is authoritative.

## Setup

1. Install Node 24, then run `npm ci` from the repository root.
2. Configure an untracked `.env` using `.env.example` as the field reference.
   All example passwords/secrets are placeholders. Generate at least 32 random
   bytes for `LOGIN_LIMIT_HMAC_SECRET`; do not reuse the example text.
3. Have the database operator establish a dedicated database and trusted migration
   login. Its privileges must support schema/table/sequence creation, role
   creation/administration, and temporary function-owner membership/ownership
   transfer. It must not be the runtime login. A superuser is not required:
   tests execute migrations as a separate NOSUPERUSER CREATEROLE database owner.
4. Set `MIGRATION_DATABASE_URL` and run `npm run db:migrate`. The ordered,
   transactional migrations create `app_private`, restricted roles, accounts,
   sessions, limiter buckets, technicians, orders, drafts, and operation receipts.
   The runner serializes with an advisory lock and records SHA-256 checksums in
   `public.app_migrations`. Never edit migrations already applied to a durable
   environment; add a new migration instead.
5. Set a strong password for `app_runtime` using trusted database tooling and set
   `DATABASE_URL` to that login. It must have no privileged memberships, ownership,
   superuser, BYPASSRLS, CREATEROLE, CREATEDB, or schema CREATE privileges.
6. Establish a separate trusted operator login with the `app_provisioner` grants
   (the migration creates this NOLOGIN privilege group). Configure its distinct
   `PROVISION_DATABASE_URL`. Keep that connection inaccessible to the web runtime.
7. Run `npm run account -- create-admin admin@example.test`. Enter and confirm the
   password through the hidden interactive prompts. No password argv, environment
   variable, committed seed, registration page, or role selector exists.
8. Run `npm run dev` and open **http://localhost:5173**. Vite proxies `/api` to the
   loopback backend on port 3000. `PUBLIC_ORIGIN` must match exactly; do not mix
   `localhost` and `127.0.0.1`.

Root migration/operator/start scripts load `.env` when it exists. Development
requires it. Tests never use these database URLs: they create disposable local
clusters with synthetic accounts, random credentials, UTF-8 encoding, and unique
test directories. There is no reset command targeting a supplied database URL.

## Commands

```sh
npm run dev
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
npx playwright install chromium
npm run test:e2e
npm run build
npm start
npm run db:migrate
npm run account -- create-admin admin@example.test
npm run account -- replace-password <account-uuid>
npm run account -- deactivate <account-uuid>
npm run account -- activate <account-uuid>
npm run account -- revoke-sessions <account-uuid>
npm run account -- cleanup-auth
```

`npm start` runs the **bundled** `build/server.mjs` from the repository root.
Set `NODE_ENV=production` to serve `apps/web/dist` and enable production cookie
and origin requirements. Do not run the old `apps/api/dist` artifacts or import
the development contracts package directly with native Node: the production
build bundles local TypeScript contracts while leaving runtime npm dependencies
external. Keep runtime dependencies installed on the same target platform as
Argon2's native binary. Development/migration/operator commands use `tsx`.

Run `cleanup-auth` daily through the host scheduler using trusted operator
credentials; it removes expired sessions and limiter rows older than 24 hours.
It is not an HTTP operation and runtime cannot delete limiter rows.

## Implemented Workflows

### 1. Authentication

- Individually provisioned active admins, Argon2id passwords, five-email/thirty-IP
  attempts per 15-minute database-backed window, four concurrent password workers.
- Eight-hour absolute sessions: 32 random token bytes, only SHA-256 token hashes
  stored, HttpOnly/SameSite cookies, role/activity/expiry checked on each API call.
- Exact same-origin JSON/custom-header mutation policy, bounded bodies, no CORS,
  generated request IDs, sanitized errors, no-store responses, script CSP and
  frame restrictions. SQL bindings, credentials, cookies and customer bodies are
  not logged.
- Login verifies the current session again after its successful response; protected
  failures never set/delete cookies. Logout revokes only its presented token.
- Auth generations, synchronous suspend/resume/destroy, memory-only same-account
  recovery, hidden retained views, cross-tab invalidation, and explicit failed
  logout recovery. Frontend state is not an authorization boundary.

### 2. Service Orders And My Drafts

- All admins can list saved orders. Drafts are creator-only and unsubmitted.
- Twenty-five-row forward keyset pagination with strict browser/server-shared
  cursors preserving PostgreSQL microseconds, local Previous history, and explicit
  refresh/retry. There are no totals, filters, polling, or mock rows.
- Narrow summary projections, responsive semantic tables/cards, Kuala Lumpur
  timestamps, and account-bound memory-only focus/scroll/list-return context.

### 3. Creation And Drafts

- Required final customer/service/technician fields, optional notes, code-point
  bounds, Unicode validity, LF normalization, exact integer-sen MYR money.
- Active technician selection, narrow transactional technician lock, real
  sequence-generated `SO-000001` numbering, Assigned status, server actor/time.
- Manual incomplete draft create/load/save/delete/submit, expected versions,
  private ownership, conflict-specific actions, maximum-version deletion, and
  atomic draft-to-order conversion without an intermediate save.
- Account-wide idempotency keys, canonical fingerprints, advisory and row locks,
  minimal indefinitely retained receipts, exact replay, and read-only outcome
  reconciliation. Lost responses freeze the attempted key/body; no mutation is
  automatically retried or replaced. A rejected retry cannot erase older
  uncertainty. Unsaved changes and pending operations have guarded navigation.

### 4. Saved Detail

- Independently authorized database retrieval, every canonical saved business
  field, visible actor UUIDs, and read-only display even if the technician later
  becomes inactive.
- Account-bound, memory-only, single-visit creation confirmation compares ID,
  order number and timestamp against independently fetched detail. Mismatches
  withhold customer data. Failed detail retrieval never means creation failed
  and never invites automatic resubmission.
- Read-only retries, dismissible persistent feedback, refresh/departure expiry of
  confirmation, and originating-list versus newest-list return behavior.

## Architecture And Decisions

`apps/web` is React/Vite/React Router/Tailwind; `apps/api` is a same-origin
Fastify/pg backend. `packages/contracts` contains browser-safe DTOs, validation
helpers and cursor/money contracts. SQL lives in `db/migrations`.

Database authorization is enforced by backend custom sessions plus SQL ownership
predicates and explicit database grants, **not** `auth.uid()` or Supabase Auth RLS.
`app_private` must remain excluded from PostgREST's exposed schemas. Runtime can
read technicians but cannot lock them directly or modify them. Only the narrow
`SECURITY DEFINER` technician function obtains the required row lock. Runtime
cannot update/delete orders or receipts.

No product contracts were intentionally relaxed. Integration choices include an
esbuild production backend bundle, a NOLOGIN provisioning privilege group, and
embedded **real PostgreSQL 17.9** for isolated tests instead of Docker. Local
build/start smoke checks are not a deployment. CSP allows inline **styles**
used by React, but production **scripts** remain self-only without unsafe-inline
or unsafe-eval. No remote fonts/assets are required; installed Inter falls back
to the local sans-serif stack.

## Verification Evidence

Verification uses Node **24.22.1** explicitly on this Windows machine because its
default installed Node is 22.22.3. Installation also succeeded under the default
runtime with the expected engine warning; use Node 24 for normal development.

Executed commands include `npm install`, `npm ci`, `npm audit`, `npm run
typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:integration`,
`npm run test:e2e`, and `npm run build`. Test tools were additionally invoked
directly with the Node 24 executable to avoid shell/runtime ambiguity.

Final results:

| Check | Result |
| --- | --- |
| Reproducible dependency install | Passed; one root lockfile |
| Typecheck and ESLint | Passed |
| Unit/component suites | 220 passed in 23 files |
| PostgreSQL integration suites | 37 passed in 4 files |
| Chromium desktop/mobile journeys | 20 passed |
| Repeated list-return focus regression | 8 additional runs passed |
| Frontend/backend production build | Passed |
| Native Node 24 production smoke | Passed |
| npm audit | 0 reported vulnerabilities |

The independent read-only review was followed by fixes and regressions for
delayed successful login cookies, stale editor recovery captures, retained
uncertainty after rejected retries, draft return context, and native production
contract resolution. Browser testing additionally exposed and fixed a route
heading/list-return focus race. No known failing automated check remains.

The suites exercise real persisted workflows and privilege denials, same-key
concurrency, draft version races, rollback after receipt-insertion failure for
all five operations, lock timeout/retry, uncommitted receipt invisibility,
technician deactivation locking, microsecond pagination, Unicode/byte boundaries,
maximum version behavior, auth lifecycles, and cookie response ordering.

The native production smoke command is:

```sh
node --import tsx tests/support/production-smoke.ts
```

Run it after `npm run build`. It checks bundled native startup, SPA deep links,
static assets, JSON API misses, script CSP, and sanitized cookie-neutral database
outage responses. It uses synthetic unused loopback connection information,
not application credentials. Approved Argon2 policy benchmark on this host:
179 ms hash and 191 ms precomputed-dummy verification; host-specific, not an SLA.

## Limits And Deployment Gates

- No deployment, Supabase project, external credentials, proxy, or shared database
  was provisioned or modified. Live Supabase/PostgREST denial, verified remote
  database TLS, HTTPS cookie behavior, trusted-proxy IP attribution and host
  connection budgets still require environment-specific smoke checks.
- Configure a single HTTPS `PUBLIC_ORIGIN`, exact `TRUSTED_PROXY_CIDRS` (default
  none), proxy forwarding-header replacement, and prevent direct backend bypass.
  The backend binds loopback. The TLS terminator must supply HSTS. Never disable
  database certificate verification; connection-string SSL overrides are stripped.
- `DB_POOL_MAX` defaults to 10 (validated 1-50), but the operator must budget total
  pools and four 64-MiB Argon2 workers per process against actual host limits.
  Origin/proxy/database settings are not a substitute for host-level request and
  connection limits. HMAC secret rotation resets effective rate-limit buckets.
- Manual screen-reader, physical-device, browser-native zoom, and non-Chromium
  browser checks remain unverified. Automated tests check keyboard/focus states,
  Chromium desktop/mobile, 360/768/1280/1440 widths and enlarged text.
- There is no MFA or password reset; the approved eight-character minimum remains
  a weak-password risk. No guarantee covers distributed/rotating-IP attacks.
- Cookie response arrival order can remove a newer cookie or establish a later
  login after logout; tests assert these limitations rather than global sign-out.
  Broadcast coordination is best effort, not a cross-tab lock.
- Drafts/receipts have indefinite retention. Memory-only edits, keys, list context
  and confirmation are lost on refresh/closure. Never-saved forms have no lost-key
  deduplication. Sequence gaps are allowed. Draft pagination is not a snapshot.
- Already-authorized work may finish after revocation. Technician names are
  current references, not historical snapshots. Offline/suspended browsers cannot
  be guaranteed to erase previously displayed data.
