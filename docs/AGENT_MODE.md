# V Start 2 Hermes Agent Mode Specification

Status: initial implementation complete; hardening remains  
Owner: V Start 2  
Initial runtime: Hermes Agent  
Last updated: 2026-07-14

## 0. Implementation status

The first implementation now exists in `agent-bridge/`, `src/components/AgentMode.jsx`,
and migration `008_agent_mode.sql`. It includes the typed loopback bridge, deterministic
fake-gateway coverage, bridge supervision, safety lock, first-class routes, browser client,
PostgreSQL workspace/session-link storage, streaming conversation UI, tool activity,
approval and clarification cards, model/reasoning/fast controls, interrupt/steer, native
directory selection, responsive Wide/Compact layout, and explicit launchd management.

The current machine's Hermes profile uses `manual` approvals, and the Agent Bridge is
installed and loaded as the per-user `com.vstart.agent-bridge` launchd service. A live
Copilot `gpt-4o-mini` run has passed gateway and HTTP-bridge streaming, pause-before-tool,
Allow once, steering, interruption, restart/resume, and browser reload checks. V Start
still fails closed whenever the active Hermes profile reports approvals `off`; it never
silently relaxes the global Hermes policy.

The active OpenAI Codex credential is currently invalidated, so the tested workspace
preference is Copilot `gpt-4o-mini`. Credentials remain owned by Hermes and are never
stored in V Start. Remaining hardening work includes session-link rename/pin/unlink
controls in the conversation toolbar, richer collapsible tool detail, stream reconnection
under prolonged network loss, and the full Phase G matrix.

## 1. Product decision

V Start 2 should add Agent Mode, but it should not build a general CLI registry first.

Hermes already provides the common agent layer V Start needs: saved sessions, streaming
messages, model/provider discovery, reasoning levels, tool events, approvals, steering,
and interruption. V Start should therefore be a Hermes client, not a second agent
orchestrator and not a direct wrapper around Codex, Claude, Grok, or other CLIs.

The integration target is Hermes' structured `tui_gateway` JSON-RPC interface. The
following are explicitly not the primary integration target:

- `hermes mcp serve`, because it exposes messaging conversations rather than new
  interactive agent execution.
- The Hermes dashboard, because its browser/PTY implementation is a user interface rather
  than a stable V Start service contract.
- `hermes acp`, because ACP is optimized for editor clients and exposes less of the Hermes
  session/configuration surface than `tui_gateway`.
- Direct provider APIs, provider API keys, or a V Start-specific AI backend.

The first version will use one adapter, `hermes`. A typed adapter boundary may be retained
inside the host bridge so another runtime can be added later, but there will be no UI or
database abstraction for hypothetical providers until a concrete Hermes limitation is
found.

`/Users/vbitzx/TOOLS.md` remains the human-readable local capability index. V Start does
not scrape it, turn it into an executable catalog, or duplicate it in PostgreSQL. Hermes'
own model/tool/session APIs are the machine-readable runtime inventory for Agent Mode.

## 2. Product outcome

Clicking the existing V Start 1 AI glyph opens Agent Mode in the active workspace. Agent
Mode temporarily replaces the speed-dial contents with a native V Start conversation
surface while preserving the widget rail, background, workspace identity, and search-dock
placement.

The user can:

- Start, resume, rename, and switch Hermes sessions.
- Send a prompt and see assistant text stream into the page.
- See tool starts, progress, results, and failures without opening a terminal.
- Approve or deny a tool request with the exact action visible.
- Interrupt a turn or steer a running session.
- Select an authenticated Hermes model/provider.
- Choose a supported reasoning effort and fast mode.
- Use a workspace-specific working directory and model preference.
- Refresh V Start and resume the same durable Hermes session.
- Close Agent Mode and return to the unchanged shortcut canvas.

Agent Mode is opt-in and failure-isolated. V Start remains a complete speed dial when the
host bridge or Hermes is stopped.

## 3. Architectural boundary

The browser cannot and should not execute local macOS CLIs. V Start's Docker containers
also cannot safely control host-local tools, credentials, Keychain state, or applications.
The system therefore has three ownership boundaries:

```text
V Start browser
    |
    | loopback HTTP + streamed NDJSON
    v
V Start Agent Bridge (native macOS process)
    |
    | newline-delimited JSON-RPC over stdio
    v
Hermes tui_gateway
    |
    +-- Hermes SessionDB
    +-- authenticated model providers
    +-- Hermes tools, skills, and local-system capabilities
```

