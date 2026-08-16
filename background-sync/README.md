# Background Sync

The optional macOS host synchronizer keeps the Home workspace and the Mac desktop on the
same database-backed imported-folder image. V Start and the helper both derive the image
from the same wall-clock interval and collection order, so opening or closing browser tabs
does not restart the sequence.

The synchronizer is controlled by the database-backed **Sync Home with Mac desktop** toggle
in Settings → Backgrounds → Home. When enabled, Home must have workspace-specific rotation
enabled, use **Imported folder**, and select the database collection whose files still exist
in `~/SS/backgrounds` (or the directory supplied through
`VSTART_BACKGROUND_SYNC_DIRECTORY`). V Start remains the source of truth for the ordinary
rotation toggle, collection, interval, and current asset. Turning Mac sync off does not stop
V Start's own background rotation.

Install the per-user launch agent:

```sh
npm run background:sync:manage -- install
```

Useful commands:

```sh
npm run background:sync:manage -- status
npm run background:sync:manage -- restart
npm run background:sync:manage -- logs
npm run background:sync:manage -- uninstall
```

Installation compiles a small native AppKit helper that applies the selected file to the
active Space on every connected display while retaining macOS's current wallpaper placement
options. macOS does not expose a public API for preserving **Show on all Spaces** when an app
changes wallpaper, so that toggle is replaced by explicit per-display updates. No browser
storage or duplicated schedule state is introduced.
