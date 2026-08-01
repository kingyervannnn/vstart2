# Notes Widget Vault Backend Investigation

Date: 2026-07-20  
Status: investigated live stack; path misconfigured; workspace-folder + settings-path design not implemented

## Summary

The Notes widget is connected to the Docker `notes-api` service. Saves work, but they are **not** landing in the real Obsidian vault under `~/SYNC/Vaults`. They land in a phantom OrbStack bind mount created from a **wrong** `VSTART2_NOTES_ROOT` path. Workspace assignment is stored in PostgreSQL settings metadata only; the UI does not create or use workspace-named vault subfolders. There is **no** in-app Settings control for the vault root.

### Delete action (added 2026-07-20)

Notes list rows now reveal Edit + Delete on hover/focus. Delete uses a two-click confirm (same pattern as Mail trash), then:

1. `DELETE /notes/api/v1/vault/default/notes/:id[?folder=]` — removes the `.md` from the mounted vault
2. Settings patch `notes.metadata[id] = null` — `deepMerge` deletes that metadata key
3. Row disappears from the local list

Also available from the note editor footer for existing notes.

## Intended design (user)

1. Notes save into the Obsidian vault under SYNC.
2. Each V Start workspace maps to a vault subfolder of the same name.
3. Missing workspace folders are created on demand.
4. Overall vault root is configurable in Settings.

## Actual architecture

```text
Notes UI (ServiceRailView NotesServiceView)
  -> nginx /notes/  (app container)
  -> notes-api:3410 (Docker service)
  -> filesystem ROOT = NOTES_ROOT env (/vault in container)
  -> host bind: ${VSTART2_NOTES_ROOT:-./data/notes}:/vault

Title + workspaceId metadata
  -> PostgreSQL app_settings document.notes.metadata via storage-api
```

### Key files

| Piece | Path |
| --- | --- |
| Notes API | `server/integrations/notes-server.mjs` |
| Compose service | `docker-compose.yml` → `notes-api` |
| Env knob | `.env` / `.env.example` → `VSTART2_NOTES_ROOT` |
| UI | `src/components/ServiceRailView.jsx` → `NotesServiceView` |
| Widget entry | `src/components/WidgetRail.jsx` |
| Proxy | `nginx.conf` → `location /notes/` |
| Tests | `tests/serviceRailNotes.test.jsx` |
| Docs | `docs/DATA_AND_SERVICES.md`, `docs/SETTINGS.md`, `README.md` |

### API surface (notes-api)

- `GET /notes/health`
- `GET /notes/api/v1/vault/:vaultId/notes[?folder=]`
- `PUT /notes/api/v1/vault/:vaultId/notes/:noteId` body: `{ title, content, workspaceId, folder }`
- `DELETE /notes/api/v1/vault/:vaultId/notes/:noteId[?folder=]`
- `POST /notes/api/v1/folders` body: `{ folders: string[] }`
- `POST /notes/api/v1/folders/delete` body: `{ folders: string[] }`

Save behavior:

- Writes pure Markdown body only (`content`), no frontmatter.
- Filename: `${sanitizeId(noteId)}.md`
- Directory: `ROOT` or `ROOT/<folder>` when `payload.folder` is set.
- Does **not** derive folder from `workspaceId`.

## Live runtime findings (2026-07-20)

### Configured root (wrong)

`.env`:

```text
VSTART2_NOTES_ROOT=/Users/vbitzx/Desktop/SYNC/Vaults
```

That host path **does not exist**. Real vault is:

```text
/Users/vbitzx/SYNC/Vaults
```

(`~/Desktop/SS` is a symlink to `~/SS`, but there is no `~/Desktop/SYNC`.)

### Container mount (live)

```text
notes-api NOTES_ROOT=/vault
bind src=/Users/vbitzx/Desktop/SYNC/Vaults -> dst=/vault
```

Because the host path is missing, OrbStack still presents a writable mount. Host-visible container vault:

```text
/Users/vbitzx/OrbStack/docker/containers/vstart2-notes-api-1/vault/
```

### Where the user's saved note actually is

API listed:

- id: `7e02f28b-6ed4-4568-a511-ce6aa0fe6b3a`
- file body: empty
- folder: `""` (vault root, not workspace subfolder)

PostgreSQL `settings.document.notes.metadata`:

```json
{
  "7e02f28b-6ed4-4568-a511-ce6aa0fe6b3a": {
    "title": "k",
    "workspaceId": "a09ea62b-7d84-4b48-b432-e7c8434f4ca3"
  }
}
```

That workspace id is **Atamcare**. So the note is titled `k`, assigned to Atamcare in DB metadata, and stored as an empty `.md` at the phantom vault root — not under `/Users/vbitzx/SYNC/Vaults/Atamcare/`.

Real Obsidian vault already has older workspace-ish folders such as `Home/`, `home/`, `vstart/`, plus many root notes. V Start 2 is not writing there today.

