# V Start 2 Product Specification

Status: draft for implementation
Working name: V Start 2
Target URL: `http://localhost:3000`

## 1. Product boundaries

V Start 2 is a new frontend and state model in a separate folder. It is not a second
configuration inside V Start 1. The rebuild reuses proven components and local services,
but each imported component is adapted to V Start 2's contracts and copied into the new
project. V Start 2 must not import source files across `../VSTART` at runtime; that would
couple the two projects and break an isolated Docker build context.

### Included

- Two-column normal layout with a mirror option.
- One automatic compact layout.
- Workspace-specific URLs.
- Reversing scrolling header.
- Workspace buttons immediately above the search dock.
- Continuous free-placement speed-dial canvas, folders, and workspace scroll switching.
- Draggable search dock with normal, inline, voice, image, and optional Agent Mode
  controls.
- Full-column inline search results.
- V Start 1 left-rail widgets, with a simplified surface treatment.
- Global and optional workspace-specific fonts, colors, and backgrounds.
- Database-backed settings, assets, workspaces, shortcuts, and durable UI preferences.
- Local Docker services needed by mail, notes, image search, inline search, and speech-to-text.

### Explicitly excluded from the first release

- Multiple speed-dial modes.
- Stage 1, Stage 2, or advanced subvariants.
- AI provider configuration or an `ai-api` service.
- External AI API keys or per-provider API integration.
- Browser-persistent state.
- Auto-packed or gravity-based shortcut layouts.
- V Start 1's full settings surface and compatibility toggles.
- Firecrawl and article summarization workflows.

## 2. Page composition

### 2.1 Wide layout

The viewport contains two structural columns:

1. **Widget rail** — a bounded left rail containing clock, weather, notes, email, and music.
2. **Dial rail** — the remaining viewport containing the header, speed dial or active
   full-rail content, workspace buttons, and search dock.

The dial rail is the primary page surface and receives most of the width. There is no
third or center column. The normal layout must be expressed by one layout component, not
by conditional copies of the same content.

The mirror setting reverses the order of the two rails. It does not create a different
layout implementation and does not change persisted shortcut order.

### 2.2 Compact mode

The only responsive state is called **Compact Mode**. The implementation and settings
must not use Stage 1 or Stage 2 terminology.

Breakpoint behavior:

- Enter Compact Mode below 1100 CSS pixels.
- Exit Compact Mode at 1160 CSS pixels or wider.
- Use hysteresis to prevent rapid oscillation around the breakpoint.
- Measure the app container/visual viewport rather than relying on a collection of
  unrelated media-query branches.

In Compact Mode:

- The widget column is removed and the dial rail occupies the full page width.
- Clock and weather are automatically hidden.
- Notes, mail, and music remain reachable through a small widget-access dock rather than
  a retained left column.
- Workspace buttons above the search dock are automatically hidden.
- The scrolling workspace header remains visible and interactive.
- The speed dial uses its independent compact placement canvas without overlap.
- The search dock stays within the safe viewport and is clamped after resize.
- The optional inner outline remains available.

### 2.3 Exact visual reference

The Wide layout must visually match the original V Start 1 wide-layout reference used
during the initial design pass. That local design input is intentionally not linked from
the portable repository documentation.

The reference is a design target, not loose inspiration. V Start 2 must preserve:

- The background filling the rounded application viewport.
- The transparent, visually unboxed widget rail on the left.
- The dial rail consuming the rest of the page without a visible card or divider.
- The scrolling workspace banner at the top.
- Free-floating shortcuts across the dial side rather than inside a visible grid/card.
- The glass search dock near the lower portion of the dial rail.
- The compact animated workspace switcher immediately above the search dock.
- The existing edit/settings affordance placement and overall spacing rhythm.

The implementation should copy/adapt the exact relevant V Start 1 components, glyphs,
motion values, and appearance rules before attempting stylistic cleanup. Any deliberate
visual deviation requires an explicit later decision.

## 3. Workspace model

Each workspace has:

- Stable UUID.
- Display name.
- Unique URL slug.
- Stable sort order.
- Optional icon.
- Optional per-workspace text color and font, applied only when workspace theming is enabled.
- Optional per-workspace background, applied only when workspace backgrounds are enabled.

Routes use `/w/:slug`. Direct navigation, reload, and browser history must resolve the
same workspace from PostgreSQL. Renaming a workspace does not silently change its slug.
Slug changes are an explicit edit and must reject duplicates.

