# V Start 2 Data and Service Architecture

## 1. Database-first rule

PostgreSQL is the only durable store for V Start 2 application state. The frontend loads
one authoritative bootstrap document and sends explicit mutations. It never merges a
browser cache into server state.

Allowed client state:

- React/in-memory UI state.
- Current open popover or rail view.
- Unsaved input text.
- Active drag preview.
- Current inline result session.
- Temporary object URLs for uploads/audio.

Forbidden client persistence:

- `localStorage`
- `sessionStorage`
- IndexedDB
- Cache Storage for application data
- Durable cookies for preferences/state
- Service-worker persistence of application documents

Static HTTP caching of immutable compiled assets is allowed. It is not application state.

## 2. Failure semantics

V Start 2 must fail visibly and safely when PostgreSQL or the storage API is unavailable.

- Startup shows a database unavailable/retry shell.
- It does not initialize editable sample workspaces.
- It does not use stale browser data.
- A mutation remains pending until the server responds.
- Failed optimistic changes roll back.
- The UI reports a concrete error without claiming that a change was saved.
- Automatic retry is bounded and idempotent.

This behavior prevents the V Start 1 failure mode where an item can look added in memory
but disappear after refresh.

## 3. Proposed PostgreSQL schema

Use SQL migrations from the first commit. UUIDs are generated server-side or with UUIDv7
on the client and validated server-side.

### `app_settings`

Singleton settings document with explicit schema version.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text PK | Always `default` initially |
| `schema_version` | integer | Settings migration version |
| `document` | jsonb | Validated settings document |
| `version` | bigint | Optimistic concurrency token |
| `updated_at` | timestamptz | Server timestamp |

The JSON document is acceptable for settings because it is validated as a complete schema,
versioned, and updated by deep server patches. Feature data does not belong in this document.

### `app_state`

Small durable state values such as last active workspace.

| Column | Type | Notes |
| --- | --- | --- |
| `key` | text PK | e.g. `last_active_workspace_id` |
| `value` | jsonb | Validated per key |
| `version` | bigint | Per-key concurrency token |
| `updated_at` | timestamptz | Server timestamp |

### `assets`

Database-backed user media.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | Stable asset ID |
| `kind` | text | `background`, `shortcut_icon`, or future kind |
| `mime_type` | text | Allowlisted MIME type |
| `sha256` | text unique | Deduplication |
| `byte_length` | bigint | Upload validation |
| `width` / `height` | integer nullable | Image metadata |
| `original_name` | text nullable | Display name for the background library/import tooling |
| `content` | bytea | Durable binary content |
| `created_at` | timestamptz | Server timestamp |

The API streams asset content from `/api/assets/:id`. Bootstrap includes background asset
metadata—not binary content—so Settings can render the database-backed library. Custom backgrounds and shortcut
icons do not rely on a host upload folder. Built-in application assets remain compiled.

### `workspaces`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | Stable identity |
| `name` | text | Display name |
| `slug` | text unique | Route slug, explicitly edited |
| `sort_order` | integer | Dense workspace order |
| `icon` | text nullable | Icon name/reference |
| `font_family` | text nullable | Used only when theming is enabled |
| `text_color` | text nullable | Validated CSS color |
| `accent_color` | text nullable | Validated CSS color |
| `background_asset_id` | uuid nullable FK | Used only when workspace backgrounds are enabled |
| `version` | bigint | Workspace concurrency token |
| `created_at` / `updated_at` | timestamptz | Server timestamps |

Deleting a workspace cascades its shortcut items only after confirmation. Referenced assets
are garbage-collected only when no workspace, shortcut, or global setting references them.

### `shortcut_items`

One table represents root items, folders, and folder children.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | Stable item ID |
| `workspace_id` | uuid FK | Owning workspace |
| `parent_folder_id` | uuid nullable self-FK | Null for root items |
| `kind` | text | `shortcut` or `folder` |
| `title` | text | Display title |
| `url` | text nullable | Required for shortcuts, null for folders |
| `icon_asset_id` | uuid nullable FK | Custom icon |
| `icon_override_url` | text nullable | Optional Shortcut image URL source |
| `favicon_url` | text nullable | Server-approved/resolved favicon URL |
| `version` | bigint | Item concurrency token |
| `created_at` / `updated_at` | timestamptz | Server timestamps |

Constraints:

- A folder may not have a parent folder in the first release; nesting depth is one.
- Folder rows have no URL.
- Shortcut rows require a valid URL.
- `icon_override_url`, when present, is validated and takes precedence over automatic
  favicon discovery. A normalized fetched copy may be stored in `assets` and referenced
  by `icon_asset_id`.
- Remote icon retrieval is server-side and accepts only public HTTP(S) image resources.
  It rejects loopback/private-network destinations and enforces redirects, timeouts,
  MIME allowlists, pixel dimensions, and byte-size limits before decoding or storage.
