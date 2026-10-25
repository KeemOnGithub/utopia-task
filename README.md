# Sejuk Sejuk Service: Module 1 & Operations Query Window

Internal operations management system built for **Sejuk Sejuk Service Sdn Bhd**, an air-conditioning installation, servicing, and repair company.

---

## 1. What Was Built

This application implements **Module 1 (Admin Portal · Order Submission)** extended with the **Operations Query Window (Spec 5)**:

- **Order Submission Workflow:** An administrative interface for creating service orders with auto-generated sequential order numbers (`SO-000001`), customer information, service classification, price quoting in exact integer sen, and mandatory technician assignment to an active seed technician (Ali, John, Bala, Yusoff).
- **Private Manual Drafts:** Private, version-controlled drafts allowing admins to prepare complex orders incrementally without allocating live operational order numbers or locking technicians prematurely.
- **Order Registry & Detail:** Read-only paginated order listing and detail views with cryptographic creation receipts, transactional concurrency protection, and microsecond-precision keyset pagination.
- **Operations Query Window (AI Assistant):** An internal conversational query assistant allowing operations managers and admins to query service history, technician workloads, order counts, and financial quotes using natural language.
- **Role-Gated Portal:** Real dual-role authentication supporting both `admin` (order creation, drafts, listing, detail, AI assistant) and `manager` (read-only order listing, detail, and AI assistant).

> **UI/UX Philosophy:** Prioritized a functional, responsive, and intuitive interface designed specifically for real-world desktop operations with mobile responsiveness. Rather than relying on generic, unstyled "vibecoded" templates, the UI emphasizes clear visual hierarchy, accessible keyboard interactions, explicit validation feedback, and robust loading/error states.

---

## 2. Tech Stack Used

| Layer | Technology | Rationale & Choice |
| :--- | :--- | :--- |
| **Frontend** | React 19, React Router 7, Vite 7 | Provided company preference. Lightweight, fast rendering, component modularity, and rapid DX via Vite. |
| **Styling** | Tailwind CSS 4 | Clean, practical utility-first styling for accessible desktop tables and responsive mobile views without heavyweight UI library lock-in. |
| **Backend** | Node.js 24 LTS, Fastify 5 | High-performance, low-overhead HTTP engine with schema validation, native JSON handling, and strict same-origin API routes. |
| **Database** | PostgreSQL 17 / Supabase | Strong ACID guarantees, sequences for gap-safe concurrent order numbering, and granular schema privilege controls. |
| **Driver & Pooling** | `pg` (node-postgres) | Direct, predictable parameterized SQL without heavyweight ORM abstraction layers. |
| **Password Hashing** | Argon2id | Memory-hard, state-of-the-art password security with thread-pool-bounded verification. |
| **Testing** | Vitest, Testing Library, Playwright | Comprehensive unit, PostgreSQL integration (`embedded-postgres`), and end-to-end browser journeys. |
| **Repository Structure** | npm workspaces (monorepo) | Single lockfile spanning `apps/web`, `apps/api`, and `packages/contracts` for end-to-end TypeScript type safety. |

*Note on infrastructure:* Containerization tools (like Docker) were intentionally avoided for local development and demo setup to keep the setup friction-free, fast, and transparent.

---

## 3. Architecture Decisions

### Custom Session Authentication & Role Privilege Isolation
The assessment noted that real authentication was not strictly required and suggested mock logins or role switches. However, because internal operations tools handle sensitive customer addresses and financial quotes, this system implements **production-grade custom database session authentication**:
- **Granular Database Roles:** Separates database access across distinct privilege tiers:
  - `migration`: Runs migrations and schema changes with an advisory lock ledger.
  - `app_provisioner`: Secure CLI operator connection for provisioning accounts with hidden password prompts (`npm run account -- create-admin`).
  - `app_runtime`: Unprivileged application connection with `NOINHERIT`, no DDL permissions, and restricted `SECURITY DEFINER` function calls for row locking.
- **Token Security:** Sessions use 32 crypto-random bytes stored solely as SHA-256 hashes in PostgreSQL, transmitted over `HttpOnly`, `SameSite=Strict` cookies.
- **Anti-Brute-Force:** Database-backed HMAC rate-limiting buckets (5 email / 30 IP attempts per 15-minute window).

### Concurrency-Safe Order Number Generation
Order numbers (`SO-000001`) are backed by a dedicated PostgreSQL sequence (`app_private.order_number_seq`). This avoids race conditions and collision bugs inherent in naive `COUNT(*)` or client-side generation under concurrent admin submissions.

