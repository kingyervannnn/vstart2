# V Start Environment Bridge

The Environment Bridge is a narrow loopback service between V Start and the existing local CLI protocol. It currently exposes the room-light capability and is designed to add future home-lab device kinds without exposing arbitrary command execution.

## Protocol

- `GET /v1/health`
- `GET /v1/environment`
- `POST /v1/lights/room-light/power` with `{ "on": true }`
- `POST /v1/lights/room-light/state` with `{ "channel": "warm_white", "level": 90 }`

Colors and intensity levels are read from `room-light config --json` on a short cache. Changes to the CLI configuration therefore appear in V Start automatically. Commands are validated against those live capabilities and executed without a shell.

## Service

```sh
npm run environment:bridge:manage -- install
npm run environment:bridge:manage -- status
```

The launch agent binds only to `127.0.0.1:3140`. V Start proxies it through `/environment-bridge/` so LAN and Tailscale clients use the start page's existing origin.

The launcher defaults to `~/.local/bin/room-light`. Set `VSTART_LIGHT_CLI_PATH` before
installation when the CLI lives elsewhere; the generated LaunchAgent records the
resolved path without committing machine-specific paths to this repository.
