# Module 1: Scope and Process Plan

## Purpose

Build the Admin Portal / Order Submission module for Sejuk Sejuk Service.
Prioritize a complete, reliable workflow over feature count: an authorized
admin creates an order, assigns a technician, saves it to Supabase Postgres,
and can find the saved order again.

This document records the planning discussion. It does not claim that any
application features or database schema have been implemented or verified.
Use `Programmer Assessment.md` for assessment context and `DESIGN.md` for
the established visual and accessibility guidelines.

## Agreed Scope

- Implement real login using pre-created accounts stored in the database.
- Do not use Supabase Auth.
- Verify passwords and permissions on a backend API, never in React.
- Use password hashing and expiring, database-backed sessions.
- Implement order creation and technician assignment with Supabase persistence.
- Provide clear validation, submission progress, failure, and success feedback.
- Keep the interface responsive and accessible on desktop and mobile.

The following process refinements are approved for implementation in Specs 1-4:

- Use a read-only Service orders list as the homepage instead of a dashboard.
- Provide a saved-order detail page, also used as the post-submission summary.
- Require technician assignment when creating an order.
- Save newly created, assigned orders with status `Assigned`.

These refinements and private manual drafts are approved scope expansions,
not additional requirements stated explicitly by the unchanged assessment.
The four integrated specs are implementation-ready and authoritative over older
recommendations in this discussion. No application behavior is implemented.

## Critical Review of the Original Flow

### Login

Real login is a deliberate expansion beyond the assessment's minimum mock
identity. A users table with password hashes is viable, but hashing alone is
not authentication: the application also needs secure verification, session
management, authorization, expiry, and login-attempt protection.

A frontend route guard only controls navigation. Every protected API endpoint
must independently verify the session and the user's admin permission.

### Dashboard Homepage

Graphs are not necessary for Module 1. Technician KPI reporting belongs to a
separate bonus module, and completion metrics would be misleading without the
technician completion workflow.

Use Service orders as the homepage with a prominent Create service order
action. Add charts only when a useful operational question and supporting data
justify them. Do not display fabricated operational metrics.

### Submission Form

Spec 3 settles required assignment, installation/servicing/repair, MYR
0.00..999999.99 in integer sen and sequence-backed SO-000001 numbering with
minimum six digits, expansion and gaps. Notes are optional; status is Assigned.

The form must account for invalid input, database rejection, network failure,
expired sessions, and uncertain outcomes, not only successful submission.

### Success Dialog and Redirect

Use "Order created", not "Order complete": creating an order does not mean
the service job is finished.

Redirect to the saved order detail page with persistent success
feedback containing the actual saved order number. Avoid showing a dialog and
then immediately redirecting automatically.

No alternative success dialog: Spec 4 owns memory-only receipt feedback and
independent persisted retrieval, including read failure after confirmed creation.

### Orders List and Status

A read-only list makes persistence visible and lets admins recover their work.
It does not imply that editing, deletion, job completion, or manager review
must also be implemented.

Use the assessment lifecycle names consistently rather than ambiguous labels
such as Pending or Complete:

`New -> Assigned -> In Progress -> Job Done -> Reviewed -> Closed`

Only implement states and transitions needed for Module 1. Do not provide a
mark-complete action without the technician workflow.

## Approved User Process

1. Admin opens the portal.
2. The application checks the existing session through the backend.
3. Without a valid session, show the login page.
4. Backend verifies credentials, active account status, and admin role.
5. On success, establish a session and open Service orders.
6. Admin selects Create service order and completes the form.
7. Frontend validates inputs and focuses the first invalid field if needed.
8. Backend authenticates and authorizes the request, validates the payload,
   and atomically creates the order and assignment metadata.
9. Database generates a unique order number and server timestamps.
10. After confirmed success, open the saved order detail page and announce
    "Order SO-000123 created successfully" using the actual saved number.
11. Admin can return to Service orders or create another order.

On validation or persistence failure, preserve inputs, explain the error, and
allow correction or retry. On an uncertain outcome such as a lost response,
reconcile the submission using its idempotency key rather than blindly
creating another order.

## Architecture

`React + Tailwind CSS -> Small backend API -> Supabase Postgres`

- React handles presentation, input, navigation, and feedback.
- The backend handles credentials, sessions, authorization, validation,
  database operations, and safe error responses.
- Supabase Postgres stores accounts, sessions, technicians, orders, private drafts
  and account-scoped idempotency receipts retained after draft deletion.
