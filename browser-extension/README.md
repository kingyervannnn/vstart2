# V Start Multi-Tool browser extension

This is the isolated Chromium companion for V Start 2. It provides iframe assistance and a quick shortcut capture popup without embedding privileged browser APIs into the start page.

## Install for local development

1. Open `vivaldi://extensions`, `chrome://extensions`, or `edge://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this `browser-extension` directory.
5. Reload V Start at `http://localhost:3000` or `http://127.0.0.1:3000`.

Reload the unpacked extension from the extensions page after changing its source files.

## Add the current page

Click the extension button from any normal HTTP or HTTPS page. The popup pre-fills the
active tab's title and URL, then lets you choose a V Start workspace or pin the shortcut
across every workspace. With two workspaces the option is labeled **Pin to both
workspaces**.

Workspace selection uses the following order:

1. Best-effort Vivaldi workspace metadata, when the browser exposes a value matching a
   V Start workspace ID, slug, or name.
2. The workspace URL when the active tab is V Start itself.
3. V Start's database-backed last active workspace.
4. The first workspace, with the selector available for manual correction.

Vivaldi does not currently document a workspace identifier in the Chromium extension
API, so the database-backed V Start selection is the normal automatic fallback.

## Iframe-assist boundary

- The extension activates only from the two local V Start origins on port 3000.
- Each rule is limited to one destination hostname and `sub_frame` responses.
- Rules use the session-rule API, are removed when the frame closes, and expire after ten minutes as a backstop.
- Shortcut capture uses temporary `activeTab` access only after the extension button is
  clicked. It requests no cookie, history, persistent tab-content, or credential access.

Iframe assistance removes `X-Frame-Options` and CSP frame restrictions from the selected subframe response. It cannot repair sites that depend on third-party cookie behavior, block scripted frame use, or require a top-level browser context; the V Start toolbar always retains an external-tab option.