### 3.1 V Start browser

The React application owns layout, presentation, route state, and explicit user input.
It never receives provider credentials and never invokes a provider API directly.

### 3.2 V Start Agent Bridge

`agent-bridge/` will live inside the V Start 2 repository and run as a native host process,
not as a Compose service. Co-locating its source keeps the feature versioned with the V
Start client while its protocol remains reusable by another local application later.

The bridge:

- Binds only to `127.0.0.1` on port `3120` by default.
- Supervises one long-lived Hermes `tui_gateway` child process.
- Starts the child with the Hermes Python runtime, repository root on `PYTHONPATH`, and
  `python -m tui_gateway.entry`.
- Resolves the active Hermes profile with Hermes' profile helpers and passes its
  `HERMES_HOME` explicitly. Profile switching requires a bridge restart in version 1.
- Correlates JSON-RPC responses and publishes normalized session events.
- Exposes a small typed HTTP contract rather than a generic JSON-RPC passthrough.
- Enforces origin, nonce, method, body-size, concurrency, and approval policies.
- Keeps only short-lived transport state in memory.

The bridge will include `install`, `start`, `stop`, `status`, `logs`, and `uninstall`
scripts backed by a per-user `launchd` service. Installation is an explicit action; the
Docker startup script must not silently install or start a host daemon.

Implementation uses Node ESM to match the existing V Start server, `child_process.spawn`
for the gateway, `readline` for newline-delimited JSON-RPC, Zod schemas at every HTTP
boundary, and Vitest with a fake gateway child. The bridge has its own entry point and must
not be imported into the browser bundle or storage API container.

### 3.3 Hermes

Hermes remains the agent runtime and owns:

- Provider authentication and credentials.
- Provider/model discovery.
- Prompt construction and context management.
- Conversation messages, tool traces, usage, and durable sessions.
- Tools, skills, subagents, local-system access, and permission requests.
- Model/reasoning capability validation.

The bridge consumes the public gateway contract. It must not import `AIAgent` or reach
into Hermes' internal database.

## 4. Source-of-truth rules

"Everything is database-backed" continues to mean that V Start never uses browser
persistence. It does not mean V Start should copy another service's complete database.

- PostgreSQL is authoritative for V Start settings, workspace defaults, and links to
  Hermes sessions.
- Hermes SessionDB is authoritative for conversation messages, tool activity, token usage,
  and session history.
- The browser holds the bridge nonce, current stream cursor, draft prompt, open popovers,
  and incomplete streamed text in memory only.
- The Agent Bridge holds process handles, pending requests, and a bounded event-replay
  buffer in memory only.

V Start must not duplicate prompt text, assistant responses, hidden reasoning, tool output,
credentials, or secrets in PostgreSQL or application logs.

## 5. V Start database additions

### 5.1 Global settings

Add a database-backed `agent` settings object:

```json
{
  "enabled": true,
  "bridgeUrl": "/agent-bridge",
  "defaultReasoningEffort": "medium",
  "defaultFastMode": false,
  "showToolActivity": true,
  "showUsage": false,
  "workspaceDefaultsEnabled": true
}
```

`bridgeUrl` is configuration, not a credential. Production validation permits the
same-origin `/agent-bridge` route or a native loopback host only. The same-origin route
keeps phone and LAN access behind V Start while the native bridge remains bound to
`127.0.0.1`. Provider keys and provider login controls are forbidden in V Start settings.

### 5.2 Workspace agent preferences

Create `workspace_agent_preferences`:

| Column | Type | Rules |
| --- | --- | --- |
| `workspace_id` | UUID | Primary key and workspace foreign key |
| `cwd` | text | Absolute path, nullable until explicitly selected |
| `provider` | text | Nullable Hermes provider slug |
| `model` | text | Nullable Hermes model id |
| `version` | integer | Optimistic concurrency version |
| `created_at` | timestamptz | Required |
| `updated_at` | timestamptz | Required |

Model/provider values are preferences, not promises. The client revalidates them against
`model.options` every time the bridge reconnects.

### 5.3 Hermes session links

Create `agent_session_links`:

| Column | Type | Rules |
| --- | --- | --- |
| `id` | UUID | V Start record id |
| `workspace_id` | UUID | Workspace foreign key |
| `hermes_session_id` | text | Canonical stored Hermes SessionDB id |
| `title_override` | text | Optional V Start-only display title |
| `pinned` | boolean | Default `false` |
| `last_opened_at` | timestamptz | Required |
| `created_at` | timestamptz | Required |
| `updated_at` | timestamptz | Required |
| `version` | integer | Optimistic concurrency version |

The unique key is `(workspace_id, hermes_session_id)`. Runtime session ids returned by a
particular gateway process are never persisted because they become invalid after a bridge
restart.

An empty `session.create` is not durable in Hermes yet. V Start holds its identifiers in
memory and inserts `agent_session_links` only after the bridge confirms that the first
prompt created the Hermes SessionDB record. Refreshing `/agent/new` before that point
returns to a new empty composer.

Deleting a V Start link does not delete the Hermes session. Destructive Hermes session
deletion is out of scope for version 1. Rename edits `title_override`; it does not silently
rename the canonical Hermes session.

## 6. Routes and workspace behavior

Agent Mode has first-class URLs:

- `/w/:workspaceSlug` — normal speed dial.
- `/w/:workspaceSlug/agent/new` — empty Agent Mode composer.
- `/w/:workspaceSlug/agent/:hermesSessionId` — resume a stored Hermes session.

The route contains the canonical stored Hermes id, never the process-local runtime id.
Closing Agent Mode returns to `/w/:workspaceSlug` without modifying shortcut or search-dock
geometry.

Switching workspaces while Agent Mode is open retains the normal scrolling-header and
workspace-switch animation. The destination workspace opens its most recently used linked
session or `/agent/new` when it has none. A running turn in the previous workspace remains
visible in the session picker and may continue, but the UI must clearly mark it as running.

## 7. Interface behavior

### 7.1 Entry and layout

- The existing AI glyph becomes the Agent Mode toggle.
- Opening Agent Mode hides shortcuts and folders transiently; it never mutates them.
- Wide Mode keeps the complete widget rail visible.
- Compact Mode remains automatic, keeps compact widget access, and gives Agent Mode the
  remaining page area.
- The existing search dock morphs into the agent composer at its persisted position and
  width. Its stored normal/compact geometry is not changed by entering Agent Mode.
- The composer remains movable and resizable using the existing dock interactions.
- The transcript scrolls beneath the floating composer with enough dynamic end padding
  that the newest message can always be scrolled clear of it.
- Workspace switchers stay associated with the dock in Wide Mode and remain automatically
  hidden in Compact Mode.

### 7.2 Conversation surface

The rail contains:

- A compact session picker with New, Resume, Rename Link, Pin, and Unlink.
- User and assistant messages rendered as native V Start components.
- A streaming cursor and explicit Running, Waiting for approval, Interrupted, Failed, and
  Complete states.
- Collapsible tool cards for tool name, sanitized arguments, progress, duration, result
  summary, and error state.
- Inline clarification and approval cards.
- Stop while a turn is running and Send/Steer behavior while Hermes accepts steering.
- Optional usage metadata from `session.usage`.

Raw hidden chain-of-thought is never requested or rendered. If Hermes emits a user-facing
reasoning summary, it may appear as a collapsed status region only when the runtime marks
it safe for display.

### 7.3 Model and reasoning controls

The model menu is populated only by `model.options` and groups entries by Hermes provider.
It shows authentication state, capability badges, and the active selection. Unauthenticated
providers direct the user to Hermes setup; V Start does not collect keys.
The active Hermes profile name is read-only in the UI. Changing profiles is completed in
Hermes and takes effect after an explicit bridge restart.

Reasoning options map directly to Hermes values:

| Label | Hermes value |
| --- | --- |
| Off | `none` |
| Minimal | `minimal` |
| Low | `low` |
| Medium | `medium` |
| High | `high` |
| Max | `xhigh` |

Unsupported levels are disabled based on model capabilities. Fast mode appears only when
the selected model/provider reports support. Model, reasoning, and fast-mode changes apply
between turns. Model selection is session-scoped. In the current Hermes gateway,
`config.set` for reasoning and fast mode also updates the active Hermes profile's shared
configuration; V Start therefore labels these controls as Hermes-profile defaults and does
not present them as workspace-specific in version 1. The V Start database mirrors the
requested defaults, and the UI refreshes effective values from `session.info`.