### Financial Precision (Integer Sen)
Quoted prices are parsed and stored as integer cents (`sen`, e.g., RM 150.50 is stored as `15050`). This eliminates floating-point rounding errors and IEEE-754 precision issues across calculations, database constraints, and API contracts.

### Browser/Server Shared Contracts
Browser and API share TypeScript validation schemas and DTOs via `packages/contracts`. The browser code never imports server libraries or database drivers, and the backend validates every request boundary independently.

---

## 4. Challenges & Assumptions

### Challenges Encountered
1. **LLM Output Formatting & JSON Boundaries:** In previous projects and initial prototypes, strict JSON generation frequently broke when LLMs outputted conversational preambles, reasoning chatter, or unescaped markdown blocks. To solve this, a strict JSON boundary sanitizer was built to strip markdown code blocks and parse structured payloads reliably before contract validation.
2. **Controlled Retrieval vs. Hallucination:** Preventing the AI from generating nonexistent order numbers or fabricated revenue metrics. Addressed by decoupling intent interpretation from SQL querying, forcing all factual answers to be grounded in database evidence.
3. **Draft Concurrency & Mutation Races:** Ensuring that multiple admin tabs or lost network responses cannot accidentally create duplicate orders or overwrite versioned drafts. Solved using atomic version checks and transaction-bound idempotency keys.

### Core Business Assumptions
- **Mandatory Technician Assignment:** Orders cannot be left unassigned upon creation. Creating an order automatically transitions it to `Assigned` status with a locked technician.
- **Active Seed Technicians:** The four technicians (Ali, John, Bala, Yusoff) are operational resources with stable UUIDs, not portal login accounts.
- **Malaysian Operational Context:** Working hours, relative date ranges (today, this week, last week), and reporting intervals are evaluated strictly in **Malaysian Time (MYT / Asia/Kuala_Lumpur, UTC+8)** regardless of the host server's local clock.
- **Quoted Price vs. Revenue:** Quoted prices represent job estimates, not collected revenue (which belongs to post-completion Module 2).

---

## 5. How AI Was Integrated (Operations Query Window)

The Operations Assistant implements a **two-stage, privacy-preserving controlled retrieval pipeline**:

```
User Question
      ↓
[Stage 1: Intent Interpretation]
LLM maps question + active technician list + MYT date context -> Validated QueryPlan (JSON)
      ↓
[Stage 2: Controlled Data Retrieval]
Backend executes strict, parameterized PostgreSQL query based on QueryPlan
      ↓
[Privacy Scrubbing]
Database rows converted into sanitized ProviderRetrievalDto (PII stripped)
      ↓
[Stage 3: Grounded Summarization]
LLM summarizes structured evidence into a clear narrative (or Deterministic Fallback triggers)
      ↓
Browser UI displays narrative + structured data cards + direct links
```

### Key AI Architecture Safeguards
1. **No Direct SQL Execution:** The LLM is never given direct SQL access or arbitrary query privileges. It can only emit a bounded `QueryPlan` intent corresponding to pre-written parameterized queries.
2. **PII & Data Privacy:** Customer phone numbers, exact street addresses, and internal database UUIDs are scrubbed before sending data to the summarization model.
3. **Deterministic Summary Fallback:** If the external AI service is unreachable, disabled, times out, or fails schema validation, the system automatically falls back to a deterministic, rule-based summary generator (`generateDeterministicSummary`).
4. **Multi-Tenant Admission & Rate Limiting:**
   - Single concurrent AI question per account (HTTP 429).
   - Deployment concurrency lease limit (HTTP 503).
   - Account quota of 10 questions per 5 minutes.
   - Global daily deployment limit (default 500 queries/day).

---

## 6. Supported Types of AI Queries

The Operations Assistant supports five distinct query operations across flexible time horizons (today, this week, last week, this month, explicit dates):

| Query Class | Description | Example Queries |
| :--- | :--- | :--- |
| **Order Lookups** | Detailed status and metadata for a specific order. | *"What is the status of order SO-000001?"*<br>*"Find details for order SO-000005."* |
| **Order Volume & Counts** | Aggregate count of orders matching status, technician, service type, or timeframe. | *"How many jobs were scheduled today?"*<br>*"How many aircond servicing jobs were created this week?"* |
| **Technician Workload** | Listing and inspecting orders assigned to a specific technician. | *"What jobs are assigned to Ali this week?"*<br>*"Show me orders handled by Bala last week."* |
| **Technician Leaderboards** | Ranking technicians by total completed/assigned orders or quoted value. | *"Which technician has the most jobs this week?"*<br>*"Rank technicians by order count this month."* |
| **Quoted Value Metrics** | Total monetary value quoted across service categories and periods. | *"What is the total quoted value of repair orders this week?"*<br>*"What is our total quoting volume for this month?"* |

