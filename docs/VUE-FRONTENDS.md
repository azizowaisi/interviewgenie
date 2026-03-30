# Vue.js frontends

Interview Genie uses **Vue 3 + Vite** for browser UIs.

## API service (`backend/api-service/frontend/`)

- **Landing** (`/`) — `LandingView.vue`
- **Workspace** (`/app`) — `WorkspaceView.vue` mounts the existing interview UI:
  - Template HTML: `src/assets/workspace-body.html` (extracted from the former `app.html`)
  - Logic: `static/workspace.js` (extracted from `app.html`; loaded at runtime)
  - Styles: `static/workspace.css`
  - Browser API shim: `static/web-bridge.js` (unchanged)

Build output: `backend/api-service/static/dist/` (`index.html` + `assets/*`). FastAPI serves `index.html` for `/` and `/app` and mounts `/assets` for Vite chunks.

```bash
cd backend/api-service/frontend
npm install
npm run dev    # proxy to API on :8001
npm run build  # writes to ../static/dist
```

## Monitoring admin (`backend/monitoring-service/frontend/`)

- **Shell**: `MonitoringApp.vue` renders admin markup from `src/shell.html` (raw HTML) and runs `src/monitorLogic.js` (former `app.js`) after mount.

Build output: `backend/monitoring-service/static/` (`index.html` + `assets/*`). The monitoring FastAPI app mounts `/assets` for hashed JS/CSS.

```bash
cd backend/monitoring-service/frontend
npm install
npm run dev    # proxy /api to :3001
npm run build  # overwrites ../static (do not mix with manual files there)
```

## Docker

Both service `Dockerfile`s run `npm install` + `npm run build` in a Node stage, then copy artifacts into the Python image. No Node runtime in the final container.

## Electron

Desktop is out of scope for this repository now. The browser workspace still uses `web-bridge.js` + `workspace.js`.
