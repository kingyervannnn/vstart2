# V Start 2 Settings Organization

## 1. Settings principles

- Organize settings by the user's mental model, not by component internals.
- Do not expose controls for removed modes or implementation details.
- Show workspace-specific controls only after their parent feature is enabled.
- Persist each change through the settings API and show saving/saved/error state.
- Use server defaults and schema migrations; do not read legacy browser keys.
- Prefer a small reliable setting set over importing every V Start 1 toggle.

## 2. Top-level pages

The initial settings navigation contains:

1. General
2. Workspaces
3. Speed Dial
4. Search
5. Agent
6. Appearance
7. Backgrounds
8. Widgets
9. Music
10. Mail
11. Data & System

Settings opens as a large modal/sheet over the page. It does not become another layout
mode. On narrow viewports, navigation becomes a list/detail stack.

## 3. General

### Startup and links

- Autofocus search bar on load.
- Open links in a new tab.
- Restore last active workspace (on by default; `/` still resolves deterministically).

### Layout

- Mirror columns.
- Compact Mode enabled (on by default).
- Compact Mode inner outline.
- The Compact Mode breakpoint is not initially user-configurable; one tested behavior is
  preferable to another source of layout combinations.

### Keyboard shortcuts

Configurable actions:

- Focus search.
- Toggle inline mode.
- Activate voice recording.
- Toggle Agent Mode.
- Next workspace.
- Previous workspace.
- Open settings.
- Escape/back to speed dial.

Shortcut capture rejects duplicates and reserved browser combinations where detectable.

## 4. Workspaces

This page lists ordered workspaces and supports add, rename, reorder, icon, delete, and
explicit URL-slug editing.

### Workspace-specific theming

One global switch: **Use workspace-specific fonts and colors**.

When off:

- Per-workspace controls are collapsed/disabled.
- Stored overrides are preserved.
- Global Appearance values render everywhere.

When on, each workspace exposes:

- Font family.
- Text color.
- Accent color.
- Reset to global.

Background selection is not duplicated here; this page links to the corresponding
workspace section in Backgrounds when workspace-specific backgrounds are enabled.

## 5. Speed Dial

### Items

- **Always show shortcut names** toggle.
  - On (default): shortcut names are always visible.
  - Off: names reveal only on pointer hover or keyboard focus.
- Show folder labels.
- Default link opening follows General; no duplicate per-mode setting.
- Continuous free placement is always on. There is no grid snapping, auto-arrange, or
  gravity toggle.

### Interaction

- Scroll within dial rail to switch workspaces.
- Scroll resistance enabled.
- Resistance intensity (small bounded range).
- Folder-target highlight while a shortcut is dragged over another shortcut or folder.

### Surface

- Transparent surface (default on).
- Inner outline (normal layout surface; Compact Mode outline remains in General because it
  describes the compact shell).
- Shortcut geometry initially matches the V Start 1 reference and is not user-resizable;
  this keeps collision bounds deterministic.

There are no Modern, Classic, Edge, Stage, or layout-override settings.

## 6. Search

### Behavior

- Default engine: Google, DuckDuckGo, Bing, SearXNG.
- Suggestions enabled.
- Suggestion provider: Automatic, DuckDuckGo, Google, Brave, SearXNG.
- Maximum suggestions: small bounded choice.
- Inline search enabled.
- Inline result engine: SearXNG (initially the only supported web provider).
- Inline image results enabled.
- Image search enabled.
- Voice/STT enabled.

No AI provider, model, API key, routing, web-search-provider, or prompt setting is shown in
Search. The exact V Start 1 AI glyph is inert through the core release phases, then opens
the loopback Hermes Agent Mode defined in `AGENT_MODE.md`.

### Search dock placement

- Enter/exit search placement edit mode.
- Drag anywhere within the dial rail.
- Resize width with the same edit-mode handles/behavior as V Start 1.
- Persist independent Wide and Compact x/y/width geometry.
- Reset the active profile position and size.
- The current position is displayed as a preview, not raw coordinate fields.

### Appearance

Carry only:

- Transparent background.
- Blur amount.
- Outline.
- Shadow.
- Corner radius preset.
- Accent source: global accent, workspace accent, or custom.
- Input text color source: automatic, global text, workspace text, or custom.

Do not import V Start 1's full suggestion/AI/inline-theme appearance matrix. Inline results
use the shared app theme plus one readable result density option if testing proves necessary.

## 7. Agent

This page is present only after the Agent Mode extension is installed.

