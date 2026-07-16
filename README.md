# V Start 2

V Start 2 is a separate, database-first rebuild of the V Start presentation layer.
It keeps the useful local services and selected UI components from V Start 1, but it
does not inherit V Start 1's layout-mode hierarchy or browser-storage persistence.

## Product sentence

A two-column start page with a transparent widget rail, a large responsive speed-dial
rail, an integrated movable search dock, workspace URLs, and one automatic compact
state.

## Non-negotiable constraints

- V Start 2 lives in `/Users/vbitzx/SS/vstart2` and runs as its own Docker Compose project.
- PostgreSQL is the only durable application store.
- The browser may hold temporary UI state in memory, but it may not persist application
  state in `localStorage`, `sessionStorage`, IndexedDB, Cache Storage, or cookies.
- There are exactly two page columns in normal mode and one compact state at narrow widths.
- There are no Stage 1/Stage 2 variants and no alternate speed-dial modes.
- Shortcuts use continuous, database-backed free placement across the full dial rail.
  Shortcut rectangles may not overlap, and there is no automatic packing or gravity.
- Wide and Compact Mode have separate automatic placement canvases, not user-selectable
  speed-dial modes.
- Wide Mode uses the widget and dial columns. Compact Mode automatically removes the
  widget column, hides clock/weather, and retains a small widget-access dock.
- "Edge effect" is visual styling only. It never changes layout behavior.
- The exact V Start 1 AI glyph is the entry point for the optional Hermes-backed Agent
  Mode. V Start ships no provider-specific backend, provider settings, API keys, or direct
  provider API calls; local agent execution stays behind an explicit loopback host bridge.
- V Start 1 remains untouched and independently runnable during development.

## Specification index

- [Product specification](docs/PRODUCT_SPEC.md)
- [Data and service architecture](docs/DATA_AND_SERVICES.md)
- [Settings organization](docs/SETTINGS.md)
- [Implementation sequence](docs/IMPLEMENTATION_SEQUENCE.md)
- [Hermes Agent Mode](docs/AGENT_MODE.md)

## Run it

```sh
cd /Users/vbitzx/SS/vstart2
./scripts/stack.sh up
```

Open [http://localhost:3000](http://localhost:3000). The root route resolves to the
database-backed last active workspace at `/w/:slug`.

Useful stack commands:

```sh
./scripts/stack.sh status
./scripts/stack.sh logs
./scripts/stack.sh down
./scripts/stack.sh reset  # destroys only the isolated V Start 2 Docker volumes
```

Agent Mode uses a separate native loopback bridge because Hermes and its local tools run
on macOS, not inside Docker. V Start proxies `/agent-bridge` to that loopback service, so
the same Agent Mode is available from LAN or Tailscale clients without exposing port 3120.
Run it in the foreground with `npm run agent:bridge`, or see
[the Agent Bridge operator guide](agent-bridge/README.md) for the optional explicit
`launchd` installation. Docker startup never installs the host service. When the active
Hermes profile has approvals disabled, the bridge starts in a safety-locked state and V
Start refuses agent execution.

Parallel host ports:

| Service | Port |
| --- | ---: |
| Application | `3000` |
| Storage/application API | `3110` |
| PostgreSQL | `55432` |
| Image search | `3310` |
| Notes | `3410` |
| Speech to text | `8091` |
| Agent bridge (optional native host service) | `/agent-bridge` via V Start; `3120` loopback only |
| Mail bridge (native host service) | `3130` loopback only |

Configure `IMGBB_API_KEY` and optionally `VSTART2_NOTES_ROOT` in the shell or an
untracked `.env` file before stack startup. Mail uses the existing local `mailctl`
accounts and Keychain credentials through the native
[Mail Bridge](mail-bridge/README.md); install it with
`npm run mail:bridge:manage -- install`.
There is intentionally no AI service or AI-provider configuration.

The Music widget is connected through a database-backed source registry. V Start seeds a
YouTube Music Desktop source at `http://127.0.0.1:26538`; enable the YouTube Music
Desktop API Server plugin on that port, then manage or test sources in Settings → Music.
The widget exposes the active-source selector and live transport controls, while the Music
view provides the current queue and provider search. Loopback traffic is proxied through
the storage API so the Docker-hosted app can reach the macOS player.

To migrate an empty V Start 2 database from a running V Start 1 stack, use
`npm run migrate:v1`. The migration reads V1 through its state API and writes V2 in one
PostgreSQL transaction. It preserves the source database and refuses to add duplicates
when V2 already contains shortcuts.

Run `npm run backfill:icons` after importing legacy data to copy retrievable shortcut
images into PostgreSQL. Normal shortcut creation performs the same retrieval automatically.

To import V Start 1's bundled and uploaded background library into PostgreSQL, run:

```sh
npm run import:vstart1:backgrounds -- --source /Users/vbitzx/SS/VSTART --select theme_2.gif
```

The import is transactional and content-deduplicated. `--select` optionally makes the
matching imported image the global background; imported assets remain selectable from
Settings → Backgrounds.

## Verify it

```sh
npm install
npm run verify
npm run test:integration  # requires the stack to be running
```

The verification command runs lint, the browser-persistence guard, unit tests, and a
production build. The integration smoke test exercises idempotent creation, refresh
persistence, database collision rejection, movement, folder transactions, deletion, and
database-backed settings.

## Current status

The first standalone implementation is runnable. It includes the database-first API,
two-column Wide/Compact shell, workspace URLs, continuous shortcut placement, folders,
icon override/upload retrieval, movable search dock, inline results, widget service
adapters, background assets, and reorganized settings. V Start 1 is not a runtime
dependency and remains untouched. The initial Hermes Agent Mode is also implemented with
first-class session URLs, streaming UI, tool/approval/clarification surfaces, model and
reasoning controls, workspace preferences in PostgreSQL, and a secured native bridge.
