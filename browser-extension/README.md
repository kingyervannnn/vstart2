# V Start Multi-Tool browser extension

This is the isolated Chromium companion for V Start 2. Its first capability is iframe assistance; future local browser tools can be added without embedding privileged browser APIs into the start page.

## Install for local development

1. Open `vivaldi://extensions`, `chrome://extensions`, or `edge://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this `browser-extension` directory.
5. Reload V Start at `http://localhost:3000` or `http://127.0.0.1:3000`.

## Iframe-assist boundary

- The extension activates only from the two local V Start origins on port 3000.
- Each rule is limited to one destination hostname and `sub_frame` responses.
- Rules use the session-rule API, are removed when the frame closes, and expire after ten minutes as a backstop.
- The extension requests no cookie, history, tab-content, or credential permissions.

Iframe assistance removes `X-Frame-Options` and CSP frame restrictions from the selected subframe response. It cannot repair sites that depend on third-party cookie behavior, block scripted frame use, or require a top-level browser context; the V Start toolbar always retains an external-tab option.
