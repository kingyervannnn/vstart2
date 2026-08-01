# Agent Mode connection snappiness (2026-07-21)

Status: diagnosis + recommendation  
Scope: V Start 2 Agent Mode on this Mac (`SS/vstart2`), not Hermes Desktop remote-gateway, not DPMS fleet.

## What you are seeing

Agent Mode shows **Connecting locally** / **Reconnecting locally** while the browser re-handshakes the Agent Bridge, waits for `gatewayReady`/`safe`, prewarms models/sessions, and re-opens the NDJSON event stream.

That strip is owned by `src/components/AgentMode.jsx` and talks only to the typed bridge client in `src/lib/agentBridge.js`.

## Current architecture (intentional)

```text
Browser (V Start UI, often via :3000)
    |  same-origin HTTP + NDJSON  (/agent-bridge)
    v
nginx in app container
    |  proxy → host.docker.internal:3120
    |  rewrites Host/Origin to loopback allowlist
    v
agent-bridge (native launchd: com.vstart.agent-bridge)
    binds 127.0.0.1:3120 only
    |  stdio newline JSON-RPC
    v
python -m tui_gateway.entry   (Hermes child of the bridge)
    |
    +-- Hermes SessionDB, tools, credentials, local Mac capabilities
```

Design sources: `docs/AGENT_MODE.md`, `agent-bridge/README.md`, `nginx.conf`.

### Why this shape exists

- Docker must not own Hermes credentials, Keychain, or host tools.
- The browser must not spawn CLIs.
- The bridge is a **typed, origin-gated, loopback** adapter — not a generic Hermes RPC passthrough and not a remote multi-tenant server.

Tailscale already has a defined role:

- **Remote browsers** (phone / another laptop on the tailnet) open V Start’s own origin.
- nginx proxies `/agent-bridge` to the **host loopback** bridge.
- Port `3120` is never published on the tailnet.

That is “Tailscale to reach V Start,” not “Tailscale instead of the agent bridge.”

## Live snapshot (this machine)

| Check | Result |
| --- | --- |
| `com.vstart.agent-bridge` | running (`node …/agent-bridge/index.mjs`, up ~1d8h) |
| `POST /v1/handshake` (Origin `http://127.0.0.1:3000`) | ok |
| `GET /v1/health` | `status=ready`, `gatewayReady=true`, `safe=true`, `approvalsMode=manual` |
| Settings `agent.bridgeUrl` | `/agent-bridge` |
| Bridge child | `tui_gateway.entry` PID under the bridge |
| Orphan load under that gateway | **~94–98 `tui_gateway.slash_worker` children**, ~**1.9 GB** RSS combined |
| Competing Hermes Desktop | separate `hermes serve` + its own workers on the same Mac / same `HERMES_HOME` |

Health is green, but the Hermes child under the bridge is carrying a large zombie-worker set. That is the primary snappiness risk for **this PC controlling this PC**.

## Proposal review: “connect via Tailscale / remote Hermes serve + password instead of agent bridge”

### What is already in settings

`settings.agent.bridgeUrl` exists (Settings → Agent). Validation only allows:

- same-origin `/agent-bridge`, or
- loopback `http://127.0.0.1|localhost:…`

Credentials are deliberately **not** stored in V Start (`docs/SETTINGS.md` §7, `docs/AGENT_MODE.md`).

### Would remote Hermes serve make Agent Mode snappier?

| Goal | Remote `hermes serve` + password over tailnet | Keep / harden agent-bridge |
| --- | --- | --- |
| Control **this** Mac’s tools, FS, Keychain, mail/lights wrappers | **No** unless the serve process runs **on this Mac** | **Yes** (by design) |
| Open V Start from another device on the tailnet | Already works via V Start origin + nginx | Same |
| Drop the bridge process | Loses typed safety lock, nonce, origin gate, directory picker, approval shaping | Keeps product contract |
| Snappier open on this Mac | Extra hop; does not fix worker leak | Fix leak + reconnect path |
| Point at DPMS fleet | Wrong host for “control this PC”; user ruled DPMS out | N/A |

**Recommendation: do not replace the agent bridge with a passworded remote Hermes server for the default local Agent Mode.**

