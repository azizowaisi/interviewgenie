# Interview Genie – Desktop (Electron)

## Run the app

```bash
npm install
npm start
```

Backend must be running (e.g. `docker compose --profile ollama up -d` from the repo root).

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