The UI must not change the model, active tool set, or skills while a turn is running because
Hermes prompt caching assumes a stable turn configuration.

### 7.4 Working directory

Each workspace may have a database-backed default working directory. The user selects it
through a native host directory picker exposed as a narrowly scoped bridge action. The
browser may not submit an arbitrary path as though it had already been user-approved.

The active working directory is displayed in Agent Mode. Changing it during a running turn
is disabled. A newly created session receives the workspace directory; resuming a Hermes
session preserves the session's existing directory unless the user explicitly changes it.

## 8. Bridge HTTP contract

All success and error bodies are JSON except the event stream, which is NDJSON. Every
response includes a protocol version. Version 1 exposes these typed operations:

| Method and path | Purpose |
| --- | --- |
| `GET /v1/health` | Process, Hermes child, and protocol readiness |
| `POST /v1/handshake` | Issue an ephemeral browser-session nonce |
| `GET /v1/capabilities` | Bridge and Hermes feature flags |
| `GET /v1/models?sessionId=` | Normalized `model.options` response |
| `GET /v1/sessions` | Saved Hermes sessions plus active runtime mapping |
| `POST /v1/sessions` | Create a runtime session with an approved working directory |
| `POST /v1/sessions/resume` | Resume a canonical stored Hermes session |
| `GET /v1/sessions/:runtimeId/history` | Read normalized Hermes history |
| `GET /v1/sessions/:runtimeId/status` | Current turn/session status |
| `GET /v1/sessions/:runtimeId/events?after=` | Authenticated fetch-based NDJSON stream |
| `POST /v1/sessions/:runtimeId/turns` | Submit one prompt and return a turn id |
| `POST /v1/sessions/:runtimeId/steer` | Steer the active turn |
| `POST /v1/sessions/:runtimeId/interrupt` | Interrupt the active turn |
| `PATCH /v1/sessions/:runtimeId/model` | Validated provider/model change between turns |
| `PATCH /v1/sessions/:runtimeId/reasoning` | Validated reasoning change between turns |
| `PATCH /v1/sessions/:runtimeId/fast-mode` | Validated fast-mode change between turns |
| `PATCH /v1/sessions/:runtimeId/directory` | Apply a one-time native directory grant between turns |
| `POST /v1/sessions/:runtimeId/approvals/:requestId` | Respond `once` or `deny` |
| `POST /v1/sessions/:runtimeId/clarifications/:requestId` | Respond to a non-secret question |
| `POST /v1/sessions/:runtimeId/close` | Close only the process-local runtime session |
| `POST /v1/directories/choose` | Open a native directory picker after a user gesture |

There is deliberately no endpoint that accepts an arbitrary Hermes method, shell command,
slash command, executable, provider key, secret, or sudo password.

### 8.1 Hermes method allowlist

The bridge implementation may call only the gateway methods required by the typed routes:

- `session.create`, `session.list`, `session.resume`, `session.history`, `session.status`,
  `session.usage`, `session.close`, `session.interrupt`, and
  `session.steer`.
- `session.cwd.set` after an explicit native directory-picker result.
- `prompt.submit`.
- `model.options`.
- `config.get` and the narrowly validated `reasoning`/`fast` forms of `config.set`.
- The fixed `/model` command assembled from a model returned by `model.options`.
- `approval.respond` and `clarify.respond`.

The bridge assigns a local request id when an upstream approval event has no request id.
It validates that the approval is still the one pending for that session and always sends
`approval.respond` with `all: false`.

Generic `command.dispatch`, `shell.exec`, `cli.exec`, `model.save_key`, `secret.respond`,
`sudo.respond`, tool/skill mutation, plugin mutation, process control, and session deletion
are denied in version 1.

### 8.2 Event envelope

The bridge normalizes Hermes events to:

```json
{
  "sequence": 42,
  "eventId": "evt_...",
  "sessionId": "runtime-session-id",
  "turnId": "turn_...",
  "type": "message.delta",
  "timestamp": "2026-07-14T02:00:00.000Z",
  "payload": {}
}
```

The supported event families are:

- `gateway.ready`, `gateway.restarting`, and `gateway.unavailable`.
- `session.ready`, `session.info`, `session.persisted`, and `session.closed`.
- `turn.started`, `turn.complete`, `turn.interrupted`, and `turn.failed`.
- `message.delta` and `message.complete`.
- `tool.start`, `tool.progress`, and `tool.complete`.
- `approval.request` and `approval.resolved`.
- `clarify.request` and `clarify.resolved`.
- `client.resync_required`.

The bridge retains a bounded in-memory replay ring. `after` resumes by sequence number. If
the cursor is too old, `client.resync_required` instructs the client to reload
`session.history`. Messages are never persisted by the bridge.

## 9. Security and permission model

### 9.1 Network boundary

- The bridge listens only on IPv4 loopback in version 1. No `0.0.0.0`, IPv6 wildcard,
  Tailnet, LAN, reverse proxy, or remote access.
- Allowed browser origins are exactly `http://localhost:3000` and
  `http://127.0.0.1:3000` unless the user explicitly changes the application port.
- Requests with a missing or unapproved `Origin` or unexpected `Host` are rejected.
- `POST /v1/handshake` issues a high-entropy, short-lived nonce after origin validation.
- Every other request requires the nonce in `X-VStart-Agent-Session`. The nonce exists in
  React memory only, rotates on bridge restart, and is never stored in cookies or browser
  persistence.
- Mutation routes require `Content-Type: application/json`; request sizes and prompt sizes
  are capped; all inputs receive schema validation.

### 9.2 Agent authority

- Hermes runs with approvals enabled. V Start never starts it in `--yolo` or an equivalent
  auto-approval mode.
- Tool approval cards show tool name, normalized arguments, working directory, and risk
  description before the user chooses Allow once or Deny.
- V Start does not expose a permanent Allow all option in version 1.
- Secret and sudo requests are denied by the bridge with a clear instruction to complete
  that workflow in the Hermes terminal. Secrets never enter the browser.
- One foreground turn may run per Hermes session. A second submission becomes an explicit
  steer action or is rejected; it is never silently raced.
- External or destructive actions remain subject to Hermes permissions and visible user
  approval. The bridge adds a boundary; it does not expand agent authority.

### 9.3 Logging

Default logs contain lifecycle state, request ids, event types, durations, status codes,
and sanitized error classes. They do not contain prompt bodies, assistant message bodies,
tool output, raw tool arguments, credentials, secrets, hidden reasoning, environment
variables, or full filesystem paths.

## 10. Failure and recovery behavior

- If the bridge is offline, the AI glyph still opens Agent Mode and shows local setup/status
  instructions plus Retry. The rest of V Start stays operational.
- If Hermes is unavailable, the bridge reports degraded health and performs bounded
  restart attempts with backoff. It must not crash-loop indefinitely.
- A bridge/Hermes restart invalidates runtime ids. V Start uses the stored Hermes id from
  the route or PostgreSQL link to resume and obtains a new runtime id.
- If the bridge dies during a turn, the client labels the stream disconnected rather than
  pretending the turn failed. On reconnect it reloads Hermes history and status.
- If a saved workspace model is no longer available, the client shows the mismatch and
  lets Hermes choose its configured default. It never silently rewrites the saved
  preference.
- If provider authentication expires, V Start links to the Hermes setup flow and never
  substitutes a different paid provider without confirmation.
- Closing the browser does not terminate Hermes automatically. Explicit Stop controls the
  turn; explicit Close releases the process-local session.

## 11. Initial non-goals

- A broad CLI registry or direct Codex/Claude/Grok/local-agent adapters.
- Provider API key entry, OAuth, billing, or credential storage in V Start.
- An AI service inside Docker.
- Remote browser or Tailnet access to the host bridge.
- Background autonomous scheduled agents.
- Browser entry of passwords, sudo prompts, or secrets.
- Tool, skill, plugin, MCP, or subagent configuration UI.
- Editing Hermes' canonical conversation history.
- Deleting canonical Hermes sessions from V Start.
- Exposing every Hermes slash command.
- Persisting raw conversation content in V Start PostgreSQL.

These are deliberate boundaries, not missing registry scaffolding.

## 12. Implementation sequence

### Phase A — Protocol spike

Build a disposable command-line harness before touching the V Start UI. Prove:

