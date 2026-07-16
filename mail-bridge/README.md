# V Start Mail Bridge

This loopback-only helper connects the V Start mail widget to the canonical local `mailctl` capability. It runs as the signed-in macOS user so `mailctl` can use its existing account registry and Keychain-backed credentials.

The browser API supports search, reading, Gmail favorites through the `STARRED` label, draft creation, replies, forwarding as a new draft, attachments, draft listing, sending, and moving a message to Gmail Trash. Compose suggestions are derived in memory from recent Sent recipients and Inbox senders, then cached briefly; V Start does not create a separate browser or database address book. Sending and trashing each require a separate explicit confirmation before the bridge invokes the corresponding guarded `mailctl` command. Favorite toggles are explicit UI actions and use the narrow guarded `mailctl star` / `mailctl unstar` commands. Token management, permanent deletion, and arbitrary CLI execution are not exposed.

```sh
npm run mail:bridge:manage -- install
npm run mail:bridge:manage -- status
```

The bridge binds only to `127.0.0.1:3130`. V Start exposes its typed API through the same-origin
`/mail-bridge/` reverse proxy, so LAN and Tailscale clients can use Mail without exposing port 3130.
The proxy supplies the bridge's allowlisted loopback Host and Origin; direct remote requests to the
native bridge remain unavailable.