*Follow-up handling:* The assistant retains an in-memory history of the last 6 exchanges, allowing natural conversational refinements (e.g., asking *"What about Bala?"* after inquiring about Ali).

---

## 7. System & AI Limitations

### System Limitations
- **Modules 2 & 3 Out of Scope:** Field technician job completion, photo/PDF file uploads (Supabase Storage), payment collection, WhatsApp deep-link notifications, and manager review sign-offs are not implemented.
- **Incomplete Manager Role:** Because review workflows and KPI dashboards (Modules 2 & 3) are out of scope, the `manager` role currently functions solely as a read-only viewer for order listings, order details, and the AI Operations Assistant. Production expansion would include full role-based access control (RBAC).
- **No Self-Service Password Reset / MFA:** User provisioning and password changes must be performed via the trusted CLI operator tool (`npm run account`).
- **Memory-Bound UI Drafts:** Unsaved form inputs exist only in component state until explicitly saved as a private draft.

### AI Implementation Limitations
- **Strictly Read-Only:** The AI assistant cannot modify, create, cancel, or reassign orders. It cannot execute mutations.
- **No Streaming Responses:** To prioritize deterministic schema validation, evidence grounding, and JSON error handling, AI responses are generated and returned in a single structured round-trip rather than progressive token streaming.
- **No Document / Multimodal Understanding:** The query window does not process images, PDFs, or audio inputs.
- **Episodic Context Window:** Conversation history is stored in-memory per browser tab and capped at 20 exchanges. Refreshing the browser or switching accounts resets the conversation.

---

## 8. Setup & Development Guide

### Prerequisites
- **Node.js 24 LTS** and npm.
- **PostgreSQL 17+** (or Supabase project) with UTF-8 encoding.
- Chromium for browser testing: `npx playwright install chromium`.

### Step-by-Step Setup

1. **Install Dependencies:**
   ```sh
   npm ci
   ```

2. **Configure Environment:**
   Copy `.env.example` to `.env` and fill in the required keys:
   ```sh
   cp .env.example .env
   ```
   *Generate at least 32 random bytes for `LOGIN_LIMIT_HMAC_SECRET`.*

3. **Run Database Migrations:**
   Using trusted migration credentials:
   ```sh
   npm run db:migrate
   ```

4. **Provision Accounts:**
   Create an admin account using the secure operator CLI:
   ```sh
   npm run account -- create-admin admin@example.test
   ```
   *(Optionally create a manager account with `npm run account -- create-manager manager@example.test`)*.

5. **Start Development Servers:**
   ```sh
   npm run dev
   ```
   Open **http://localhost:5173**. Vite proxies backend requests to port 3000.

---

## 9. Verification & CLI Commands

```sh
# Verification & Testing
npm run typecheck                  # Verify TypeScript types across all workspaces
npm run lint                       # Run ESLint checks
npm run test:unit                  # Run Vitest unit & component test suites
npm run test:integration           # Run PostgreSQL integration tests (isolated embedded cluster)
npm run test:e2e                   # Run Playwright end-to-end tests
npm run build                      # Build production web bundle and API package
npm start                          # Run native bundled server (build/server.mjs)

# Operator CLI Commands
npm run account -- create-admin <email>       # Provision an administrator account
npm run account -- create-manager <email>     # Provision a manager account
npm run account -- replace-password <uuid>    # Reset an account password
npm run account -- revoke-sessions <uuid>     # Revoke all active sessions for an account
npm run account -- cleanup-auth               # Purge expired sessions and rate-limit buckets
npm run account -- cleanup-ai                 # Purge expired AI admission leases and usage logs
```

### Automated Test Coverage
- **Unit / Component Tests:** 247 tests in 26 test files covering contracts, form validation, and components.
- **Database Integration Tests:** 45 tests exercising transactional locks, sequence generation, and role permissions against an isolated PostgreSQL instance.
- **End-to-End Tests:** 26 Playwright journeys validating desktop and mobile viewports, login flows, order submissions, and AI query interactions.