- No separate file-storage workflow is needed for Module 1.
- Spec 1 fixes TypeScript/Node 24/Fastify/pg, React/Vite/React Router/Tailwind,
  npm workspaces, Vitest/RTL/database integration/Playwright and same-origin API.
  Actual versions and deployment provider remain execution configuration.

## Authentication and Security Requirements

### Accounts

- Pre-create admin accounts through trusted tooling.
- No public registration, role switching, or self-service password reset in
  the initial scope.
- Store a unique normalized email, password hash, role, and active flag.
- Hash passwords with Argon2id through a maintained library that handles salts.
- Never store plaintext passwords or use plain SHA-256 for password hashing.
- Never return password hashes to the browser or include credentials in logs.
- Do not allow users to grant themselves an admin role.

### Login and Sessions

- Submit credentials over HTTPS in deployed environments.
- Return a generic "Invalid email or password" message for failed credentials.
- Rate-limit login attempts.
- Generate session tokens using a cryptographically secure random generator.
- Store only the token hash, associated user ID, and expiry in the database.
- Send the token in an `HttpOnly`, `Secure`, `SameSite` cookie. Configure local
  development separately without weakening deployed cookie settings.
- Define an explicit session lifetime and enforce expiry on the backend.
- Check the session, active account status, and role on every protected request.
- Restore login state on refresh through a backend session endpoint.
- Successful logout revokes only its presented database session and deletes the
  cookie. Concurrent login may establish another session; browser response-order
  races and best-effort cross-tab coordination are bounded explicitly in Spec 1.
- Protected API/session-verification failures never set/delete cookies; login
  replaces invalid cookies, explicit logout deletes them. Signals require fresh
  verification, not assumptions about the current browser cookie/account.
- Do not store session tokens in `localStorage`.
- Protect state-changing requests against CSRF with an appropriate SameSite
  policy and server-side origin validation.

### Database Access

- Do not expose a Supabase secret or service-role key to browser code.
- Deny direct anonymous access to application tables and credential data.
- Keep privileged database access on the backend.
- Use restricted backend pg roles and app_private, not a browser Supabase client
  or service-role key. Shared custom-session authorization runs on every endpoint.
  Spec 3's narrow SECURITY DEFINER helper locks technicians without granting
  runtime technician UPDATE. RLS does not identify these custom sessions.
- Do not assume custom session cookies populate Supabase Auth identity or
  make policies based on `auth.uid()` work automatically.
- Keep migrations version-controlled and use synthetic development data.
- Do not modify shared database environments or perform destructive operations
  without explicit approval.

## Form and Business Rules

| Field | Confirmed behavior (Spec 3) |
| --- | --- |
| Order number | Database-generated; show "Generated when created" before saving |
| Customer name | Required; trim input and reject blank values |
| Phone | Required; validate as a phone string without treating it as a number |
| Address | Required |
| Problem description | Required |
| Service type | Required controlled dropdown |
| Quoted price | Required; MYR, nonnegative, at most two decimal places |
| Assigned technician | Required; valid technician reference |
| Admin notes | Optional |

Confirmed initial service types: installation, servicing, and repair.
Seed technicians: Ali, John, Bala, and Yusoff, each with a stable database ID.

Confirmed order-number format: `SO-000123`, generated from a database
sequence or identity-backed value with a unique constraint. Gaps are acceptable.
Never generate numbers from client-side record counts or promise a reserved
number before saving.

Mandatory assignment, optional notes, service types, MYR and numbering are
confirmed by Spec 3. Unassigned order creation is not supported. Private drafts
may be incomplete and have no operational status/assignment/number.

## Frontend Requirements

### Screens

- Login: email, password, loading feedback, generic credential errors.
- Service orders: read-only persisted list and Create service order action.
- Create service order: cohesive form grouped into customer details, service
  details, and assignment and notes.
- Order detail: saved fields, order number, status, technician, creation
  metadata, and confirmed creation feedback when arriving after submission.
- Access denied: clear explanation and a sign-out option for unauthorized users.
- My drafts and draft editor: creator-only manual save/resume/delete/submit,
  version conflicts and exact-key uncertain-outcome reconciliation under Spec 3.

### Form Behavior

- Follow the tokens, layout, labels, focus treatment, and responsive rules in
  `DESIGN.md`.
- Mark optional fields explicitly and state the required-field convention.
- Use inline actionable errors linked to controls, and focus the first invalid
  field after unsuccessful validation.
