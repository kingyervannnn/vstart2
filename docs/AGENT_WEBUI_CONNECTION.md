# Agent Mode ↔ Hermes connection (local bridge + WebUI/tailnet)

Status: implemented  
Last updated: 2026-07-21

## Goal

Make V Start 2 Agent Mode attach to the same durable Hermes server you already open in the browser:

`https://vahagns-macbook-pro.tail030d61.ts.net:8788`

with URL + password, instead of only spawning a private `tui_gateway` child under the agent bridge.

## Architecture

Browser still never talks to Hermes credentials/tools directly:

```text
V Start UI
  → /agent-bridge (nginx → host :3120)
  → agent-bridge (loopback typed API)
       ├─ mode=local  → spawn python -m tui_gateway.entry (stdio JSON-RPC)
       └─ mode=webui  → HTTPS login + REST/SSE against Hermes WebUI
```

Important distinction:

| Endpoint | Product | Auth |
| --- | --- | --- |
| `:8788` on tailnet | **Hermes WebUI** (`SS/hermes-webui`) | password cookie `hermes_session` |
| Hermes Desktop remote gateway | `hermes serve` / dashboard WS | OAuth ticket or basic auth |

V Start’s WebUI mode targets the **WebUI** contract (`POST /api/auth/login`, `POST /api/session/new`, `POST /api/chat/start`, SSE `/api/chat/stream`).

## Settings

**Settings → Agent**

- Hermes connection: `Local agent bridge` or `Hermes WebUI / tailnet server`
- Hermes server URL (Postgres settings key `agent.remoteUrl`)
- Server password (write-only; saved on host via bridge)

Postgres stores only:

```json
{
  "connectionMode": "webui",
  "remoteUrl": "https://vahagns-macbook-pro.tail030d61.ts.net:8788",
  "remoteConfigured": true
}
```

Password is **not** in PostgreSQL. It is stored host-local at:

`~/Library/Application Support/VStart2/agent-bridge-connection.json` (mode `0600`)

Bridge env overrides (optional):

- `VSTART_AGENT_BACKEND=webui|local`
- `VSTART_AGENT_WEBUI_URL=...`
- `VSTART_AGENT_WEBUI_PASSWORD=...`
- `VSTART_AGENT_CONNECTION_FILE=...`

## Bridge API additions

- `GET /v1/connection` — public connection view (`mode`, `remoteUrl`, `hasPassword`)
- `PUT /v1/connection` — `{ mode, remoteUrl, password }` then restart backend
- `GET /v1/health` now includes `backend`, `remoteUrl`, `connection`

## Operator steps (this Mac)

```sh
# 1) Ensure Hermes WebUI is up on :8788 (launchd com.parantoux.hermes-webui)
# 2) Ensure Tailscale serve publishes :8788
# 3) Save connection (password never printed)
node -e "
import { saveConnectionConfig } from './agent-bridge/connection-config.mjs'
console.log(await saveConnectionConfig({
  mode: 'webui',
  remoteUrl: 'https://vahagns-macbook-pro.tail030d61.ts.net:8788',
  password: process.env.HERMES_WEBUI_PASSWORD,
}))
"

npm run agent:bridge:manage -- restart

# 4) Verify
curl -sS -X POST http://127.0.0.1:3120/v1/handshake \
  -H 'Content-Type: application/json' -H 'Origin: http://127.0.0.1:3000' -d '{}'
# then health with nonce → backend=webui, safe=true, no tui_gateway child
```

Or use Settings → Agent → WebUI fields and blur-save the password.

## Snappiness notes

- WebUI mode does **not** spawn `tui_gateway.entry`, so it avoids the slash_worker pile that was under the old local gateway child.
- 2026-07-21 cleanup killed **95** slash_workers under bridge gateway PID 24904 only. Claude, DPMS, Hermes Desktop, and `:8788` were left alone.
- Dual runtimes can still coexist: Hermes Desktop `hermes serve`, Hermes WebUI, and V Start bridge. Prefer WebUI mode for Agent Mode when you want one warm server.

## Limits (current)

- Approvals/clarify/directory picker/image attach are local-bridge complete; WebUI mode streams chat + tools basic mapping and defers some control surfaces.
- WebUI mode trusts Hermes WebUI’s own tool approval UX for sensitive actions.
- Password rotate: re-enter password in Settings (overwrites host secret file).

## Verification checklist

- [x] `agent-bridge` tests green (17)
- [x] Bridge health `backend: webui`, `safe: true`
- [x] Session create against WebUI returns `session_id`
- [x] Models list returns authenticated provider
- [x] No `tui_gateway.entry` child under bridge in webui mode
- [x] Claude process still running after worker cleanup + switch
- [x] WebUI `:8788` still serving
- [ ] Hard-refresh V Start UI after app image rebuild to see Settings fields
- [ ] Send a turn from Agent Mode UI and confirm stream completes