The last active workspace is stored in PostgreSQL. `/` resolves to that workspace (or the
first workspace when no last-active value exists) and replaces the URL with `/w/:slug`.

### Workspace switching

Workspaces can be changed by:

- The button strip above the search dock in normal mode.
- Scrolling within the speed-dial rail while the speed dial is the active rail view.
- Clicking the scrolling header.
- Workspace keyboard shortcuts.
- Direct URL navigation.

Wheel switching uses an accumulator, threshold, short cooldown, and optional resistance
setting. A single trackpad gesture must produce at most one switch until the gesture
settles. Folder contents, inline results, mail, notes, settings, and other scrollable
overlays own their scroll and must not accidentally switch workspaces.

The workspace switcher reuses V Start 1's current compact glyphs and smooth selection,
reorder, hover, and active-workspace animations. Switching by click, wheel, header, URL,
or keyboard drives the same animation contract rather than separate transitions.

## 4. Scrolling header

The workspace header is fixed to the top of the dial rail and spans its usable width.
It shows the active workspace name as a continuously scrolling banner.

- Direction reverses on every committed workspace change.
- The transition direction is ephemeral UI state and is not persisted.
- The header immediately adopts the active workspace font/color when workspace theming
  is enabled.
- Clicking the header advances to the next workspace; Shift-click goes to the previous.
- Direct URL navigation also flips the direction once when the active workspace changes.
- Reduced-motion mode replaces continuous motion with a static, centered title and a
  brief directional fade.

## 5. Speed dial

### 5.1 Continuous free placement

The speed dial is a continuous two-dimensional canvas covering the full dial rail. Every
root shortcut, folder, and folder child has an explicit logical x/y placement stored in
PostgreSQL. There are no rows, columns, slots, gravity, or auto-pack behavior. A shortcut
may be pinned anywhere inside the usable dial canvas as long as its collision rectangle
does not overlap another shortcut/folder rectangle.

There are two internal responsive placement canvases:

- `wide` for the normal two-column layout.
- `compact` for automatic Compact Mode.

These are not user-selectable speed-dial modes and do not expose separate mode settings.
They exist so a user can pin items appropriately for each physical size without one
viewport corrupting the other. Each canvas has a versioned logical reference size. The
entire shortcut layer is fitted/scaled as a unit within its rail, preserving geometry and
non-overlap as the physical viewport changes inside that profile.

Foundational invariants:

- A shortcut remains at its chosen logical x/y position until the user moves it.
- Empty canvas space remains empty; there is no gravity or auto-pack pass.
- Resizing within a profile transforms the shortcut layer as a unit and does not rewrite
  logical coordinates.
- Entering Compact Mode selects the compact placement canvas without mutating the wide canvas.
- Returning to wide restores the exact wide placement.
- Two shortcut/folder collision rectangles may never overlap in the same workspace,
  parent folder, profile, and page.
- No placement write occurs merely because the viewport resized.
- New items receive placements for both profiles in the creation transaction. The active
  profile uses the user-selected x/y position; the inactive profile uses a collision-safe
  proportional projection that the user may later customize.

The search dock is not part of shortcut collision detection. It is rendered on a higher
layer and is explicitly allowed to overlap shortcuts.

### 5.2 Drag and pin

- Every root shortcut and folder can be pinned anywhere in the dial canvas that does not
  collide with another shortcut/folder.
- Every folder child can be freely positioned inside the folder canvas.
- Dropping into unoccupied space moves the item to that exact logical position.
- Dropping one shortcut onto another shortcut always creates a folder containing both.
- Dropping a shortcut onto an existing folder moves it into that folder.
- Dragging a folder child out moves it back to the root canvas.
- A placement/folder-create/move is one database transaction and returns canonical
  placements and versions for every affected item.
- Any accidental partial collision that is not an intentional shortcut/folder target is
  shown as invalid and restores the prior position rather than nudging other shortcuts.
- The client may show an optimistic preview, but it rolls back on failure.
- The UI indicates saving state and does not claim success before the server confirms.

### 5.3 Folders

Folders open as an anchored popover rendered in a portal so they are not clipped by the
canvas or rail. The popover contains its own free-placement child canvas and scroll region.

