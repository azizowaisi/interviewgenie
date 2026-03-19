# Interview Genie – Desktop (Electron)

## Run the app

```bash
npm install
npm start
```

Backend must be running (e.g. `docker compose --profile ollama up -d` from the repo root).

### Point the app at a remote server (e.g. k8s + HTTPS)

The desktop app defaults to `http://127.0.0.1:8001` (API) and `ws://127.0.0.1:8000/ws/audio` (audio). If nothing is listening locally you’ll see `ECONNREFUSED 127.0.0.1:8001`.

Set these **environment variables** when starting Electron (same values are injected into the UI):

| Variable | Example |
|----------|---------|
| `INTERVIEWGENIE_API_BASE` | `https://interviewgenie.teckiz.com` |
| `INTERVIEWGENIE_AUDIO_BASE` | `https://interviewgenie.teckiz.com` |
| `INTERVIEWGENIE_WS_URL` | `wss://interviewgenie.teckiz.com/ws/audio` |

```bash
export INTERVIEWGENIE_API_BASE='https://interviewgenie.teckiz.com'
export INTERVIEWGENIE_AUDIO_BASE='https://interviewgenie.teckiz.com'
export INTERVIEWGENIE_WS_URL='wss://interviewgenie.teckiz.com/ws/audio'
npm start
```

The main process uses Node’s `https` module for `https://` URLs automatically.

## If the app fails with `ipcMain` / "Cannot read properties of undefined"

Some setups see `require('electron')` return the binary path instead of the Electron API, so `ipcMain` is undefined.

**Workarounds:**

1. **Packaged app** – Build and run the built app; the packaged main process may resolve `electron` correctly:
   ```bash
   npm run dist
   # Then open the built app (e.g. dist/mac/Interview Genie.app on macOS)
   ```

2. **Global Electron** – Use a globally installed Electron so the main process does not load the local `node_modules/electron`:
   ```bash
   npm install -g electron
   # Temporarily rename so the main process doesn’t load the npm package
   mv node_modules/electron node_modules/electron.bak
   electron .
   # Restore for other commands
   mv node_modules/electron.bak node_modules/electron
   ```

3. **Different Node/Electron** – Try Node 20 LTS and/or another Electron version (e.g. `"electron": "27.3.0"` in `package.json`, then `npm install` and `npm start`).

## Scripts

- `npm start` – Run the app (Electron + local backend URL).
- `npm run pack` – Build without installer.
- `npm run dist` – Build installers (DMG on macOS, etc.).