### Frontend behavior gap

`NotesServiceView` save payload:

```js
JSON.stringify({ title, content: editor.content, workspaceId })
```

Missing:

- `folder` derived from workspace name/slug
- `ensureVaultFolders([...])` before save
- any vault-root setting read/write

Workspace filtering in the UI uses `settings.notes.metadata[noteId].workspaceId`, not filesystem folders.

### Settings UI gap

`docs/SETTINGS.md` Widgets page only covers notes filter/default view behavior. There is:

- no vault path field
- no “open vault folder” status
- no workspace→folder mapping control

Vault root is compose/env-only today (`VSTART2_NOTES_ROOT`), requiring container recreate to change.

## Design vs implementation matrix

| Expected | Implemented? | Notes |
| --- | --- | --- |
| Save into Obsidian vault on SYNC | Partial / broken | Env points at wrong Desktop path; real vault unused |
| Workspace → matching subfolder | No | API supports `folder`; UI never sends it |
| Auto-create missing workspace folder | No | API has `/folders`; UI never calls it |
| Settings control for vault location | No | Env-only at stack start |
| Note title durable in file | Partial | Title only in PostgreSQL metadata; file is body-only |
| Workspace durable in file/path | Partial | Workspace only in PostgreSQL metadata |

## Immediate fix (ops)

`.env` and compose now default to:

```bash
VSTART2_NOTES_BIND_HOST=/Users/vbitzx
VSTART2_NOTES_ROOT=/Users/vbitzx/SYNC/Vaults
```

Notes service mounts the bind host at `/host` and resolves the configured vault path under it.
Settings → Widgets exposes **Notes vault path** and writes:

1. `PUT /notes/api/v1/config` with `{ vaultPath }`
2. PostgreSQL `settings.notes.vaultPath`

Opening Notes reapplies the saved path before listing.

```bash
docker compose up -d --force-recreate notes-api
docker compose build app && docker compose up -d app
curl -sS http://127.0.0.1:3410/notes/api/v1/config | python3 -m json.tool
```

## Recommended product fix

### 1. Correct default / documented path

- Default example: `/Users/vbitzx/SYNC/Vaults` on this machine, or keep portable `./data/notes` for fresh clones.
- Reject/warn when configured host path does not exist at compose start.

### 2. Workspace folder mapping

On save / workspace ensure:

1. Resolve folder name from workspace **name** (or stable slug; pick one and document case rules).
2. `POST /notes/api/v1/folders` with that folder if missing.
3. `PUT` note with `folder: <workspaceName>`.
4. Keep PostgreSQL metadata for title/workspaceId as today, or later move title into filename/frontmatter if desired.

Open decisions:

- Use workspace `name` vs `slug` (`Home` vs `home`). Real vault already has both `Home` and `home`.
- Whether renaming a workspace renames the folder.
- Whether root-level pre-existing vault notes appear in All or are ignored unless they have metadata.

### 3. Settings: vault location

Because notes-api runs in Docker, a pure browser setting cannot freely remount host paths without a privileged host helper. Practical options:

**A. Env + Settings display (smallest)**  
Settings → Widgets/Notes or Data & System shows current mounted root (from notes-api health/config endpoint) and edit instructions for `VSTART2_NOTES_ROOT`.

**B. Settings writes config + recreates service (medium)**  
Storage-api or a tiny host bridge writes `.env` / a notes config file and runs a constrained recreate of `notes-api`.

**C. Native notes bridge like mail/environment (largest, best macOS fit)**  
Loopback host process reads/writes the vault as the user, avoiding Docker bind-mount path fragility entirely.

Recommendation: ship **A + workspace folders** immediately; consider **C** if vault path changes should be routine GUI operations.

### 4. Health endpoint enrichment

Extend `GET /notes/health` (or add `/notes/api/v1/config`) to return:

```json
{
  "ok": true,
  "root": "/vault",
  "rootHostHint": "/Users/vbitzx/SYNC/Vaults",
  "writable": true,
  "noteCount": 123
}
```

Surface this in Settings → Data & System service health.

## Verification checklist after fix

- [ ] `notes-api` mount source is `/Users/vbitzx/SYNC/Vaults`
- [ ] Creating a note in Home creates/uses `/Users/vbitzx/SYNC/Vaults/Home/<id>.md` (or chosen convention)
- [ ] Creating a note in Atamcare uses `/Users/vbitzx/SYNC/Vaults/Atamcare/<id>.md`
- [ ] File body visible in Obsidian immediately
- [ ] Title/workspace still filter correctly after refresh
- [ ] Settings shows vault path (even if read-only initially)
- [ ] Phantom OrbStack vault no longer receives new notes

## Probe cleanup

Temporary API probes `probe-*` / folder `Home` created during investigation were deleted via the notes API. The user note `7e02f28b-...` was left untouched in the phantom mount.