- Desktop: anchor near the folder tile and clamp to the dial rail.
- Compact Mode: center as a modal sheet with safe-area padding.
- Folder state never changes root-canvas geometry.
- Add, rename, pin, move-in, move-out, and delete are supported.
- Deleting a non-empty folder requires choosing whether to delete its children or return
  them to the root.
- Escape, outside click, and an explicit close control dismiss the popover.
- Opening a folder never navigates the workspace URL.

### 5.4 Shortcut behavior

- Add, edit, duplicate, delete, and custom icon operations are included.
- The create/edit dialog has separate fields for destination URL and optional
  **Shortcut image URL**.
- When Shortcut image URL is present, it overrides automatic favicon retrieval from the
  destination URL. When it is empty, the icon is resolved normally from the destination.
- Icon precedence is: uploaded custom icon, Shortcut image URL, automatic destination
  favicon, generated fallback.
- If the optional image URL cannot be retrieved or normalized, the dialog shows an inline
  warning and falls back to automatic destination favicon retrieval rather than losing the
  shortcut.
- Link opening follows the global "open in new tab" setting.
- Shortcut-name visibility has two database-backed states: `always` and `hover`. Hover
  mode hides the name at rest and reveals it when the shortcut receives pointer hover or
  keyboard focus.
- Uploaded custom icons are stored as database assets.
- Image-URL and favicon resolution may use an in-memory cache, but the source choice and
  resolved durable icon reference are stored in PostgreSQL when retained.

## 6. Dial rail view state

The dial rail has one explicit view state machine:

```text
speedDial | inlineResults | mail | notes
```

Only one primary rail view is active at a time. Settings and folder popovers are overlays,
not additional rail modes. Returning from another rail view restores the speed dial and
search-dock position without reconstructing layout state.

This state machine replaces scattered booleans such as "inline active", "center open",
and per-collapse-mode variants.

## 7. Search dock

The V Start 1 search bar is selectively imported and decomposed into a dock, input,
mode controls, suggestions, and result-view controller.

### 7.1 Placement

- The dock lives within the dial rail.
- It is draggable and resizable when edit placement is enabled, matching the current
  V Start 1 interaction.
- Position and size are stored for both Wide and Compact canvases as normalized
  rail-relative geometry, not raw viewport pixels.
- On resize or mirror change, its rendered position is clamped without overwriting the
  stored preferred position.
- A Reset Position action restores the default bottom-center placement.
- Workspace buttons sit immediately above and move with the dock in Wide mode.
- The dock renders above the shortcut layer and may overlap any shortcut.
- Position and size writes are awaited and survive refresh through PostgreSQL.

### 7.2 Controls

The dock contains:

- Search/input field.
- Current/default search-engine affordance.
- Inline-mode toggle.
- Voice/STT toggle.
- Image-search affordance.
- Agent Mode toggle using the exact V Start 1 AI glyph.

During the core release sequence the control is a local inert placeholder and is not
eligible as the startup/default search mode. Phase 15 activates it only through the
loopback Hermes bridge specified in `AGENT_MODE.md`. It never exposes provider keys or
makes a direct provider API request.

### 7.3 Core search behavior

- Configurable default engine: Google, DuckDuckGo, Bing, or SearXNG.
- Search suggestions remain, with a deliberately small settings surface.
- Autofocus on load is supported.
- Standard searches respect the open-in-new-tab setting.
- Search history is included only if stored in PostgreSQL; it may be disabled entirely.
- No search state is written to browser storage.

### 7.4 Inline results takeover

Inline results must not be a large dropdown attached to the input. Submitting an inline
query transiently hides the shortcut layer and changes the dial rail view from `speedDial`
to `inlineResults`, modeled after the mail overlay's full-panel use of available space.

The result view:

- Occupies the dial rail from below the scrolling header to the safe area above/around
  the search dock.
- Uses the full dial-rail width and height.
- Keeps the widget rail visible in Wide Mode and the widget-access dock available in
  Compact Mode.
- Occupies the dial rail without covering the Wide widget rail.
- Keeps the search dock accessible for query refinement.
- Provides a clear Back to Speed Dial control.
- Has one internal scroll container; page scroll remains locked/stable.
- Separates web and image result rendering.
- Displays result lists only. It does not embed pages, use an iframe, or open an internal
  article reader in the first release.
- Keeps query/results only for the transient in-memory result session and does not persist
  the live result session across reload.
- Uses SearXNG for web results and `image-search-api` for image results.
- Removes AI summarization, Firecrawl, and provider-specific API configuration.