That path is a different product mode (“thin V Start UI over a remote agent host”) and breaks the local-control guarantee that justified the bridge in the first place. DPMS fleet is out of scope for controlling this PC.

## What actually makes it snappy

Ordered by ROI for local Agent Mode:

### 1. Reclaim the Hermes child under the bridge (now)

The bridge’s `tui_gateway.entry` has accumulated ~100 `slash_worker` processes (~2 GB). Restart the bridge (or kill workers under that parent only) so session open does not fight a bloated gateway:

```sh
npm run agent:bridge:manage -- restart
# or: launchctl kickstart -k gui/$(id -u)/com.vstart.agent-bridge
```

Verify:

```sh
curl -sS -X POST http://127.0.0.1:3120/v1/handshake \
  -H 'Content-Type: application/json' -H 'Origin: http://127.0.0.1:3000' -d '{}'
# then health with nonce → gatewayReady/safe true
pgrep -P "$(pgrep -f 'tui_gateway.entry')" -c   # should be near 0 when idle
```

### 2. Stop dual-gateway contention on one Mac

Hermes Desktop’s managed `hermes serve` and V Start’s bridge-owned `tui_gateway.entry` both use the same Hermes home. Prefer one heavy Hermes runtime when measuring Agent Mode snappiness, or accept that Desktop boot/respawn will stress the same profile store the bridge uses.

### 3. Client reconnect polish (product code)

Already listed as remaining hardening in `AGENT_MODE.md`:

- Keep stream reconnect under prolonged loss without full session teardown.
- Avoid full prewarm + history reload on every strip flash when health is still ready.
- Surface bridge vs gateway vs stream failure distinctly (today many paths look like “reconnecting locally”).

### 4. Optional settings UX (keep loopback model)

Useful, low-risk settings work **without** remote password fields:

- Live bridge health chip (ready / locked / offline) with restart guidance.
- Explicit “Restart Agent Bridge” operator affordance (still host-side / docs, not browser shell).
- Clear copy that Tailscale clients use V Start’s origin; they do not configure a separate Hermes URL.

### 5. Future optional mode (only if product wants remote agent host)

If V Start ever needs “chat with an agent that lives elsewhere,” add an explicit second mode, not a silent replacement:

- `agent.connectionMode: local-bridge | remote-serve`
- Remote: base URL + auth handled like Hermes dashboard basic/OAuth (secrets not in casual settings paste if avoidable)
- Remote mode must disable or clearly mark local-only capabilities (directory picker, host tools expectation)
- Default remains `local-bridge` for this Mac

Do **not** implement that as the fix for local reconnect chrome.

## What not to do

- Do not point Agent Mode at DPMS / fleet Hermes to control this PC.
- Do not put Hermes dashboard password into V Start settings as a substitute for the bridge while still claiming local tool control.
- Do not bind agent-bridge to `0.0.0.0` or a tailnet IP; keep loopback and use nginx.
- Do not treat green `/v1/health` as proof the UI will feel instant while ~100 workers hang off the gateway child.

## Verification checklist

- [ ] Bridge launchd running; health `safe: true`
- [ ] Idle `slash_worker` count under bridge gateway near zero
- [ ] Open `/w/<slug>/agent/new` → ready strip absent or sub-second
- [ ] Refresh mid-session resumes without multi-second reconnect loop
- [ ] Tailscale phone → V Start origin still reaches Agent Mode via `/agent-bridge` proxy
- [ ] No new credential fields required for the local path

## Decision

| Idea | Verdict |
| --- | --- |
| Tailscale to open V Start from other devices | **Already supported** (app origin + nginx → host bridge) |
| Replace agent-bridge with remote Hermes serve + password for local Agent Mode | **Superseded** — implemented **Hermes WebUI mode** instead (see `docs/AGENT_WEBUI_CONNECTION.md`) |
| Settings fields for remote server URL/password | **Done** (URL in Postgres; password host-local bridge secret) |
| Kill worker leak + tighten reconnect + optional health UI | Worker leak cleaned 2026-07-21; WebUI mode avoids new piles |

Live WebUI mode check (2026-07-21): bridge `backend=webui`, `safe=true`, turn stream produced `message.delta` → `turn.complete`, no `tui_gateway` child under bridge.