- Enable Agent Mode.
- Loopback bridge status and Start/Stop guidance.
- Loopback bridge URL, restricted to approved loopback hosts.
- Default reasoning effort.
- Show tool activity.
- Show usage metadata.
- Enable workspace-specific agent defaults.
- Per-workspace working directory and model/provider preference when workspace defaults are
  enabled.

Reasoning effort and fast mode are labeled as Hermes-profile defaults because the current
Hermes gateway persists them at profile scope. They are not presented as workspace-specific
until Hermes exposes a truly session-scoped contract.

Provider authentication stays in Hermes. This page contains no key, OAuth, executable,
CLI-registry, arbitrary command, secret, or sudo controls.

## 8. Appearance

### Global typography and color

- Global font.
- Global text color.
- Global accent color.
- Respect system reduced motion.

### Effects

- Edge effect.
- Edge glow.
- Independent edge glow intensity.
- Shared search-bar and music-player glow intensity.
- One glow color with optional workspace and adaptive-background overrides.
- Edge softness/width.
- Animated overlay.
- Animated overlay speed.
- Animated overlay intensity.

The page explicitly describes the Edge Effect as decorative. Enabling it must not reveal
layout controls or change the dial rail's geometry.

## 9. Backgrounds

### Global

- Select built-in background.
- Upload background.
- Background fit/position.
- Global dim/brightness if retained after visual testing.

### Workspace backgrounds

One switch: **Use workspace-specific backgrounds**.

When enabled, show one selector per workspace with:

- Inherit global.
- Choose existing database asset.
- Upload new database asset.
- Fit/position override only if needed.

Disabling the feature preserves assignments but renders the global background.

No uploaded background is stored in IndexedDB or a browser blob database.

## 10. Widgets

### Visibility

- Clock.
- Weather.
- Notes.
- Email.
- Music.

### Minimal per-widget settings

- Clock: preset, time format, optional seconds.
- Weather: location, units, refresh behavior.
- Notes: filter/default view and center/overlay behavior retained only where functional.
- Email: account/filter/default mailbox behavior retained only where functional.
- Music: enabled and glass blur amount. Provider configuration lives on the dedicated
  Music page.

Clock, weather, notes, and email do not expose background/blur/card controls because their
V Start 2 surfaces are always transparent. Music is the sole exception.

All enabled widgets remain visible in Compact Mode. Compact Mode may use tighter widget
geometry, but it does not replace the rail with launchers or remove widget content.

## 11. Music

- Select the active source used by the widget and expanded Music view.
- Add, rename, enable/disable, test, or delete sources.
- Store source name, adapter type, and API URL in PostgreSQL settings.
- Seed YouTube Music Desktop at `http://127.0.0.1:26538`.
- Keep the source selector on the widget so switching players does not require opening
  Settings.

The initial adapter supports live song state, play/pause, previous/next, shuffle, repeat,
volume state, queue selection, queue insertion, immediate playback from search, and provider search. Future adapters use
the same source registry and normalized V Start API rather than adding provider-specific
logic to the widget.

## 12. Mail

- Select the default local inbox and workspace-specific inbox assignments.
- Control background refresh cadence.
- Keep mailbox content in the local mail bridge rather than copying messages into browser
  storage or PostgreSQL.

## 13. Data & System

- Database connection health.
- Service health: storage, Gmail, image search, notes, SearXNG, STT.
- Application/schema version.
- Export database-backed configuration through the server.
- Import configuration through validation and transaction.
- Create/download database backup instructions or invoke a safe server-side backup flow.
- Reset V Start 2 only behind explicit confirmation and a typed project name.
- About/build information.

There is no "clear browser storage" action because V Start 2 owns no browser-persistent
application state.

## 14. Settings removed from V Start 1

The following categories do not migrate:

- Master layout selector and Classic/Modern variants.
- Stage 1/Stage 2 behavior, placement, and visibility toggles.
- Edge Mode or edge-layout coupling.
- Layout coordinate overrides by mode.
- Multiple workspace tab styles/placements.
- AI provider/model/API settings.
- Firecrawl and custom inline providers.
- External voice API provider settings.
- Per-component duplicated blur/link controls that violate the new surface rules.
- Settings used solely to preserve legacy behavior.

## 13. Settings acceptance criteria

- Every visible setting has an observable effect or is clearly labeled future-only.
- Reloading after any setting change returns the same value from PostgreSQL.
- Turning workspace theming/backgrounds off preserves but deactivates overrides.
- No setting can produce a third layout state.
- Edge Effect settings do not alter layout metrics.
- Search settings contain no AI backend configuration.
- No setting is represented by multiple conflicting controls on different pages.