## 8. Voice and image search

Voice uses the carried-forward Faster-Whisper `stt-api` service. The control records audio,
sends it to the local STT proxy, places the transcript in the input, and lets the user
submit or edit it. Audio blobs and transcripts are not persisted unless a later explicit
feature requires it.

Image search carries forward upload/paste handling and `image-search-api`. Durable user
image-search settings live in PostgreSQL. Temporary query images remain memory-only or
ephemeral server files with deletion after completion.

## 9. Widget rail

The initial reusable widget set is:

- `ClockWidget`
- `WeatherWidget`
- `NotesWidget`, `NotesCenterList`, and `NotesOverlay`
- `EmailWidget`, `EmailList`, `EmailCompose`, and `EmailOverlay`
- `MusicController`

Import means copy and adapt the selected source into V Start 2 with a documented origin;
it does not mean a permanent cross-project filesystem import.

Surface rules:

- Clock, weather, notes, and email have no card background, blur panel, border, or shadow.
- Separators and typography may still use the workspace accent.
- Music is the only rail widget allowed to have a glass background.
- Music has an independent blur control, including zero blur.
- Widget visibility and minimal widget-specific preferences are database-backed.
- Widget data such as mail and notes comes from its service, never browser persistence.
- The widget rail and enabled widgets remain visible in Compact Mode.

## 10. Appearance model

### 10.1 Workspace theming

Workspace-specific font and text/accent color controls are behind one global toggle.

- Off: all workspaces use global font and color values; workspace overrides remain stored
  but inactive.
- On: each workspace may set font and color independently, with global values as fallback.

### 10.2 Backgrounds

- A global background is always available.
- Workspace-specific backgrounds are behind one global toggle.
- Uploaded backgrounds and their metadata are stored in PostgreSQL.
- Workspace background changes use a database asset reference.
- Disabling workspace backgrounds preserves overrides but renders the global background.

### 10.3 Edge and overlay effects

V Start 2 has no Edge Mode. The large dial rail is the normal layout.

The optional **Edge Effect** is purely decorative and is grouped with other effects:

- Edge effect enabled.
- Edge glow enabled.
- Edge glow intensity, independent from the shared search-bar/music-player glow intensity.
- One glow color with optional workspace and adaptive-background overrides.
- Edge softness/width.
- Animated overlay enabled/speed/intensity.
- Inner outline enabled.

Effects may add pseudo-elements, masks, gradients, or glow. They may not change rail
width, shortcut coordinates, responsive breakpoints, workspace switching, search-dock
placement, or persistence format.

## 11. Accessibility and interaction requirements

- All drag operations have keyboard placement alternatives.
- Workspace, shortcut, folder, mode, and close controls have accessible names.
- Focus is trapped only in true modal surfaces.
- Inline results and folder popovers restore focus to their invoking control.
- Reduced motion is respected by header, overlays, and drag animation.
- Color controls warn when contrast falls below a readable threshold.
- Compact Mode supports safe-area insets and on-screen keyboard resizing.

## 12. Release acceptance criteria

V Start 2 is not ready for default use until all of the following pass:

1. Adding, editing, moving, and deleting shortcuts survive a hard refresh.
2. Every durable setting survives a hard refresh and a second browser session because it
   came from PostgreSQL.
3. DevTools shows no application writes to browser persistence APIs.
4. Shrinking and expanding the viewport never overlaps shortcut rectangles, never applies
   gravity, restores the exact canvas placement, and never writes layout changes merely
   because the viewport changed.
5. Workspace direct URLs, back/forward, reload, and rename behavior are deterministic.
6. Mirror mode flips the rails without changing data or losing dock placement.
7. Compact Mode has no Stage 1/Stage 2 branching, automatically removes the widget
   column, retains compact widget access, and hides workspace buttons.
8. Folder popovers work at wide, narrow, mirrored, and compact sizes.
9. Inline results transiently hide shortcuts, use the full dial rail, retain the active
   profile's widget access, embed no page/iframe, and return cleanly.
10. A stopped database shows a reconnect/error shell and does not silently fall back to
    defaults that can overwrite user data.
11. The Docker stack contains no provider-specific AI backend, the frontend makes no direct
    provider API request, and optional Agent Mode can communicate only with the approved
    loopback Hermes bridge defined in `AGENT_MODE.md`.
12. V Start 1 can continue running with its original database and ports while V Start 2
    is under development.
