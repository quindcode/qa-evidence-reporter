# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two distinct roles, same tool, different jobs:

- **QA operator (Quind's internal QA team):** runs the interactive session in
  the local runner UI. Works through a Gherkin feature's scenarios/steps one
  at a time, attaching real evidence (screenshots, screen recordings, PDFs)
  and marking Pass/Fail/Skip, often across multiple sittings on the same
  project. Needs speed and low friction per step (keyboard shortcuts,
  paste/drag evidence, autosave/resume) since this is repetitive, sustained
  work, not a one-off form fill.
- **Client (external stakeholder):** never touches the runner. Receives the
  generated HTML report (or its exported `.zip`) as the deliverable that
  demonstrates QA was actually performed, with evidence attached per step.
  Reads it standalone (`file://`, no server, no setup) to judge the quality
  of a delivery. For this audience, the report itself is the product
  experience — its polish and portability carry as much weight as the
  runner's usability does for the operator.

## Product Purpose

Standardize the **execution, evidence capture, and reporting** of manual QA
test cases that are already written as Gherkin `.feature` files. It replaces
ad hoc note-taking/screenshot-hoarding during manual test passes with a
structured session (autosaved, resumable) and turns that session into a
self-contained, shareable proof-of-testing artifact. Success looks like: a
QA operator can run a full test plan across multiple sessions without losing
progress, and hand the client a single `.zip`/HTML report that stands on its
own as evidence the plan was executed.

## Positioning

The mechanism a competitor tool would have to copy: a live session model
(autosave on every action, exact resume, one server per project) feeding
directly into a fully self-contained HTML report — dashboard + per-feature
drill-down, inline CSS/JS, evidence images copied alongside, opens via
`file://` with no server and re-exports as `.zip`. On top of that, every new
project is Quind-branded from the first `init` (logo + 4 standard colors)
with zero manual configuration, so the client-facing deliverable is
consistently on-brand without the operator having to think about it.

## Operating Context

- Runs entirely locally: a QA project is a folder (`features/`, `evidence/`,
  `reports/`, `qa-config.json`) separate from the tool's own repo.
- One `run` server per project at a time — the session file
  (`.qa-evidence-reporter/session.json`) has no concurrent-write protection;
  two people on the same running server share one live session in real time
  (last action wins, no per-user lanes).
- Selection of what to run is by whole `.feature` file, not by scenario or
  tag; tags are informative/display-only today.
- The report deliverable is commonly shared as an exported `.zip`, or via a
  still-running `reports-static` link, with client/leadership. Feedback on
  the tool itself is tracked as Issues in the repo, not in-product.
- Does not replace a formal test plan (objectives, risk, schedule,
  entry/exit criteria) — those live elsewhere; this tool only standardizes
  execution + evidence + report of cases already defined as Gherkin.

## Capabilities and Constraints

- Gherkin is the only accepted source format for test cases (a defined
  subset of keywords, English or per-file `# language: es` Spanish); no
  free text, Markdown, or custom list formats.
- Evidence formats/sizes are configurable per project
  (`evidence.allowedFormats`, `evidence.maxFileSizeMB`); out-of-config
  uploads are rejected, not silently coerced.
- Traceability to external trackers is opt-in and file-only, Jira Cloud
  only for now: with `jira.baseUrl`/`jira.email` configured (+
  `JIRA_API_TOKEN` in the environment, never in `qa-config.json`), the
  runner can attach the generated report `.zip` directly to a Jira Cloud
  issue (story, epic, bug — any issue key) with one click. There is no
  comment/summary sync, no status sync, and no read-back from Jira; defect
  descriptions still live only in the session/report otherwise. Jira
  Server/Data Center and Azure DevOps are not implemented.
- Regenerating a report always overwrites `reports/` in place; there is no
  built-in report history/versioning across runs — archiving prior `.zip`
  exports before the next `report` run is on the user.
- Semantic result colors (green=Pass, red=Fail, gray=Skip, amber=Pending)
  are fixed and are never affected by branding config — status must stay
  instantly legible regardless of project branding.

## Brand Commitments

Quind identity is the standard default for every new QA project, applied
automatically by `init` with no manual setup:

- Logo: `branding/logo.png` (Quind logo), copied into every new project.
- Palette: `primaryColor #1e3543`, `accentColor #00c4e9`,
  `highlightColor #ffb91c`, `ctaColor #ff5530`.
- This branding is what the client sees in the delivered report — it is
  Quind's visual identity carried into every client-facing report, not
  optional decoration. A project can still opt out by nulling the
  `branding` block in `qa-config.json`.

## Evidence on Hand

`sample-project/` (in this repo) is a complete reference project: 3 real
`.feature` files mixing Spanish and English, tags, `Background`, and
`Scenario Outline`, plus `simulate-session.mjs`, a script that exercises the
real server end-to-end (selection, real evidence, mixed results, report,
zip) without a browser. Useful as the ground truth for what a populated
runner/report actually looks like, without fabricating new example content.

## Product Principles

1. The report is the client-facing deliverable, not an internal artifact —
   its self-contained portability (offline, zippable, no setup to view) and
   visual polish matter as much as the runner's usability does for the
   operator.
2. The runner optimizes for a QA operator moving through many steps in one
   sitting: minimize per-step friction (shortcuts, paste/drag evidence,
   autosave) over configurability or extra confirmation steps.
3. Every new project looks professionally on-brand from the very first
   `run`, by default, without configuration — Quind branding is the
   baseline, not an afterthought layered on later.
4. Gherkin is the single source of truth for scope; the tool stays scoped to
   execution + evidence + reporting and does not creep into test planning or
   case management.
5. In-progress work is never silently discarded — sessions autosave, and any
   action that would drop unexported progress requires explicit
   confirmation.

## Accessibility & Inclusion

No product-specific accessibility standard has been established yet.
