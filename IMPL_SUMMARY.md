# Mission Glance implementation summary

## What was added

### Home widget and configuration

- `src/components/MissionGlanceWidget.jsx`: compact, read-only wide-rail project status card.
- `src/components/MissionGlanceWidget.test.jsx`: success, mixed availability, bridge failure, recent-dot, truncation, and no-mutation-control coverage.
- `src/lib/missionGlance.js`: default paths, path normalization, relative-time/freshness helpers, subject truncation, and the same-origin bridge client.
- `src/lib/missionGlance.test.js`: path, relative-time, freshness, and truncation coverage.
- `src/components/WidgetRail.jsx`: registers Mission Glance in the native wide Home widget rail.
- `src/components/SettingsPanel.jsx`: adds the visibility toggle and one-absolute-path-per-line editor under Settings → Widgets.
- `src/styles.css`: transparent, theme-token-based rail and settings styling.
- `tests/settingsMissionGlance.test.jsx`: verifies PostgreSQL settings patch shapes and paths containing spaces.
- `tests/widgetRailLocations.test.jsx` and `src/components/MusicWidget.test.jsx`: explicitly disable Mission Glance in unrelated widget fixtures.
- `migrations/028_mission_glance_widget.sql`: enables the widget and seeds the five requested project paths for existing and new databases.

### Host-local data adapter

- `environment-bridge/git-project-service.mjs`: bounded, cached, read-only Git snapshot service.
- `environment-bridge/git-project-service.test.js`: argv/path-with-spaces, dirty-count, detached-HEAD, unavailable, validation, and cache coverage.
- `environment-bridge/http-server.mjs`: adds the typed `POST /v1/projects/snapshot` route to the existing loopback-only bridge.
- `environment-bridge/http-server.test.js`: covers the versioned project snapshot contract and required JSON content type.
- `environment-bridge/launchd.mjs` and `.env.example`: record the fixed Git executable path (`/usr/bin/git` by default) in the existing LaunchAgent.
- `environment-bridge/README.md`, `README.md`, and `docs/SETTINGS.md`: document the data path, configuration, and operator flow.

## Data path and safety boundary

PostgreSQL remains the only durable application store. Migration 028 seeds:

- `app_settings.document.widgets.missionGlance` for visibility.
- `app_settings.document.missionGlance.projectPaths` for the configured absolute paths.

The Home widget reads those paths from bootstrap settings and sends them through the existing same-origin `/environment-bridge` proxy to `POST /v1/projects/snapshot`. The native Environment Bridge still binds only to `127.0.0.1:3140` and retains its loopback peer, Host, and Origin checks.

For each validated path, the bridge invokes `/usr/bin/git` directly with argument arrays and no shell:

- `git -C <path> branch --show-current`
- `git -C <path> status --porcelain=v1 -z`
- `git -C <path> log -1 --format=%ct%x00%s`

Inputs are limited to 20 absolute, non-NUL paths of at most 4096 characters. Each Git process has a two-second timeout and the combined output is capped at 128 KiB. Results, including unavailable results, have a ten-second per-path cache; the widget refreshes every 15 seconds. Any missing path, non-repository, command failure, malformed result, or bridge outage renders `unavailable` for the affected configured project and never substitutes fake status values or exposes Git stderr.

## Default configuration

Settings → Widgets → Mission Glance projects stores one absolute path per line. The defaults are:

```text
/Users/vbitzx/SS/trucking saas
/Users/vbitzx/SS/DEV/dental-pms
/Users/vbitzx/SS/APC-Universal-Compiler
/Users/vbitzx/SS/PAYMENT WATCH
/Users/vbitzx/SS/vstart2
```

## Verification

Commands were run from this worktree with Node `v24.11.0` and npm `11.6.1`.

