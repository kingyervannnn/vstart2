# V Start 2 Implementation Sequence

This sequence is intentionally database-first. Visual work does not advance by faking
durability in browser storage.

## Phase 0 — Accept the specification

Deliverables:

- Agree on the product, data/service, settings, and sequence documents.
- Record provisional decisions that may change: Compact Mode breakpoints and parallel ports.
- Initialize a new Git repository in `/Users/vbitzx/SS/vstart2` only when implementation
  begins.

Gate:

- No unresolved decision changes the database schema or primary layout model.

## Phase 1 — Scaffold the independent project

Build:

- Vite/React application shell.
- ESLint, formatting, unit test runner, and browser test runner.
- Dockerfiles and Compose project using `vstart2` names and non-conflicting ports.
- Health-check page and scripts for stack up/down/status.
- Initial SQL migration runner.
- CI-like local command that runs lint, tests, and production build.

Do not copy V Start 1's `App.jsx` or start from its settings tree.

Gate:

- V Start 1 and an empty V Start 2 shell run concurrently.
- V Start 2 has its own network and empty PostgreSQL volume.

## Phase 2 — Establish the database contract

Build:

- Tables/migrations for settings, app state, assets, workspaces, and shortcut items.
- Continuous placement records and GiST exclusion constraints for non-overlapping
  shortcut/folder rectangles.
- Validated `/api/bootstrap` endpoint.
- Resource-scoped versions and idempotent mutation IDs.
- Transactional CRUD/place/create-folder/move APIs for continuous Wide and Compact
  placement canvases.
- Database-unavailable frontend shell and retry behavior.
- Server-side settings default document and migration version.
- Repository guard/test that rejects browser persistence API use in application code.

Test first-class failure cases: conflict, timeout, database restart, duplicate retry, and
failed placement rollback.

Gate:

- A headless API test can create a workspace, add/place/create-folder/move/delete items, update
  settings, restart services, and observe the same canonical state.
- The frontend cannot edit sample/local fallback data when the database is down.

## Phase 3 — Build the two-column shell

Build:

- Single normal two-column layout.
- Mirror through one flex/grid direction change.
- Widget-rail and dial-rail slots.
- Compact Mode controller with hysteresis.
- Compact two-column sizing, widget retention, workspace-button hiding, and inner outline.
- Safe-area and on-screen-keyboard viewport handling.

Use placeholder content only inside layout slots; do not introduce alternative page modes.

Gate:

- Responsive tests cover wide, mirrored, breakpoint entry/exit, narrow portrait, and
  narrow landscape.
- DOM contains one instance of each structural rail/content slot.
- A baseline visual comparison matches the supplied V Start 1 screenshot's two-column
  proportions, transparent widget rail, full dial canvas, and rounded viewport treatment.

## Phase 4 — Workspaces, URLs, and scrolling header

Build:

- Workspace list CRUD/reorder using the API.
- `/w/:slug` routing and `/` resolution.
- Active workspace database state.
- Browser back/forward handling.
- Header banner with alternating direction and reduced-motion fallback.
- Workspace button strip above a temporary dock anchor.
- Exact V Start 1 workspace glyphs and smooth active/reorder/hover transitions.
- Header click and keyboard workspace switching.

Gate:

- Direct URL/reload/history tests are deterministic.
- Renaming does not change slug; explicit slug edits validate uniqueness.
- Switching workspaces reverses the header exactly once.

## Phase 5 — Speed dial core

Build:

- Continuous free-placement root canvas with database-backed logical x/y coordinates.
- Independent automatic `wide` and `compact` placement canvases with versioned logical
  reference sizes.
- Uniform shortcut-layer fitting/scaling so resize preserves geometry and non-overlap.
- PostgreSQL-backed collision rejection for shortcut/folder rectangles.
- Empty-space preservation with no render-time auto-pack, snapping grid, or gravity.
- Shortcut/folder rendering and labels.
- Add/edit/duplicate/delete shortcut flows with separate destination URL and optional
  Shortcut image URL fields.