1. Reliable child startup and `gateway.ready` detection.
2. `session.create`, first-turn persistence, saved id discovery, close, and resume.
3. `model.options` and a between-turn model switch.
4. Reasoning and supported fast-mode changes, including their cross-session/profile scope.
5. Prompt text streaming and completion.
6. Tool start/progress/complete events.
7. Approval allow-once and deny.
8. Interrupt and steer.
9. Hermes child crash and stored-session recovery.

The spike is discarded or converted into bridge tests. Do not build React components until
all nine behaviors are proven against the installed Hermes runtime.

### Phase B — Host bridge

Build the native `agent-bridge` service, typed API, gateway supervisor, event replay ring,
launchd scripts, health command, structured errors, and fake-gateway test fixture.

Gate:

- The full HTTP contract passes with the fake fixture and real Hermes.
- Unknown routes and non-allowlisted operations fail closed.
- Origin, nonce, body-limit, loopback-binding, concurrency, and log-redaction tests pass.
- A bridge restart can resume a stored test session without data loss.

### Phase C — V Start persistence

Add PostgreSQL migrations, storage API validation, global agent settings, workspace agent
preferences, and session links.

Gate:

- Settings and links survive browser and Docker restarts.
- No agent data is written to browser persistence.
- Deleting a link cannot delete a Hermes session.

### Phase D — Agent Mode shell

Add routes, AI-glyph toggle, full rail takeover, compact behavior, floating composer,
offline/degraded states, workspace switching, and session picker.

Gate:

- Entering and leaving Agent Mode does not mutate shortcut or dock geometry.
- Wide, mirrored, resized, and Compact Mode layouts pass visual tests.
- Direct agent URLs and browser back/forward are deterministic.

### Phase E — Conversation and configuration

Add session create/resume, history, streaming messages, model picker, reasoning controls,
fast mode, usage display, working-directory selection, interrupt, and steer.

Gate:

- Refresh resumes the same canonical session.
- Model/reasoning changes are blocked mid-turn and applied on the next turn.
- Stream reconnect produces no duplicated message text.
- Unauthenticated models never prompt V Start for a provider key.

### Phase F — Tools and approvals

Add tool cards, progress, clarify cards, explicit allow-once/deny, approval timeouts, and
disconnect recovery.

Gate:

- A tool cannot run past an approval request without an explicit valid response.
- Denial is reflected accurately in the transcript.
- Secret and sudo requests fail closed and expose no sensitive payload.

### Phase G — Hardening and cutover

Run security, accessibility, keyboard, reduced-motion, long-session, crash-recovery,
provider-auth-expiry, Docker-restart, bridge-restart, and browser-refresh tests.

Agent Mode leaves preview only after every acceptance criterion below passes.

## 13. Acceptance criteria

1. Clicking the V Start 1 AI glyph opens a native full-dial-rail Agent Mode; closing it
   restores the unchanged speed dial.
2. Widget access remains available in Wide and Compact Mode.
3. A new Hermes conversation streams text and tool events without a page reload or iframe.
4. Refreshing or restarting V Start resumes the same stored Hermes session without browser
   persistence or duplicated conversation storage.
5. The model menu matches `model.options`; V Start contains no provider key field and makes
   no direct provider API call.
6. Supported reasoning/fast settings apply between turns and survive from PostgreSQL.
7. Tool execution requiring approval cannot proceed until the user selects Allow once;
   Deny is honored.
8. Interrupt and steer are deterministic, visibly acknowledged, and scoped to the selected
   session.
9. Workspace switching uses the destination workspace's linked session/defaults and does
   not stop a running session in another workspace.
10. A bridge/Hermes crash can recover through the canonical stored session id.
11. The bridge rejects non-loopback binding, unapproved origins, missing/expired nonces,
    oversized bodies, arbitrary gateway methods, secret/sudo input, and concurrent turns.
12. Security logs contain no prompt text, response text, tool output, credentials, secrets,
    hidden reasoning, or raw environment values.
13. V Start remains fully usable as a speed dial when Agent Mode, the bridge, Hermes, or a
    model provider is unavailable.

## 14. Decision checkpoint after version 1

Only revisit a broader CLI registry after Agent Mode has been used in practice and Hermes
has a measured gap. A new adapter is justified only when it needs a capability Hermes
cannot expose, not merely because another CLI is installed.

If that checkpoint is reached, keep the existing bridge HTTP contract and add one adapter
behind it. Do not expose executable discovery or arbitrary command construction to the
browser.
