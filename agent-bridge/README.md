# V Start Agent Bridge

The Agent Bridge is V Start 2's native, loopback-only adapter for Hermes
`tui_gateway`. It is intentionally not part of Docker: Hermes credentials, local tools,
Keychain access, and macOS folder selection stay on the host.

## Safety boundary

- Binds only to `127.0.0.1:3120`.
- V Start's nginx layer exposes it at the same-origin `/agent-bridge` route for LAN and
  Tailscale browsers; the native bridge port itself remains loopback-only.
- Accepts the V Start origins on port `3000` and requires an expiring in-memory nonce.
- Exposes typed V Start actions; there is no arbitrary RPC, CLI, executable, or shell route.
- Accepts approval decisions only as `once` or `deny`; permanent approval is unavailable.
- Interrupts and fails closed on Hermes secret or sudo prompts.
- Locks prompt/configuration execution when the active Hermes profile has approvals set to
  `off`.
- Keeps provider credentials in Hermes and conversation history in Hermes SessionDB.

## Run and verify

Run in the foreground while developing:

```sh
cd /Users/vbitzx/SS/vstart2
npm run agent:bridge
```

Exercise the deterministic fake gateway and the focused security tests:

```sh
npm run test:agent-bridge
```

The tests use a deterministic fake gateway. `npm run agent:spike` probes the installed
Hermes runtime, can create real Hermes sessions, and should be used deliberately. Run
`npm run agent:spike -- --help` for provider/model and safe-skip options.

After the installed bridge is running, exercise the complete HTTP boundary with an
authenticated Hermes model:

```sh
npm run agent:bridge:smoke -- --provider PROVIDER_SLUG --model MODEL_ID
```

The live smoke creates its own mode-`0600` marker under `/tmp`, verifies that a destructive
delete remains paused, sends `Allow once`, verifies completion, and removes the marker.

## Optional launchd service

Installation is explicit and independent of Docker:

```sh
npm run agent:bridge:manage -- install
npm run agent:bridge:manage -- status
npm run agent:bridge:manage -- logs
npm run agent:bridge:manage -- restart
npm run agent:bridge:manage -- uninstall
```

The service is not installed automatically by `stack.sh`. Its plist is written with mode
`0600` to `~/Library/LaunchAgents/com.vstart.agent-bridge.plist`; logs go to
`~/Library/Logs/VStart2/` and never intentionally contain prompts, model responses, tool
output, credentials, or secrets.

If V Start reports **Safety lock active**, enable a manual/approval-gated mode in Hermes
itself and restart the bridge. V Start deliberately does not edit Hermes' global approval
policy.

## Ownership

PostgreSQL stores Agent Mode settings, workspace preferences, and canonical Hermes session
links. Hermes SessionDB stores messages and tool history. The browser stores only drafts,
streaming fragments, and the bridge nonce in memory.