- Icon precedence and fallback: uploaded icon, image URL override, automatic favicon,
  generated fallback.
- Custom icon asset upload and serving.
- Keyboard-accessible placement controls plus pointer/touch free placement.
- Optimistic preview with server-confirmed commit and rollback.
- Wheel/trackpad workspace switching over the speed-dial rail.

Gate:

- Resize stress test proves no overlap, no gravity, exact canvas restoration, and no
  layout mutation requests.
- Every shortcut mutation survives refresh.
- Image URL overrides survive refresh; failed overrides visibly fall back to automatic
  favicon retrieval without discarding the shortcut.
- Shortcut-name visibility defaults to Always, persists in PostgreSQL, and restores
  correctly in both Always and Hover-only states after refresh.
- Scroll switching produces one workspace change per deliberate gesture.

## Phase 6 — Folder system

Build:

- Portal-based anchored folder popover.
- Compact centered folder sheet.
- Continuous folder-child CRUD and free placement in both responsive canvases.
- Shortcut-on-shortcut folder creation as the standard occupied-target drop behavior.
- Move into folder, move out, and merge-hover behavior.
- Delete-folder choice: delete children or return them to root.
- Focus restoration and escape/outside-click behavior.

Gate:

- Folder tests pass in normal, mirrored, resized, and Compact Mode.
- Opening/closing a folder does not change root-canvas measurements or route.
- Folder operations survive refresh.

## Phase 7 — Search dock and basic search

Selective V Start 1 import begins here.

Build:

- Extract/adapt the search input and core controls without importing the full V1
  `SearchBox.jsx` state machine.
- Standard engine submission.
- Suggestions.
- Workspace buttons directly above the dock.
- Exact V Start 1 search glyphs and workspace-switcher motion.
- Rail-relative free dragging, edit-mode resizing, clamping, lock, and reset.
- Independent database-backed Wide and Compact x/y/width geometry.
- Higher-layer rendering that explicitly allows the dock to overlap shortcuts.
- Open-in-new-tab and autofocus behavior.
- Keyboard shortcut capture/dispatch.
- Clickable exact V Start 1 AI glyph with an inert local placeholder only until the
  separately gated Agent Mode phase, and no integration-status copy.

Gate:

- Dock placement and width survive refresh from PostgreSQL and remain visible after
  resize/mirror.
- Normal search, engine selection, suggestions, autofocus, and shortcuts pass.
- Network tests prove the AI control makes no request before Agent Mode is installed.
- Search glyphs, resizable edit handles, and workspace-switcher transitions visually match
  their V Start 1 sources.

## Phase 8 — Inline results as a full rail view

Build:

- Explicit dial-rail view state machine.
- SearXNG result client.
- Full-height/full-width inline result view separate from the search input component.
- Transient hiding of the shortcut layer while results are active.
- Web result list, loading, empty, error, and retry states.
- Search dock stays accessible for query refinement.
- Back-to-Speed-Dial behavior and focus restoration.
- One owned internal scroll region with workspace switching suppressed while results own
  scroll.
- No iframe, embedded page, or internal article reader.

Gate:

- Inline results use only the available dial rail at every responsive size while widgets
  remain visible.
- Opening/closing does not shift the page or lose the search dock.
- Mail-style rail takeover comparison is visually approved.

## Phase 9 — Image search and STT

Build:

- Adapt `image-search-api` and image-result grid.
- Image upload/paste lifecycle with ephemeral query files.
- Adapt Faster-Whisper `stt-api` and recorder/transcript flow.
- Service health reporting and user-facing failure states.

Gate:

- Image and voice searches work with V Start 1 still running.
- Temporary audio/query images are cleaned up.
- No audio, transcript, or query image is stored in browser persistence.

## Phase 10 — Widget rail and service imports

Import in small vertical slices:

1. Clock.
2. Weather.
3. Notes widget plus full rail/overlay behavior and `notes-api`.
4. Email widget plus full rail behavior and `gmail-api`.
5. Music controller using its existing backend contract.

For every import:

- Copy the source at a recorded V Start 1 commit.
- Remove global DOM events and V Start 1 settings dependencies.
- Use explicit props/domain state.
- Remove card background/blur/outline from all but music.
- Add unit and browser coverage before importing the next widget.

Gate:

- All widgets render transparently in normal mode.
- Widget rail and all enabled widgets remain visible and usable in Compact Mode.
- Music blur is independent and database-backed.

## Phase 11 — Appearance, backgrounds, and effects

Build:

- Global theme tokens.
- Optional workspace font/color overrides.
- Database asset upload/streaming for backgrounds.
- Optional workspace-specific backgrounds.
- Decorative Edge Effect and edge glow.
- Animated overlay and inner outline.
- Reduced-motion behavior.

Gate:

- Toggling effects does not change layout measurements.
- Uploaded backgrounds/icons survive complete stack restart.
- Workspace override toggles preserve inactive values.

## Phase 12 — Reorganized settings UI

Build the pages defined in `SETTINGS.md` against the already-working feature contracts.
Do not create settings ahead of their implemented behavior.

Requirements:

- Save/error indicator per mutation.
- Dependent workspace controls appear only when enabled.
- Search contains no AI backend/provider controls.
- Data & System shows service/database health.
- No legacy layout terminology.

Gate:

- Each setting has an automated persistence test and an observable effect.
- A full settings audit finds no duplicate/conflicting controls.

## Phase 13 — V Start 1 importer

Build only after the V Start 2 schema is stable:

- Dry-run parser for V Start 1 export/read-only snapshot.
- Workspace/shortcut/folder mapping.
- Coordinate-to-Wide/Compact continuous canvas conversion that preserves relative
  geometry and rejects shortcut overlap.
- Selected appearance/background/widget setting mapping.
- Database-asset import.
- Unsupported setting report.
- Transactional apply and rollback.

Gate:

- Dry run never mutates either database.
- Apply never mutates V Start 1.
- Imported V Start 2 state passes the same refresh/resize/folder tests as native data.

## Phase 14 — Hardening and cutover candidate

Run:

- Production build and bundle audit.
- Accessibility pass.
- Keyboard-only pass.
- Wide/narrow/mirror/Compact visual matrix.
- PostgreSQL backup/restore drill.
- Service restart/recovery drill.
- Long trackpad/drag/folder/inline interaction soak.
- Verification that no provider-specific AI backend, direct provider request, or browser
  persistence slipped into the bundle.

Cutover gate:

- All twelve release acceptance criteria in `PRODUCT_SPEC.md` pass.
- V Start 1 remains available as rollback until V Start 2 has been used successfully for
  an agreed trial period.

## Phase 15 — Hermes-backed Agent Mode

Agent Mode is a post-core extension. Implement it only through the native loopback bridge
and sequence defined in `AGENT_MODE.md`:

1. Prove the Hermes `tui_gateway` protocol with a disposable harness.
2. Build and harden the native host bridge.
3. Add V Start database preferences and Hermes session links.
4. Build the full-rail Agent Mode shell and routes.
5. Add conversation streaming, sessions, models, reasoning, and interruption.
6. Add tool activity and explicit approvals.
7. Complete the Agent Mode security and recovery gate.

Current status (2026-07-14): steps 1–6 are implemented. The active Hermes profile uses
`manual` approvals, the per-user launchd bridge is installed and loaded, and live
Copilot `gpt-4o-mini` gateway, HTTP-bridge, approval, restart/resume, and browser reload
checks pass. The bridge and UI still fail closed if approvals are changed to `off`.
Step 7 remains open only for the extended hardening matrix; V Start will not alter the
global Hermes policy automatically.

Agent Mode must not introduce provider API keys, direct provider requests, browser
persistence, an AI container, or a generic executable/CLI registry into V Start.

## Recommended first implementation milestone

The first useful milestone ends at Phase 6:

- Independent Docker/database foundation.
- Two-column and Compact Mode shell.
- Workspaces/URLs/header.
- Responsive continuous free-placement speed dial.
- Fully working folders.

This milestone proves the hardest architectural choices before search, widgets, and visual
settings add surface area.
