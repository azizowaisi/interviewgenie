# Web UI (served by api-service)

| File | Role |
|------|------|
| `landing.html` | Marketing home at **`/`** |
| `app.html` | Full interview workspace at **`/app`** (standalone HTML + web tweaks) |
| `web-bridge.js` | Browser `window.electronAPI` using `fetch` + `WebSocket` |

After large changes to the standalone workspace UI, refresh `app.html` accordingly.
