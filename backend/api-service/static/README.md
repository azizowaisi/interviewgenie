# Web UI (served by api-service)

| File | Role |
|------|------|
| `landing.html` | Marketing home at **`/`** |
| `app.html` | Full interview workspace at **`/app`** (copy of Electron `clients/electron-app/index-standalone.html` + web tweaks) |
| `web-bridge.js` | Browser `window.electronAPI` using `fetch` + `WebSocket` |

After large changes to the Electron standalone UI, refresh the web copy:

```bash
cp clients/electron-app/index-standalone.html backend/api-service/static/app.html
# Re-apply: web-bridge script in `<head>`, CSP `connect-src`, same-origin config block, subtitle link to `/`.
```