- A parent folder must belong to the same workspace.
- Every item must have placement rows for both responsive profiles.

### `item_placements`

Continuous, profile-specific free placement. This is durable user layout, not a render
cache.

| Column | Type | Notes |
| --- | --- | --- |
| `item_id` | uuid FK | Shortcut/folder item |
| `workspace_id` | uuid FK | Denormalized for scoped constraints/queries |
| `parent_folder_id` | uuid nullable FK | Null means root dial |
| `container_key` | uuid | Workspace ID for root, folder ID for children |
| `profile` | text | `wide` or `compact` |
| `page` | integer | Zero-based logical page |
| `logical_x` | numeric | Continuous x coordinate in the profile canvas |
| `logical_y` | numeric | Continuous y coordinate in the profile canvas |
| `collision_box` | box | Server-computed shortcut/folder bounds |
| `version` | bigint | Placement concurrency token |
| `updated_at` | timestamptz | Server timestamp |

Constraints and behavior:

- Primary key: `(item_id, profile)`.
- Coordinates are validated against the versioned logical reference size of their canvas.
- A PostgreSQL GiST exclusion constraint (with `btree_gist`) prevents overlapping
  `collision_box` values within the same workspace, container, profile, and page.
- `wide` and `compact` positions are independent.
- Root items and folder children both use continuous free placement; neither is list-packed.
- Moving an item between root/folder scopes updates both profile placements atomically.
- Deleting/moving an item does not move, renumber, or compact any other placement.
- Changing viewport size never writes this table.
- The renderer fits the whole shortcut layer to the physical rail as a unit, so logical
  non-overlap remains physical non-overlap during resize.

Search-dock geometry does not participate in this exclusion constraint. Its per-profile
normalized x/y/width geometry lives in the validated settings document. It is rendered
above the shortcut layer and may intentionally overlap shortcuts.

Creating a folder by dropping one shortcut on another is atomic: the server creates the
folder at the target shortcut's root position, reparents both shortcuts, assigns valid
child-canvas positions for Wide and Compact profiles, and removes the two former root
placements. The corresponding folder placement in the inactive profile is chosen without
moving unrelated items.

### Optional `search_history`

Only create this table if search history remains in scope. If implemented, it stores query,
mode, engine, and timestamp in PostgreSQL and has a clear-history mutation. Otherwise,
search history is omitted rather than stored in the browser.

### Service-owned data

Mail OAuth/account data and notes content remain owned by their backend services, but no
corresponding durable state may live in the browser. Provider credentials must be stored
server-side and encrypted at rest or supplied through Docker secrets/environment variables.

Optional Agent Mode follows the same ownership rule. PostgreSQL stores V Start agent
preferences and links to canonical Hermes session ids; Hermes SessionDB remains
authoritative for conversation messages, tool traces, usage, and session history. V Start
does not duplicate those records. The exact schema and ownership rules are defined in
`AGENT_MODE.md`.
Raw secrets must never be embedded in `app_settings` responses.

## 4. API contract

The storage API is the frontend's authoritative application API.

### Bootstrap

`GET /api/bootstrap`

Returns:

- Validated settings and settings version.
- Ordered workspaces with active workspace.
- Ordered shortcut tree for each workspace, or an initially requested workspace plus a
  documented lazy-loading contract.
- Asset metadata/references, not binary data.
- Server/schema version and health information.

The frontend must not render editable defaults before this request succeeds.

### Resource mutations

Representative endpoints:

- `PATCH /api/settings`
- `POST /api/workspaces`
- `PATCH /api/workspaces/:id`
- `DELETE /api/workspaces/:id`
- `POST /api/workspaces/reorder`
- `POST /api/workspaces/:id/items`
- `PATCH /api/items/:id`
- `DELETE /api/items/:id`
- `POST /api/items/:id/place`
- `POST /api/items/:targetId/create-folder`
- `POST /api/items/:id/move`
- `POST /api/assets`
- `GET /api/assets/:id`
- `DELETE /api/assets/:id` (normally garbage-collection controlled)

Each mutation:

1. Validates the payload.
2. Checks a resource-scoped expected version.
3. Executes atomically in a database transaction.
4. Returns the canonical changed resource/order and new version.
5. Uses a request mutation ID so a retry is idempotent.

Avoid a single global revision for unrelated resources. Settings, workspace metadata, and
each workspace/profile placement collection should not conflict merely because another
resource changed.

### Realtime/cross-window behavior

First release may use refetch-on-window-focus and `BroadcastChannel` only as an ephemeral
notification. `BroadcastChannel` never stores data. A later server-sent-events stream may
announce changed resource versions. PostgreSQL remains authoritative.

## 5. Frontend state boundaries

Recommended feature modules:

```text
src/
  app/                 # bootstrap, routing, providers, error shell
  layout/              # two-column shell, mirror, compact mode
  workspaces/          # routes, header, buttons, switching
  speed-dial/          # free-placement canvas, items, drag, folders
  search/              # dock, suggestions, standard search, modes
  inline-results/      # full dial-rail result view
  widgets/             # adapted V Start 1 widgets
  settings/            # schema-driven settings pages
  data/                # typed API client, mutation queue, cache in memory
  theme/               # tokens, backgrounds, edge/overlay effects
```

Use one in-memory server-state layer with explicit query keys. Durable writes flow only
through mutations. Do not mirror server state into another persistence abstraction.

## 6. Docker Compose project

V Start 2 uses a separate Compose project name, network, containers, ports, and volume so
it can run beside V Start 1 without touching it.

### Included services

| V Start 2 service | Source | Purpose |
| --- | --- | --- |
| `app` | new/adapted | Vite build served by nginx |
| `storage-api` | fork/adapt V1 | PostgreSQL-backed app API and assets |
| `db` | PostgreSQL 16 | Sole durable application store |
| `image-search-api` | carry/adapt V1 | Image search and reverse-image helpers |
| `notes-api` | carry/adapt V1 | Notes/vault integration |
| `searxng` | carry V1 config | Inline web results |
| `stt-api` | carry V1 | Local Faster-Whisper speech-to-text |

Mail is intentionally not a Docker service. The widget connects to a loopback-only native
bridge running as the signed-in macOS user so it can reuse the canonical `mailctl` account
registry and Keychain credentials. Its typed API supports search, reading, draft-first
compose/reply with attachments, draft listing, and explicitly confirmed sending.

### Excluded services

- `ai-api`
- `tts-api` in the initial stack
- Firecrawl
- Any provider-specific AI proxy

The music controller continues to use its existing external/local music backend contract;
it is not a new V Start 2 Compose service unless later requested.

### Optional native host service

Hermes-backed Agent Mode uses `agent-bridge`, a separately installed native macOS process.
It is versioned in this repository but is not part of Docker Compose because it must reach
the user's host-local Hermes runtime, authenticated providers, tools, Keychain state, and
applications. It binds only to loopback and exposes the constrained contract in
`AGENT_MODE.md`; it is not a generic command or JSON-RPC proxy.

### Host ports

Current host ports:

| Service | Host port |
| --- | --- |
| app | `3000` |
| storage API | `3110` |
| image search API | `3310` |
| notes API | `3410` |
| Gmail API | `3510` |
| STT API | `8091` |
| Agent bridge (optional native host service) | `3120`, loopback only |

PostgreSQL and SearXNG need only be reachable inside `vstart2-network` unless a debugging
profile explicitly publishes them.

Use distinct names:

- Compose project: `vstart2`
- Network: `vstart2-network`
- Database volume: `vstart2-db-data`
- Container prefix: `vstart2-`

## 7. V Start 1 reuse policy

Reuse is selective and one-way:

1. Record the V Start 1 source commit.
2. Copy the chosen component/service into V Start 2.
3. Remove V Start 1 settings and global-event dependencies.
4. Replace persistence calls with V Start 2 typed API contracts.
5. Add V Start 2 tests before considering the import complete.

Do not use symlinks, `file:../VSTART` dependencies, or cross-folder runtime imports.

Initial candidates:

- UI: Clock, Weather, Notes, Email, Music, workspace buttons, search input controls.
- Services: Gmail, notes, image search, STT, SearXNG settings.
- Utilities: URL normalization, image normalization, safe HTML sanitization, blur/color helpers.

Do not import V Start 1's `App.jsx`, entire `SearchBox.jsx`, entire
`VivaldiSpeedDial.jsx`, settings component, collapse controller, or layout override model.

## 8. Migration and backups

V Start 2 starts with a separate empty database. It never points directly at the V Start 1
database volume.

After the V Start 2 schema is stable, provide an explicit one-time importer that:

- Reads a V Start 1 export or read-only database snapshot.
- Maps workspaces, shortcuts/folders, selected settings, and assets.
- Converts V Start 1 coordinates into collision-free `wide` and `compact` continuous
  placement canvases while preserving relative geometry and intentional empty space.
- Reports skipped/unsupported settings.
- Runs in a transaction and supports dry-run.
- Never mutates the V Start 1 source.

Database backups use PostgreSQL-native dumps. Settings export may exist as a convenience,
but importing it must go through server validation and database transactions.

## 9. Data-specific acceptance tests

- Refresh after every mutation type.
- Stop/restart the app container; data remains.
- Stop/restart PostgreSQL; data remains and frontend recovers.
- Stop PostgreSQL during a placement/folder creation; client rolls back and placements
  remain canonical.
- Send concurrent settings and shortcut mutations; unrelated resources do not conflict.
- Retry the same mutation ID; no duplicate shortcut/folder is created.
- Search repository and built bundle for browser persistence API usage.
- Upload a background/icon, restart all services, and verify it streams from the asset API.
- Run V Start 1 and V Start 2 concurrently and verify their containers/volumes remain isolated.
