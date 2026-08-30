# V Start Environment Bridge

The Environment Bridge is a narrow loopback service between V Start and approved host-local read protocols. It exposes the room-light capability and read-only Git project status without exposing arbitrary command execution.

## Protocol

- `GET /v1/health`
- `GET /v1/environment`
- `POST /v1/projects/snapshot` with `{ "paths": ["/absolute/project/path"] }`
- `POST /v1/lights/room-light/power` with `{ "on": true }`
- `POST /v1/lights/room-light/state` with `{ "channel": "warm_white", "level": 90 }`

Colors and intensity levels are read from `room-light config --json` on a short cache. Changes to the CLI configuration therefore appear in V Start automatically. Commands are validated against those live capabilities and executed without a shell.

Mission Glance sends its bounded PostgreSQL-backed project path list to the snapshot route. The bridge runs only `git -C <path> branch --show-current`, `status --porcelain=v1 -z`, and `log -1` with fixed argument arrays and a short per-project cache. Missing paths, non-Git folders, and Git failures return `available: false`; Git error output is not exposed.

## Service

```sh
npm run environment:bridge:manage -- install
npm run environment:bridge:manage -- status
```

The launch agent binds only to `127.0.0.1:3140`. V Start proxies it through `/environment-bridge/` so LAN and Tailscale clients use the start page's existing origin.

The launcher defaults to `~/.local/bin/room-light`. Set `VSTART_LIGHT_CLI_PATH` before
installation when the CLI lives elsewhere; the generated LaunchAgent records the
resolved path without committing machine-specific paths to this repository.
Git defaults to `/usr/bin/git`; set `VSTART_GIT_PATH` before installation only when a
different binary is required.