- Use "Create order" and "Creating order..." for the primary action.
- Prevent repeated activation while submission is pending.
- Preserve input after failed validation or persistence.
- Show persistent operational errors with an actionable retry path.
- Announce loading, errors, and confirmed success accessibly.
- Warn before leaving a form with unsaved changes.
- Handle session expiry without silently discarding entered data; preserve the
  draft in memory during access recovery where feasible.

### List and Detail Behavior

- List order number, customer, service type, technician, quoted price, status,
  and creation time.
- Keep full addresses, phone numbers, problem descriptions, and notes on the
  detail page rather than crowding the list.
- Fetch records from the database, not only client-side submission state.
- Use pagination and deterministic sorting, such as creation time plus ID.
- Handle loading, empty results, fetch failure with retry, missing orders,
  expired sessions, and access denied.
- Provide a readable mobile layout without horizontal page overflow.
- Treat search and additional filters as follow-ups rather than prerequisites.

## Backend and Persistence Requirements

### Minimal Data Model

| Entity | Core data |
| --- | --- |
| Users | ID, unique email, password hash, role, active flag |
| Sessions | Token hash, user ID, created timestamp, expiry timestamp |
| Technicians | Stable ID, display name |
| Orders | Internal ID, sequence-backed number, submitted fields, technician ID, status, creator and assignment actor/time |
| Drafts | Creator-only incomplete fields, version, save times, retained submitted-order link |
| Operation receipts | Account/key uniqueness, normalized fingerprint, original operation/result metadata; not copied customer payload |

Store money using integer sen as Spec 3 specifies, not
floating-point storage. Use foreign keys for technician and actor references.
Derive actors from the authenticated backend session, not a trusted form field.

### Operations

- Provide login, current-session, and logout operations.
- Provide authorized technician listing, order creation, order listing, and
  single-order retrieval.
- Validate required fields, lengths, allowed service types, price precision,
  and technician references on the backend and through appropriate database
  constraints. Frontend validation is not authoritative.
- Create the order, initial assignment, and required traceability metadata in
  one transaction. Do not perform separate order and assignment requests.
- Use server-generated timestamps.
- Give each logical submission a stable idempotency key with database-enforced
  uniqueness. Retries must return or reconcile the existing result, not create
  a duplicate. Define handling for a repeated key with a different payload.
- Return the confirmed saved record or identifier and order number on success.
- Return actionable, sanitized errors without exposing SQL, secrets, or hashes.
- Do not expose deletion, reassignment, or arbitrary status-update operations
  merely to support creation.

Disabling the submit button prevents double-clicks; it does not prevent
duplicates after network timeouts. Retry protection must exist on the backend.

## Out of Scope Initially

- Public account registration and self-service password recovery.
- Technician job completion, payment recording, and file uploads.
- Manager review and lifecycle transitions beyond creation and assignment.
- KPI dashboards, graphs, and AI features.
- Order editing, deletion, and reassignment workflows.
- WhatsApp notifications.
- Deployment or external service provisioning without explicit request.

Saved detail and private drafts are approved extensions. WhatsApp remains out of scope.

## Verification and Acceptance

- A valid, active admin can log in, refresh, access orders, and log out.
- Invalid credentials, expired sessions, inactive users, and unauthorized roles
  cannot access protected API operations.
- Direct anonymous database access cannot read credentials or customer orders.
- A valid form creates one assigned order with the expected fields and
  authenticated actor metadata.
- Order numbers remain unique under concurrent submissions.
- Retrying an uncertain submission with the same key does not create duplicates.
- Backend validation rejects invalid requests even when React is bypassed.
- Failed submission preserves inputs and provides understandable feedback.
- Success appears only after confirmed persistence and includes the saved number.
- Saved orders remain available through list and detail after refresh.
- Cookie behavior, expiry, logout revocation, CSRF protection, and login rate
  limiting are tested.
- Check keyboard operation, visible focus, status announcements, and layouts
  around 360px, 768px, 1280px, and 1440px.
- Report unverified behavior and missing tooling rather than claiming success.

## Documentation Alignment

AGENTS.md and DESIGN.md are aligned with approved real auth/drafts/detail.
Specs 1-4 own exact integrated contracts and acceptance. Document verified
commands, setup and security limitations as implementation proceeds; none of
the future scripts is currently established or verified.

The existing Supabase schema and configuration have not been inspected as part
of this planning discussion. Do not assume tables, constraints, permissions,
or migrations already match this plan.
