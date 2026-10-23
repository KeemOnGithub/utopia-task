# Design Guidelines

## Purpose and Scope

This document defines the core visual design language and component
conventions for the Sejuk Sejuk Service operations web application.

The design goal is a calm, modern, and operationally dense enterprise
workspace. Prioritize clarity, fast data entry, high legibility, and
predictable navigation across desktop and mobile devices.

Visual inspiration is drawn from enterprise dashboards such as
[PrimeNG Diamond](https://diamond.primeng.dev/) as a benchmark for
aesthetic restraint, spacing, and polish, not as a component-library
dependency or a pixel-perfect specification.

Implement with React and Tailwind CSS. Do not introduce Angular or
PrimeNG, copy proprietary template code, or reuse unlicensed assets.

Current implementation scope is Module 1: Admin Portal / Order
Submission, as defined in `AGENTS.md`.

These conventions apply only to implemented features. References to
tables, modals, tabs, drawers, or destructive actions do not require
building them. Do not add screens, controls, or dependencies solely
to demonstrate this design system.

## Design Principles

- **Refined enterprise workspace:** Use a quiet, high-contrast canvas
  with subtle surface elevation rather than heavy shadows or glass effects.
- **Clear information hierarchy:** Distinguish persistent navigation,
  workspace containers, and active content through color, spacing,
  and typography.
- **Clear primary action:** Use at most one visually dominant primary
  action per active interaction context. Keep secondary actions subdued.
- **Operational density:** Balance compact spacing with readable content,
  comfortable data entry, and adequate touch targets.
- **Resilience and accessibility:** Design accessible contrast, visible
  focus, semantic markup, and understandable feedback from the start.
- **Purposeful simplicity:** Include only navigation and controls with
  implemented behavior. Avoid decorative dashboard content.

## Color System

Use the following semantic tokens consistently across the application.
This palette is an application design choice inspired by the reference,
not an exact extraction of its theme.

| Token | Value | Semantic Usage |
| --- | --- | --- |
| `canvas` | `#F5F7FA` | Primary application canvas |
| `surface` | `#FFFFFF` | Cards, panels, modals, and dropdowns |
| `surface-muted` | `#F8FAFC` | Read-only areas, table headers, subtle groupings |
| `border` | `#E2E8F0` | Structural dividers and card borders |
| `input-border` | `#64748B` | Form-control boundaries |
| `text` | `#172B4D` | Headings, body copy, and labels |
| `text-muted` | `#526176` | Supporting text, captions, and placeholders |
| `primary` | `#155E75` | Primary buttons and active accents |
| `primary-hover` | `#164E63` | Primary hover and pressed states |
| `nav-start` | `#123F50` | Navigation gradient start |
| `nav-end` | `#092A38` | Navigation gradient end |
| `success` | `#166534` | Successful operations and positive confirmation |
| `warning` | `#92400E` | Warnings and cautionary messages |
| `danger` | `#B91C1C` | Validation errors, failures, destructive actions |
| `focus` | `#0369A1` | Keyboard focus indicator |

### Color Rules

- Pair semantic colors with plain-language text and, where useful, icons.
  Never communicate status through color alone.
- Maintain at least 4.5:1 contrast for normal text and 3:1 for large text.
- Essential control boundaries and state indicators must meet applicable
  WCAG AA non-text contrast requirements.
- Use `border` for decorative structure, not as the only visible boundary
  of an interactive control.
- Verify actual foreground/background combinations, including navigation,
  hover, focus, error, and selected states.
- Use navigation gradients subtly. Keep content areas neutral.

## Typography

Use Inter Display for page and section headings where licensing and
availability permit. Use Inter for body text and controls, with a
system sans-serif fallback.

| Level | Size | Weight | Line Height | Usage |
| --- | --- | --- | --- | --- |
| Page title | `28px` | 600 | 1.2 | Top-level view title |
| Section title | `18px` | 600 | 1.3 | Card or section headings |
| Form label | `14px` | 500 | 1.4 | Labels above controls |
| Body and controls | `14px-16px` | 400 | 1.5 | Copy, inputs, and data |
| Supporting text | `13px` | 400 | 1.4 | Helpers, errors, and metadata |
| Button label | `14px` | 600 | 1.25 | Action buttons |

### Typography Guidelines

- Use sentence case for labels, headings, and buttons.
- Avoid excessive uppercase styling.
- Use `font-variant-numeric: tabular-nums` for prices, identifiers,
  and aligned numerical data where it improves scanning.
- Keep mobile input text at or above `16px` to avoid automatic zoom
  in browsers that apply it.
- Allow text and button labels to wrap without clipping.
- Ensure the interface remains usable with browser zoom and text resizing.

## Layout and Application Shell

### Desktop Layout

At approximately `1024px` and above:

- **Sidebar:** Approximately `240px` wide, using the subtle
  `nav-start` to `nav-end` gradient.
- **Navigation content:** Show the company name and only destinations
  that exist. Clearly distinguish the current destination.
- **Utility bar:** Use a restrained bar for useful page context and
  the mock admin identity. Avoid redundant breadcrumbs.
- **Identity:** Clearly label demo or mock identities. Do not imply
  that role indicators provide real authentication.
- **Canvas:** Use the `canvas` background with approximately `32px` padding.
- **Content width:** Limit the form workspace to approximately `1120px`.

Do not add search, notification bells, settings, or dashboard links
without implemented behavior.

### Mobile and Tablet Layout

Below approximately `1024px`:

- Replace the persistent sidebar with a compact header.
- Add an off-canvas navigation drawer only when multiple implemented
  destinations justify it.
- If a modal drawer is used, manage focus, support Escape, prevent
  interaction with background content, and return focus to its trigger.
- Use page padding between `16px` and `20px`.
- Prevent horizontal page overflow down to `360px`.

Use content-driven breakpoints rather than forcing layouts to fit
arbitrary device categories.

## Spacing and Elevation

### Spacing Scale

Use these preferred spacing values:

`4px`, `8px`, `12px`, `16px`, `24px`, `32px`, `48px`.

Small optical adjustments such as `6px` or `20px` are acceptable
where specified below.

| Relationship | Spacing |
| --- | --- |
| Card padding, desktop | `24px-32px` |
| Card padding, mobile | `16px-20px` |
| Major section gap | `32px` |
| Form-field gap | `20px-24px` |
| Label to control | `8px` |
| Control to helper or error | `6px` |

### Radii and Shadows

- Use approximately `12px` radii for cards and major surfaces.
- Use approximately `6px-8px` radii for controls and buttons.
- Where elevation is useful, use a subtle card shadow:
  `0 2px 8px rgba(15, 23, 42, 0.04)`.
- Prefer borders and whitespace over deeply nested cards.
- Avoid heavy shadows and oversized pill-shaped controls.

## Form Controls and Input Standards

- Place visible, persistent labels above controls.
- Never use placeholders as the only label.
- Clearly state the required-field convention.
- Mark optional fields with `(optional)`.
- Maintain a minimum height of approximately `44px` for standard
  input controls and buttons.
- Give textareas enough initial height for useful descriptions.
- Use appropriate input types and mobile keyboard hints.
- Associate helper and error text with its control.
- Preserve entered values after validation or persistence failures.

### Control States

| State | Treatment |
| --- | --- |
| Default | Clear boundary using `input-border` |
| Hover | Slight border darkening |
| Focus | Visible `2px` focus ring using `focus`, with separation |
| Invalid | `danger` boundary and an inline error message |
| Disabled | Clearly unavailable, with restrained visual emphasis |
| Read-only | Subtle `surface-muted` background, readable value |

Do not treat disabled and read-only controls as equivalent.

Read-only values should remain selectable and keyboard-accessible
where appropriate. Do not disable a control merely to style it as
read-only.

Focus indicators must remain visible on light and dark surfaces.
Invalid controls must retain a visible focus indicator.

### Selects and Pickers

Prefer accessible native selects.

Use headless accessible primitives only when they provide a concrete
usability benefit. Examples are options, not approved dependencies.

Custom controls must support appropriate keyboard interaction,
accessible names, state announcements, and focus management.

### Icons

Use one consistent outline icon family.

Icons must support the interface rather than replace necessary labels.
Decorative icons must use `aria-hidden="true"`.
Icon-only controls require accessible names.

## Actions, Feedback, and States

### Button Hierarchy

1. **Primary:** Solid `primary` background with white text.
2. **Secondary:** Border or subtle fill with `text` color.
3. **Destructive:** Clearly labeled `danger` treatment when an
   implemented operation warrants it.

Use at most one visually dominant primary action per active context.
A read-only view may have no primary action.

Use sufficient padding and minimum height rather than fixed dimensions
that clip wrapped or enlarged labels.

### Loading

- Show a descriptive loading label, with a restrained spinner if useful.
- Prevent repeated activation while an operation is pending.
- Expose the loading state accessibly.
- Do not rely on animation alone to communicate progress.

### Validation

- Show actionable error text directly below the relevant control.
- Mark invalid controls with `aria-invalid`.
- Associate error messages using `aria-describedby`.
- After failed submission validation, focus the first invalid control.
- Do not rely on color, an icon, or a toast alone.

### Operational Failures

- Show a persistent error banner above or near the form actions.
- Explain the failure and available next action without exposing
  internal or sensitive details.
- Preserve the user's entered values.
- Allow retry without requiring the form to be completed again.

### Success

- Show success only after the operation is confirmed.
- Use clear text and the `success` token.
- Announce the outcome through an appropriate accessible status region.
- Keep important confirmation visible long enough to understand it.
- Do not use a transient toast as the sole confirmation.

## Module 1 Application

These details apply the visual system to the approved order form;
they do not expand its scope.

- Use "Create service order" as the page title.
- Group fields into customer details, service details, and assignment
  and notes.
- Prefer one cohesive form surface with clear section dividers.
- Use two columns for suitable short fields when space allows.
- Keep addresses, descriptions, and notes full width.
- Collapse to one column on narrow screens.
- Show the order number as read-only. Before saving, explain that it
  will be generated when the order is created.
- Do not show a fabricated or apparently reserved order number.
- Use "Create order" as the primary action and "Creating order..."
  while submission is pending.
- Include the saved order number in confirmed success feedback.
- Do not add a reset or cancel action unless its behavior is justified.
- Keep detailed post-submission summaries and WhatsApp integration
  optional, as specified in `AGENTS.md`.

Required fields, assignment rules, currency, and order-number formatting
are business decisions governed by the assignment and `AGENTS.md`,
not inferred from visual examples.

## Motion and Accessibility

- Keep transitions subtle, generally `120ms-180ms` with ease-out timing.
- Use animation for meaningful state changes, not decoration.
- Avoid animated backgrounds and large entrance effects.
- Respect `prefers-reduced-motion: reduce`.
- Support keyboard-only operation with unobstructed visible focus.
- Apply keyboard conventions appropriate to each control; do not
  override native behavior unnecessarily.
- Use semantic landmarks such as `header`, `main`, `nav`, and `form`.
- Maintain logical heading order and a natural reading/tab sequence.
- Ensure loading, validation, failure, and success states are usable
  with screen readers.

## Implementation With Tailwind

Keep shared colors, typography, spacing, and radii in semantic tokens.
Map them into the installed Tailwind version using its supported
configuration approach.

The token tables in this document are authoritative. Do not select
a Tailwind version, configuration format, or dependency solely to
match an example.

Avoid scattering unrelated literal values across components.
Build shared components only where reuse or consistency justifies them.
Do not create a large component-library abstraction in advance.

## Design Verification

Before accepting interface changes, check:

- Consistent typography, spacing, and control alignment.
- Clear field labels and primary action.
- Layouts at approximately `360px`, `768px`, `1280px`, and `1440px`.
- No clipped content or horizontal page scrolling.
- Usability with browser zoom and text resizing.
- Keyboard navigation and visible focus.
- Contrast across default and interactive states.
- Validation, loading, persistence failure, retry, and success feedback.
- Screen-reader announcements for important state changes.
- Reduced-motion behavior.
- No nonfunctional decorative controls or out-of-scope features.

Report any checks that could not be performed.
