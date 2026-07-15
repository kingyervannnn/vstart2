# V Start Mail Bridge

This loopback-only helper connects the V Start mail widget to the canonical local `mailctl` capability. It runs as the signed-in macOS user so `mailctl` can use its existing account registry and Keychain-backed credentials.

The browser API supports search, reading, draft creation, replies, forwarding as a new draft, attachments, draft listing, sending, and moving a message to Gmail Trash. Sending and trashing each require a separate explicit confirmation before the bridge invokes the corresponding guarded `mailctl` command. Token management, permanent deletion, and arbitrary CLI execution are not exposed.

```sh
npm run mail:bridge:manage -- install
npm run mail:bridge:manage -- status
```

The bridge binds only to `127.0.0.1:3130` and accepts browser requests only from V Start on `localhost:3000` or `127.0.0.1:3000`.
