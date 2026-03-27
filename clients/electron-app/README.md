# Interview Genie – Desktop (Electron)

## Run the app

```bash
npm install
npm start
```

By default the app talks to **production**: FastAPI at `https://interviewgenie.teckiz.com/api/svc`, audio HTTP at `https://interviewgenie.teckiz.com/api/audio`, and `wss://interviewgenie.teckiz.com/ws/audio` (live audio). Run with `npm start` — no env vars needed.

### Use a local backend (Docker)

Point Electron at localhost by setting these when you start:

| Variable | Local example |
|----------|----------------|
| `INTERVIEWGENIE_API_BASE` | `http://127.0.0.1:8001` |
| `INTERVIEWGENIE_AUDIO_BASE` | `http://127.0.0.1:8000` |
| `INTERVIEWGENIE_WS_URL` | `ws://127.0.0.1:8000/ws/audio` |

```bash
export INTERVIEWGENIE_API_BASE='http://127.0.0.1:8001'
export INTERVIEWGENIE_AUDIO_BASE='http://127.0.0.1:8000'
export INTERVIEWGENIE_WS_URL='ws://127.0.0.1:8000/ws/audio'
npm start
```

Backend: `docker compose --profile ollama up -d` from the repo root.

The main process uses Node’s `https` module for `https://` URLs automatically.

## Auth0 desktop login (same identity as website)

Desktop supports Auth0 login and uses the same user identity (`sub`) for all API/WS calls.

Required env vars:

| Variable | Description |
|----------|-------------|
| `INTERVIEWGENIE_AUTH0_ISSUER_BASE_URL` | Auth0 issuer URL (e.g. `https://your-tenant.us.auth0.com`) |
| `INTERVIEWGENIE_AUTH0_CLIENT_ID` | Auth0 application client id |
| `INTERVIEWGENIE_AUTH0_CALLBACK_URL` | Callback URL registered in Auth0 app |

Optional:

| Variable | Description |
|----------|-------------|
| `INTERVIEWGENIE_AUTH0_AUDIENCE` | Audience if your tenant uses API audience |
| `INTERVIEWGENIE_USER_ID` | Fallback user id when not logged in (default: `default`) |

For local testing, callback can be:

```bash
INTERVIEWGENIE_AUTH0_CALLBACK_URL=http://127.0.0.1:9090/auth/callback
```

For production, set `INTERVIEWGENIE_AUTH0_CALLBACK_URL` to your production callback URL (do not use localhost).

### TLS errors (`unable to verify the first certificate`)

Your server may still be on **Traefik’s default self-signed** cert until **Let’s Encrypt** succeeds (see repo `k8s/ingress/ingressroute.yaml` + real ACME email in `k8s/traefik/helmchartconfig.yaml`, port **80** open).

**Built-in behavior:** the Electron **main process** skips TLS verification **only** for the default production hostname (`interviewgenie.teckiz.com`), so the app works with the default Traefik cert. That is **less safe** against network attackers; once you have a real LE cert, enable strict mode:

```bash
export INTERVIEWGENIE_TLS_STRICT=1
npm start
```

**Other overrides:**

| Variable | Effect |
|----------|--------|
| `INTERVIEWGENIE_TLS_INSECURE=1` | Skip verify for **all** HTTPS/WSS URLs |
| `INTERVIEWGENIE_TLS_RELAX_HOSTS` | Comma-separated hostnames to relax (default: production host only) |
| `INTERVIEWGENIE_EXTRA_CA_CERTS` | Path to PEM bundle (corporate CA) |

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
- `npm run dist` – Build installers **for the OS you run the command on** (DMG on macOS, NSIS `.exe` on Windows, AppImage on Linux). You do not get all three from one machine.
- `npm run dist:publish-web` – After `dist`, copy built file(s) into `../../web/public/desktop/` (still only the current OS).

## Windows and Linux installers (all platforms)

To produce **macOS, Windows, and Linux** artifacts together, use GitHub Actions:

1. Repo workflow **Desktop installers** (`.github/workflows/desktop-installers.yml`).
2. Push to `main` (with changes under `clients/electron-app/` or `web/`) or run it manually (**Actions → Desktop installers → Run workflow**).

It builds in parallel on `macos-latest`, `windows-latest`, and `ubuntu-24.04`, then merges:

| OS | Artifact (in `dist/` or download volume) |
|----|--------------------------------------------|
| macOS | `InterviewGenie-macos.dmg` |
| Windows | `InterviewGenie-windows.exe` (NSIS installer) |
| Linux | `InterviewGenie-linux.AppImage` |

Point the website download buttons at your hosted URLs (or use `NEXT_PUBLIC_DESKTOP_DOWNLOAD_*` / JSON). See repo root workflow comments for rsync to a static volume.
