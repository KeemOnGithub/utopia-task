# AGENTS.md

## Project Overview

Build a simplified internal operations system for Sejuk Sejuk Service,
an air-conditioning installation, servicing, and repair company.

Read `Programmer Assessment.md` for the assignment requirements.
Prioritize complete, well-explained workflows over feature count.

## Project Scope

Implement Module 1: Admin Portal / Order Submission.

The primary workflow is for an admin to create a service order,
assign a technician, and save the order to Supabase.

Required fields:
- Order number (auto-generated)
- Customer name
- Phone
- Address
- Problem description
- Service type (dropdown)
- Quoted price
- Assigned technician
- Admin notes

Seed technicians: Ali, John, Bala, Yusoff (stable IDs, not login accounts).
Admin notes are optional; final assignment is mandatory. Specs 1-4 in `specs/`
are the authoritative integrated implementation-ready design, not working code.
Approved scope includes real admin authentication, read-only order list/detail,
and private manually saved versioned drafts with uncertain-outcome reconciliation.

Prioritize a responsive, accessible form, reliable persistence,
validation, and clear submission feedback. Admin users primarily
work on desktop, but the interface must also work on mobile.

Optional enhancements, only when requested:
- Send a WhatsApp notification to the assigned technician.

Out of scope unless explicitly requested:
- Technician job completion and payment recording
- Job-completion notifications
- Manager review workflows
- KPI dashboards
- AI features

No mock identity or role selector substitutes for approved real authentication.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Front-end | React |
| Styling | Tailwind CSS |
| Backend / Database | Supabase |
| File Storage | Supabase Storage |

Module 1 does not currently require file uploads. Do not add an upload
feature solely to use Supabase Storage.

Approved foundation: TypeScript, Node 24 LTS, Fastify, pg, React/Vite/React Router,
Tailwind, npm workspaces with one lockfile; Vitest/RTL, database integration tests
and Playwright. Same-origin frontend/API, custom database sessions, no Supabase
Auth. Dependency versions and deployment provider remain execution choices.

## Setup and Commands

The application has not been scaffolded yet, so no installation,
development, build, or test commands are established.

Once tooling exists, update this section with verified commands from
the project's configuration. Use the existing package manager and
lockfile; do not introduce competing lockfiles.

## Business Workflow

The full assessment lifecycle is context, not the implementation scope:

`New -> Assigned -> In Progress -> Job Done -> Reviewed -> Closed`

Implement only the states and transitions needed for order creation
and technician assignment. Admins assign technicians, and key actions
should be traceable to an actor and timestamp.

Order numbers must be unique, auto-generated, and safe under concurrent
submissions. Do not rely on client-side record counts to generate them.

Spec 3 settles mandatory technician assignment, initial Assigned status, MYR
0.00..999999.99 integer-sen storage and sequence-backed SO-000001 numbering
(minimum six digits, expands, gaps allowed). Drafts have no order number or
operational assignment. Do not reopen these as pending business decisions.

Do not describe role switching or client-side checks as real security.

## Implementation Guidelines

- Prefer the smallest correct solution; avoid speculative abstractions.
- Follow established project patterns once they exist.
- Keep business rules separate from presentation where practical.
- Reuse shared logic for calculations and workflow transitions.
- Validate user input and provide clear, actionable error messages.
- Handle loading, empty, error, and success states.
- Use accessible labels, semantic HTML, keyboard interactions, and
  visible focus states.
- Avoid unrelated refactors and preserve changes made by others.

## Supabase and Security

- Keep schema changes in version-controlled migrations.
- Never commit credentials, API secrets, or real customer data.
- Never expose Supabase service-role keys in browser code.
- Use the private app_private schema and restricted backend database roles in
  Specs 1/3. Deny browser/Data API access; custom sessions do not set auth.uid().
- Backend authorization is mandatory; do not claim Supabase Auth RLS protects
  custom sessions. Use the narrow technician lock function, not runtime writes.
- Use synthetic data for development and demos.
- Do not run destructive database operations or modify a shared
  environment without explicit approval.

## Verification

- Run relevant checks available in the project before completing work.
- Add or update focused tests for changed business logic, especially
  form validation, order-number generation, persistence, and assignment.
- Verify submission feedback and failure handling.
- For interface changes, check desktop and mobile behavior.
- Do not claim checks passed unless they were actually run.
- Report failed checks, missing tooling, and unverified behavior clearly.

## Delivery and Documentation

- Keep changes focused on the requested task.
- Do not commit, push, deploy, or provision external services unless
  explicitly requested.
- Keep the README aligned with implemented behavior, setup steps,
  architecture decisions, assumptions, and limitations.
- Distinguish working features from mocked or planned functionality.
- Update this file when commands or project conventions change.