- `npm ci`: could not complete because the sandbox cannot resolve `registry.npmjs.org`; npm ended with `Exit handler never called` after repeated `ENOTFOUND` errors. Verification used a local copy of the matching ignored `node_modules` tree from the untouched primary vstart2 checkout; no external repository files were changed.
- `npm run lint`: passed.
- `npm run check:persistence`: passed (`Browser persistence guard passed`).
- `npm run build`: passed; Vite built 1,642 modules. It emitted the repository's existing dynamic-import and large-chunk warnings.
- `npm test -- environment-bridge/git-project-service.test.js src/lib/missionGlance.test.js src/components/MissionGlanceWidget.test.jsx tests/settingsMissionGlance.test.jsx tests/widgetRailLocations.test.jsx src/components/MusicWidget.test.jsx`: passed, 6 files and 23 tests.
- `npm test`: 60 files and 233 tests passed; 19 tests in four existing/new HTTP transport files failed only because this sandbox rejects ephemeral loopback listeners with `listen EPERM: operation not permitted 127.0.0.1`. The affected files were `agent-bridge/http-server.test.js`, `agent-bridge/webui-client.test.js`, `mail-bridge/http-server.test.js`, and `environment-bridge/http-server.test.js`.
- `npm test -- --exclude agent-bridge/http-server.test.js --exclude agent-bridge/webui-client.test.js --exclude mail-bridge/http-server.test.js --exclude environment-bridge/http-server.test.js`: passed, 60 files and 233 tests.
- A direct `GitProjectService` snapshot against this worktree passed with `available: true`, the expected branch, an integer dirty count, and a real last commit.
- `git diff --check`: passed.

`npm run test:integration` was not run because it requires the full Docker stack and is separate from the repository's requested `npm test` suite.

## Commit status

The implementation could not be committed from this execution environment. This linked worktree keeps its Git administrative index under `/Users/vbitzx/SS/vstart2/.git/worktrees/mission-glance`, which is read-only to the sandbox. The exact commit attempt failed before staging anything:

```text
fatal: Unable to create '/Users/vbitzx/SS/vstart2/.git/worktrees/mission-glance/index.lock': Operation not permitted
```

The pre-existing untracked `.agent-task.md` remains untouched and excluded. From a shell with normal repository permissions, create the intended two logical commits with:

```sh
git add .env.example environment-bridge/README.md environment-bridge/git-project-service.mjs environment-bridge/git-project-service.test.js environment-bridge/http-server.mjs environment-bridge/http-server.test.js environment-bridge/launchd.mjs
git commit -m "Add read-only Git snapshots to environment bridge"

git add README.md docs/SETTINGS.md IMPL_SUMMARY.md migrations/028_mission_glance_widget.sql src/components/MissionGlanceWidget.jsx src/components/MissionGlanceWidget.test.jsx src/components/MusicWidget.test.jsx src/components/SettingsPanel.jsx src/components/WidgetRail.jsx src/lib/missionGlance.js src/lib/missionGlance.test.js src/styles.css tests/settingsMissionGlance.test.jsx tests/widgetRailLocations.test.jsx
git commit -m "Add PostgreSQL-backed Mission Glance widget"
```

## How to try it

For the normal Docker-backed app, install or restart the existing native bridge, then start the documented stack:

```sh
npm run environment:bridge:manage -- install
# If already installed after updating this checkout:
npm run environment:bridge:manage -- restart
./scripts/stack.sh up
```

Open `http://localhost:3000` in Wide Mode. Mission Glance appears in the Home widget rail below Notes/Mail and above Environment. Edit its paths or visibility under Settings → Widgets.

For a foreground local UI flow, keep the storage API/database available, then use loopback-only processes:

```sh
npm run environment:bridge
npm run dev -- --host 127.0.0.1
```

## Intentionally left for v2

- Custom display names (v1 derives names from the final path segment).
- Manual refresh, history, repository actions, checkout, commit, or other mutating controls.
- A Compact Mode service view; Compact Mode intentionally removes the widget rail, and v1 does not add a new expanded route solely for Mission Glance.
