const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const tls = require('tls');
const crypto = require('crypto');
const WebSocket = require('ws');

/**
 * Default backend: production (k8s). Override for local Docker:
 *   INTERVIEWGENIE_API_BASE=http://127.0.0.1:8001 etc.
 */
/** FastAPI is mounted at /api/svc on the public host (see k8s/ingress/ingressroute.yaml). */
const PRODUCTION_API_BASE = 'https://interviewgenie.teckiz.com/api/svc';
/** Audio HTTP (/mock/*, /health) uses /api/audio (strip prefix → audio-service). */
const PRODUCTION_AUDIO_BASE = 'https://interviewgenie.teckiz.com/api/audio';
const PRODUCTION_WS_URL = 'wss://interviewgenie.teckiz.com/ws/audio';

const DEFAULT_API_BASE = process.env.INTERVIEWGENIE_API_BASE || PRODUCTION_API_BASE;
const DEFAULT_AUDIO_BASE = process.env.INTERVIEWGENIE_AUDIO_BASE || PRODUCTION_AUDIO_BASE;

/** Trust all TLS (debug only). Set INTERVIEWGENIE_TLS_INSECURE=1 */
function tlsInsecure() {
  const v = process.env.INTERVIEWGENIE_TLS_INSECURE;
  return v === '1' || String(v).toLowerCase() === 'true';
}

/** When set, do not auto-skip cert verify for production host (use after Let’s Encrypt is live). */
function tlsStrict() {
  return process.env.INTERVIEWGENIE_TLS_STRICT === '1';
}

/**
 * Hostnames where we skip TLS verify (Traefik default cert until ACME works).
 * Override: INTERVIEWGENIE_TLS_RELAX_HOSTS=host1.com,host2.com
 * Disable list: INTERVIEWGENIE_TLS_STRICT=1
 */
function relaxTlsHostnameSet() {
  if (tlsStrict()) return new Set();
  const raw = process.env.INTERVIEWGENIE_TLS_RELAX_HOSTS;
  if (raw !== undefined && String(raw).trim() === '') return new Set();
  if (raw) {
    return new Set(
      String(raw)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }
  try {
    return new Set([new URL(PRODUCTION_API_BASE).hostname]);
  } catch {
    return new Set(['interviewgenie.teckiz.com']);
  }
}

const RELAX_TLS_HOSTS = relaxTlsHostnameSet();

let _globalBypassAgent;
const _bypassAgentByHost = new Map();
let _extraCaAgent;

function getHttpsAgentForUrl(fullUrlString) {
  if (tlsInsecure()) {
    if (!_globalBypassAgent) _globalBypassAgent = new https.Agent({ rejectUnauthorized: false });
    return _globalBypassAgent;
  }
  try {
    const u = new URL(fullUrlString);
    const isTls = u.protocol === 'https:' || u.protocol === 'wss:';
    if (isTls && RELAX_TLS_HOSTS.has(u.hostname)) {
      let ag = _bypassAgentByHost.get(u.hostname);
      if (!ag) {
        ag = new https.Agent({ rejectUnauthorized: false });
        _bypassAgentByHost.set(u.hostname, ag);
      }
      return ag;
    }
  } catch (_) {}

  const caPath = process.env.INTERVIEWGENIE_EXTRA_CA_CERTS;
  if (caPath && fs.existsSync(caPath)) {
    try {
      if (!_extraCaAgent) {
        const extra = fs.readFileSync(caPath, 'utf8');
        _extraCaAgent = new https.Agent({ ca: [...tls.rootCertificates, extra] });
      }
      return _extraCaAgent;
    } catch (_) {
      return null;
    }
  }
  return null;
}

function webSocketConnectOptions(wsUrlString) {
  const o = { handshakeTimeout: 10000 };
  const ag = getHttpsAgentForUrl(wsUrlString);
  if (ag) o.agent = ag;
  return o;
}

function httpModuleForUrlString(urlString) {
  try {
    return new URL(urlString).protocol === 'https:' ? https : http;
  } catch {
    return http;
  }
}

/** hostname, port, path (incl. query) for Node http/https.request */
function requestOptionsFromUrl(fullUrlString, extra = {}) {
  const url = new URL(fullUrlString);
  const isHttps = url.protocol === 'https:';
  let port = url.port;
  if (!port) {
    if (isHttps) port = '443';
    else {
      const h = url.hostname;
      port = h === 'localhost' || h === '127.0.0.1' ? '8001' : '80';
    }
  }
  const base = {
    hostname: url.hostname,
    port,
    path: url.pathname + (url.search || ''),
    ...extra,
  };
  if (isHttps) {
    const ag = getHttpsAgentForUrl(fullUrlString);
    if (ag) return { ...base, agent: ag };
  }
  return base;
}

const { app, BrowserWindow, session, ipcMain, shell } = require('electron');

const APP_VERSION = require('./package.json').version;

const APP_DIR = __dirname;
const PORT_MIN = 9080;
const PORT_MAX = 9095;
const SEGMENT_TIMEOUT_MS = 300000; // 5 min (STT + LLM + formatter; first Ollama/Whisper load can be very slow)
const LOCAL_AUTH_CALLBACK_DEFAULT = 'http://127.0.0.1:9090/auth/callback';

let server = null;
let serverPort = null;
let authState = { user: null, tokens: null };

function envOrEmpty(name) {
  const v = process.env[name];
  return v ? String(v).trim() : '';
}

function semverCore(versionStr) {
  const s = String(versionStr || '')
    .replace(/^v/i, '')
    .split('-')[0]
    .split('+')[0];
  return s.split('.').map((p) => parseInt(p, 10) || 0);
}

/** @returns {-1|0|1} */
function compareSemver(a, b) {
  const pa = semverCore(a);
  const pb = semverCore(b);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i += 1) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da < db) return -1;
    if (da > db) return 1;
  }
  return 0;
}

function desktopUpdateManifestUrl() {
  const explicit = envOrEmpty('INTERVIEWGENIE_UPDATE_MANIFEST_URL');
  if (explicit) return explicit;
  const apiBase = process.env.INTERVIEWGENIE_API_BASE || PRODUCTION_API_BASE;
  try {
    const u = new URL(apiBase);
    return `${u.protocol}//${u.host}/desktop-latest.json`;
  } catch (_) {
    return '';
  }
}

function fetchGetJson(urlString, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const opts = requestOptionsFromUrl(urlString, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const client = httpModuleForUrlString(urlString);
    const req = client.request(opts, (res) => {
      let chunks = '';
      res.on('data', (c) => {
        chunks += c;
      });
      res.on('end', () => {
        try {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          resolve(JSON.parse(chunks || '{}'));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error('Update check timeout'));
    });
    req.end();
  });
}

function readDismissedDesktopUpdate() {
  try {
    const p = path.join(app.getPath('userData'), 'dismissed-desktop-update.json');
    if (!fs.existsSync(p)) return '';
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return j && j.version ? String(j.version) : '';
  } catch (_) {
    return '';
  }
}

function writeDismissedDesktopUpdate(version) {
  try {
    const p = path.join(app.getPath('userData'), 'dismissed-desktop-update.json');
    fs.writeFileSync(p, JSON.stringify({ version }), 'utf8');
  } catch (_) {}
}

async function checkForDesktopUpdate(win) {
  if (!win || win.isDestroyed()) return;
  const url = desktopUpdateManifestUrl();
  if (!url) return;
  let manifest;
  try {
    manifest = await fetchGetJson(url);
  } catch (_) {
    return;
  }
  if (!manifest || typeof manifest.version !== 'string') return;
  const latest = manifest.version.trim();
  if (!latest) return;
  if (compareSemver(APP_VERSION, latest) >= 0) return;

  const minV = typeof manifest.minVersion === 'string' ? manifest.minVersion.trim() : '';
  const mandatory = Boolean(minV && compareSemver(APP_VERSION, minV) < 0);
  if (!mandatory && readDismissedDesktopUpdate() === latest) return;

  const payload = {
    currentVersion: APP_VERSION,
    latestVersion: latest,
    downloadPage: typeof manifest.downloadPage === 'string' ? manifest.downloadPage : '',
    message: typeof manifest.message === 'string' ? manifest.message : '',
    mandatory,
  };
  try {
    if (win.webContents && !win.isDestroyed()) {
      win.webContents.send('desktop-update-available', payload);
    }
  } catch (_) {}
}

function scheduleDesktopUpdateCheck(win) {
  setTimeout(() => {
    checkForDesktopUpdate(win).catch(() => {});
  }, 2500);
}

function auth0IssuerBase() {
  const explicit = envOrEmpty('INTERVIEWGENIE_AUTH0_ISSUER_BASE_URL') || envOrEmpty('AUTH0_ISSUER_BASE_URL');
  if (explicit) return explicit.replace(/\/$/, '');
  const d = envOrEmpty('INTERVIEWGENIE_AUTH0_DOMAIN') || envOrEmpty('AUTH0_DOMAIN');
  if (!d) return '';
  const domain = d.startsWith('http://') || d.startsWith('https://') ? d : `https://${d}`;
  return domain.replace(/\/$/, '');
}

function auth0ClientId() {
  return envOrEmpty('INTERVIEWGENIE_AUTH0_CLIENT_ID') || envOrEmpty('AUTH0_CLIENT_ID');
}

function auth0Audience() {
  return envOrEmpty('INTERVIEWGENIE_AUTH0_AUDIENCE') || envOrEmpty('AUTH0_AUDIENCE');
}

function auth0CallbackUrl() {
  const explicit = envOrEmpty('INTERVIEWGENIE_AUTH0_CALLBACK_URL');
  if (explicit) return explicit;
  if (String(process.env.NODE_ENV || '').toLowerCase() === 'production') return '';
  return LOCAL_AUTH_CALLBACK_DEFAULT;
}

function authStatePath() {
  return path.join(app.getPath('userData'), 'auth-session.json');
}

function loadAuthState() {
  try {
    const p = authStatePath();
    if (!fs.existsSync(p)) return;
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    authState = {
      user: parsed && parsed.user ? parsed.user : null,
      tokens: parsed && parsed.tokens ? parsed.tokens : null,
    };
  } catch (_) {}
}

function persistAuthState() {
  try {
    fs.writeFileSync(authStatePath(), JSON.stringify(authState), 'utf8');
  } catch (_) {}
}

function clearAuthState() {
  authState = { user: null, tokens: null };
  try {
    const p = authStatePath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (_) {}
}

function decodeJwtPayload(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    return JSON.parse(Buffer.from(b64 + pad, 'base64').toString('utf8'));
  } catch (_) {
    return null;
  }
}

function currentUserId() {
  return (authState.user && authState.user.sub) || envOrEmpty('INTERVIEWGENIE_USER_ID') || 'default';
}

function authHeaders(extra = {}) {
  const h = { ...extra, 'X-User-Id': currentUserId() };
  if (authState.tokens && authState.tokens.access_token) {
    h.Authorization = `Bearer ${authState.tokens.access_token}`;
  }
  return h;
}

function pkceVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function pkceChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function waitForAuthCode(redirectUrl, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    let timer;
    let callbackServer;
    try {
      const u = new URL(redirectUrl);
      if (u.protocol !== 'http:' || (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost')) {
        reject(new Error('Auth callback URL must be local http://127.0.0.1 or http://localhost'));
        return;
      }
      callbackServer = http.createServer((req, res) => {
        try {
          const reqUrl = new URL(req.url, `${u.protocol}//${u.host}`);
          if (reqUrl.pathname !== u.pathname) {
            res.writeHead(404);
            res.end('Not found');
            return;
          }
          const code = reqUrl.searchParams.get('code');
          const state = reqUrl.searchParams.get('state');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<html><body style="font-family:sans-serif;padding:24px;">Login complete. You can close this tab.</body></html>');
          clearTimeout(timer);
          callbackServer.close(() => resolve({ code, state }));
        } catch (err) {
          clearTimeout(timer);
          try { callbackServer.close(() => reject(err)); } catch (_) { reject(err); }
        }
      });
      callbackServer.listen(Number(u.port || 80), u.hostname);
      timer = setTimeout(() => {
        try { callbackServer.close(); } catch (_) {}
        reject(new Error('Timed out waiting for Auth0 callback.'));
      }, timeoutMs);
    } catch (e) {
      reject(e);
    }
  });
}

async function exchangeAuthCode({ issuer, clientId, code, verifier, redirectUri }) {
  const tokenUrl = `${issuer}/oauth/token`;
  const body = JSON.stringify({
    grant_type: 'authorization_code',
    client_id: clientId,
    code,
    code_verifier: verifier,
    redirect_uri: redirectUri,
  });
  return await new Promise((resolve, reject) => {
    const opts = requestOptionsFromUrl(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    });
    const client = httpModuleForUrlString(tokenUrl);
    const req = client.request(opts, (res) => {
      let chunks = '';
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(chunks || '{}');
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(parsed.error_description || parsed.error || `Token exchange failed (${res.statusCode})`));
            return;
          }
          resolve(parsed);
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Token exchange timeout'));
    });
    req.write(body);
    req.end();
  });
}

// Real-time session: one WebSocket, multiple question rounds
let audioSession = null;

function createWindow(port) {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  win.loadURL(`http://127.0.0.1:${port}`);
  win.webContents.on('did-finish-load', () => {
    scheduleDesktopUpdateCheck(win);
  });
}

function startServer() {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      if (port > PORT_MAX) {
        reject(new Error('No available port for app server'));
        return;
      }
      server = http.createServer((req, res) => {
        const file = path.join(APP_DIR, 'index-standalone.html');
        fs.readFile(file, (err, data) => {
          if (err) {
            res.writeHead(500);
            res.end('Error loading app');
            return;
          }
          const backendCfg = JSON.stringify({
            apiBase: process.env.INTERVIEWGENIE_API_BASE || PRODUCTION_API_BASE,
            audioBase: process.env.INTERVIEWGENIE_AUDIO_BASE || PRODUCTION_AUDIO_BASE,
            wsUrl: process.env.INTERVIEWGENIE_WS_URL || PRODUCTION_WS_URL,
          });
          let html = data.toString('utf8');
          html = html.replace(
            /<script type="application\/json" id="interviewgenie-backend-config">[\s\S]*?<\/script>/,
            `<script type="application/json" id="interviewgenie-backend-config">${backendCfg}</script>`,
          );
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(html);
        });
      });
      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') tryPort(port + 1);
        else reject(err);
      });
      server.listen(port, '127.0.0.1', () => {
        serverPort = port;
        resolve(port);
      });
    };
    tryPort(PORT_MIN);
  });
}

ipcMain.handle('send-audio', async (event, url, audioBytes) => {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(audioBytes);
    const ws = new WebSocket(url, webSocketConnectOptions(url));
    let resolved = false;
    const TIMEOUT_MS = 90000; // 90s for one-shot flow (LLM ~45s)
    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      ws.close();
      reject(new Error('Timeout after 5 minutes. Start the backend with: docker compose --profile ollama up -d'));
    }, TIMEOUT_MS);

    function done(json) {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      try { ws.close(); } catch (_) {}
      resolve(json);
    }

    ws.on('open', () => {
      ws.send(buf);
      ws.send(JSON.stringify({ done: true }));
    });

    ws.on('message', (data) => {
      try {
        const text = (typeof data === 'string') ? data : data.toString();
        const json = JSON.parse(text);
        if (json.status && event.sender) {
          event.sender.send('audio-status', json.status);
          return;
        }
        if (json.error || json.situation !== undefined || json.result !== undefined) {
          done(json);
        }
      } catch (_) {}
    });

    ws.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(err);
      }
    });

    ws.on('close', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(new Error('Server closed the connection. Is the backend running? Run: docker compose --profile ollama up -d'));
      }
    });
  });
});

function endAudioSession() {
  if (!audioSession) return;
  const { ws, pending } = audioSession;
  audioSession = null;
  try { ws.close(); } catch (_) {}
  const result = { error: 'Session ended' };
  pending.forEach((entry) => {
    try {
      clearTimeout(entry.timeout);
      entry.resolve(result);
    } catch (_) {}
  });
}

ipcMain.handle('start-audio-session', async (event, url, cvId, topicId) => {
  if (audioSession) {
    endAudioSession();
  }
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, webSocketConnectOptions(url));
    const pending = [];
    let opened = false;
    audioSession = { ws, pending, sender: event.sender };

    ws.on('open', () => {
      opened = true;
      const msg = { user_id: currentUserId() };
      if (cvId && String(cvId).trim()) msg.cv_id = String(cvId).trim();
      if (topicId && String(topicId).trim()) msg.topic_id = String(topicId).trim();
      try { ws.send(JSON.stringify(msg)); } catch (_) {}
      resolve({ ok: true });
    });

    ws.on('message', (data) => {
      try {
        const text = (typeof data === 'string') ? data : data.toString();
        const json = JSON.parse(text);
        const sender = audioSession && audioSession.sender;
        if (json.status && sender) {
          sender.send('audio-status', json.status);
          return;
        }
        if (json.transcript && sender) {
          sender.send('audio-transcript', json.transcript);
          return;
        }
        if (json.answer_chunk && sender) {
          sender.send('audio-answer-chunk', json.answer_chunk);
          return;
        }
        if (json.answer_done && json.situation !== undefined) {
          const next = pending.shift();
          if (next) {
            clearTimeout(next.timeout);
            next.resolve({ situation: json.situation, task: json.task, action: json.action, result: json.result });
          }
          return;
        }
        if (json.answer_done && json.error) {
          const next = pending.shift();
          if (next) {
            clearTimeout(next.timeout);
            next.resolve({ error: json.error });
          }
          return;
        }
        if (json.answer_done && json.answer_transcript !== undefined) {
          const next = pending.shift();
          if (next) {
            clearTimeout(next.timeout);
            next.resolve({ answer_transcript: json.answer_transcript, question: json.question });
          }
          return;
        }
        if (json.error || json.situation !== undefined || json.result !== undefined) {
          const next = pending.shift();
          if (next) {
            clearTimeout(next.timeout);
            next.resolve(json);
          }
        }
      } catch (_) {}
    });

    ws.on('error', (err) => {
      if (!opened) reject(err);
      if (audioSession && audioSession.ws === ws) endAudioSession();
    });

    ws.on('close', () => {
      if (audioSession && audioSession.ws === ws) {
        audioSession = null;
        pending.forEach((entry) => {
          try {
            clearTimeout(entry.timeout);
            entry.resolve({ error: 'Connection closed' });
          } catch (_) {}
        });
      }
    });
  });
});

ipcMain.handle('send-audio-segment', async (event, audioBytes) => {
  try {
    if (!audioSession || audioSession.ws.readyState !== WebSocket.OPEN) {
      return { error: 'No active session. Click Start recording first.' };
    }
    const { ws, pending } = audioSession;
    const buf = Buffer.from(audioBytes);
    return await new Promise((resolve, reject) => {
      const entry = { resolve, reject, timeout: null };
      entry.timeout = setTimeout(() => {
        const i = pending.indexOf(entry);
        if (i !== -1) pending.splice(i, 1);
        resolve({ error: 'Backend took too long. Check that Whisper and Ollama are running (docker compose ps). Try again.' });
      }, SEGMENT_TIMEOUT_MS);
      pending.push(entry);

      ws.send(JSON.stringify({ chunk: true }));
      ws.send(buf);
      ws.send(JSON.stringify({ process: true }));
    });
  } catch (err) {
    return { error: err && err.message ? err.message : 'No active session. Click Start recording first.' };
  }
});

ipcMain.handle('send-audio-chunk', async (event, audioBytes) => {
  if (!audioSession || audioSession.ws.readyState !== WebSocket.OPEN) return;
  const buf = Buffer.from(audioBytes);
  // Send raw bytes only so backend appends to buffer for live transcript (no replace)
  audioSession.ws.send(buf);
});

ipcMain.handle('send-mock-question', (event, question) => {
  if (!audioSession || audioSession.ws.readyState !== WebSocket.OPEN) return;
  try {
    audioSession.ws.send(JSON.stringify({ mock_question: question || '' }));
  } catch (_) {}
});

ipcMain.handle('end-audio-session', () => {
  endAudioSession();
});

ipcMain.handle('send-text-question', async (event, url, text, cvId, topicId) => {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, webSocketConnectOptions(url));
    const sender = event.sender;
    const TIMEOUT_MS = 120000;
    let resolved = false;
    const timeout = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      try { ws.close(); } catch (_) {}
      resolve({ error: 'Timeout waiting for answer. Try again.' });
    }, TIMEOUT_MS);

    function done(json) {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      try { ws.close(); } catch (_) {}
      if (json.error) resolve({ error: json.error });
      else resolve({ situation: json.situation, task: json.task, action: json.action, result: json.result });
    }

    ws.on('open', () => {
      const sessionMsg = { user_id: currentUserId() };
      if (cvId && String(cvId).trim()) sessionMsg.cv_id = String(cvId).trim();
      if (topicId && String(topicId).trim()) sessionMsg.topic_id = String(topicId).trim();
      ws.send(JSON.stringify(sessionMsg));
      ws.send(JSON.stringify({ text: String(text || '').trim() }));
    });

    ws.on('message', (data) => {
      try {
        const raw = (typeof data === 'string') ? data : data.toString();
        const json = JSON.parse(raw);
        if (json.status && sender) sender.send('audio-status', json.status);
        if (json.transcript && sender) sender.send('audio-transcript', json.transcript);
        if (json.answer_chunk && sender) sender.send('audio-answer-chunk', json.answer_chunk);
        if (json.answer_done && (json.situation !== undefined || json.error)) done(json);
        if (json.error && !json.answer_done) done(json);
      } catch (_) {}
    });

    ws.on('error', () => {
      if (!resolved)
        done({
          error:
            'Connection failed. Check network and that the server is up (default: wss://interviewgenie.teckiz.com/ws/audio). For local backend set INTERVIEWGENIE_WS_URL=ws://127.0.0.1:8000/ws/audio',
        });
    });
    ws.on('close', () => {
      if (!resolved) done({ error: 'Connection closed' });
    });
  });
});

// Fetch Q&A history from API (no CORS in renderer)
ipcMain.handle('save-history', async (_event, apiBase, question, answer, topicId, source, feedback) => {
  const base = (apiBase || DEFAULT_API_BASE).replace(/\/$/, '');
  const body = {
    question: question || '',
    answer: answer || '',
    topic_id: topicId || undefined,
  };
  if (source === 'mock' || source === 'live') body.source = source;
  if (feedback !== undefined && feedback !== null) body.feedback = String(feedback);
  return httpPostJson(base, '/history', body);
});

ipcMain.handle('get-mock-answer-feedback', async (_event, audioBase, question, answer) => {
  const base = (audioBase || DEFAULT_AUDIO_BASE).replace(/\/$/, '');
  return httpPostJson(base, '/mock/analyze', { question: question || '', answer: answer || '' }, {}, 120000);
});

ipcMain.handle('save-mock-feedback', async (_event, apiBase, entryId, feedback) => {
  const base = (apiBase || DEFAULT_API_BASE).replace(/\/$/, '');
  return httpPatchJson(base, '/history/' + encodeURIComponent(entryId), { feedback: feedback || '' });
});

ipcMain.handle('get-history', async (_event, apiBase, limit, topicId) => {
  const base = (apiBase || DEFAULT_API_BASE).replace(/\/$/, '');
  let url = `${base}/history?limit=${Math.min(Number(limit) || 50, 100)}`;
  if (topicId) url += `&topic_id=${encodeURIComponent(topicId)}`;
  return new Promise((resolve) => {
    const opts = requestOptionsFromUrl(url, {
      method: 'GET',
      headers: authHeaders(),
    });
    const client = httpModuleForUrlString(url);
    const req = client.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            resolve({ error: res.statusCode, body: data });
            return;
          }
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ error: 'parse', message: e.message });
        }
      });
    });
    req.on('error', (e) => resolve({ error: 'network', message: e.message }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.end();
  });
});

ipcMain.handle('get-cv-list', async (_event, apiBase) => {
  const base = (apiBase || DEFAULT_API_BASE).replace(/\/$/, '');
  const url = `${base}/cv`;
  return new Promise((resolve) => {
    const opts = requestOptionsFromUrl(url, {
      method: 'GET',
      headers: authHeaders(),
    });
    const client = httpModuleForUrlString(url);
    const req = client.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            resolve({ error: res.statusCode, body: data });
            return;
          }
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ error: 'parse', message: e.message });
        }
      });
    });
    req.on('error', (e) => resolve({ error: 'network', message: e.message }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.end();
  });
});

ipcMain.handle('get-cv', async (_event, apiBase, cvId) => {
  const base = (apiBase || DEFAULT_API_BASE).replace(/\/$/, '');
  return httpGetJson(base, `/cv/${encodeURIComponent(cvId)}`);
});

function httpPostJson(apiBase, path, body, headers = {}, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const fullUrl = apiBase + path;
    const data = JSON.stringify(body);
    const opts = requestOptionsFromUrl(fullUrl, {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...headers,
      },
    });
    const client = httpModuleForUrlString(fullUrl);
    const req = client.request(opts, (res) => {
      let chunks = '';
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) resolve({ error: res.statusCode, body: chunks });
          else resolve(JSON.parse(chunks));
        } catch (e) {
          resolve({ error: 'parse', message: e.message });
        }
      });
    });
    req.on('error', (e) => resolve({ error: 'network', message: e.message }));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.write(data);
    req.end();
  });
}

function httpPatchJson(apiBase, path, body) {
  return new Promise((resolve) => {
    const fullUrl = apiBase + path;
    const data = JSON.stringify(body);
    const opts = requestOptionsFromUrl(fullUrl, {
      method: 'PATCH',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    });
    const client = httpModuleForUrlString(fullUrl);
    const req = client.request(opts, (res) => {
      let chunks = '';
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) resolve({ error: res.statusCode, body: chunks });
          else resolve(JSON.parse(chunks));
        } catch (e) {
          resolve({ error: 'parse', message: e.message });
        }
      });
    });
    req.on('error', (e) => resolve({ error: 'network', message: e.message }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.write(data);
    req.end();
  });
}

ipcMain.handle('get-topics', async (_event, apiBase) => {
  const base = (apiBase || DEFAULT_API_BASE).replace(/\/$/, '');
  const url = `${base}/topics`;
  return new Promise((resolve) => {
    const opts = requestOptionsFromUrl(url, {
      method: 'GET',
      headers: authHeaders(),
    });
    const client = httpModuleForUrlString(url);
    const req = client.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            resolve({ error: res.statusCode, body: data });
            return;
          }
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ error: 'parse', message: e.message });
        }
      });
    });
    req.on('error', (e) => resolve({ error: 'network', message: e.message }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.end();
  });
});

ipcMain.handle('create-topic', async (_event, apiBase, topic, jobDescription) => {
  const base = (apiBase || DEFAULT_API_BASE).replace(/\/$/, '');
  const requestUrl = base + '/topics';
  const body = { topic: topic || '', job_description: jobDescription || '', interview_type: 'technical', duration_minutes: 30 };
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const opts = requestOptionsFromUrl(requestUrl, {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    });
    const client = httpModuleForUrlString(requestUrl);
    const req = client.request(opts, (res) => {
      let chunks = '';
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) resolve({ error: res.statusCode, body: chunks });
          else resolve(JSON.parse(chunks));
        } catch (e) {
          resolve({ error: 'parse', message: e.message });
        }
      });
    });
    req.on('error', (e) => resolve({ error: 'network', message: e.message }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.write(data);
    req.end();
  });
});

ipcMain.handle('ats-analyze', async (_event, apiBase, cvId, topicId, jobDescriptionRaw) => {
  const base = (apiBase || DEFAULT_API_BASE).replace(/\/$/, '');
  const body = {};
  if (topicId) body.topic_id = topicId;
  if (cvId) body.cv_id = cvId;
  if (jobDescriptionRaw) body.job_description = jobDescriptionRaw;
  return httpPostJson(base, '/ats/analyze', body);
});

ipcMain.handle('get-ats', async (_event, apiBase, topicId) => {
  const base = (apiBase || DEFAULT_API_BASE).replace(/\/$/, '');
  const path = topicId ? `/ats?topic_id=${encodeURIComponent(topicId)}` : '/ats';
  return new Promise((resolve) => {
    const url = base + path;
    const opts = requestOptionsFromUrl(url, {
      method: 'GET',
      headers: authHeaders(),
    });
    const client = httpModuleForUrlString(url);
    const req = client.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            resolve({ error: res.statusCode, body: data });
            return;
          }
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ error: 'parse', message: e.message });
        }
      });
    });
    req.on('error', (e) => resolve({ error: 'network', message: e.message }));
    req.setTimeout(10000, () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.end();
  });
});

ipcMain.handle('upload-cv', async (_event, apiBase, filename, fileBuffer) => {
  const base = (apiBase || DEFAULT_API_BASE).replace(/\/$/, '');
  const buf = Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer);
  const boundary = '----InterviewGenieCV' + Date.now();
  const bodyStart = [
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="file"; filename="${(filename || 'cv.pdf').replace(/"/g, '%22')}"\r\n`,
    'Content-Type: application/octet-stream\r\n\r\n',
  ].join('');
  const bodyEnd = `\r\n--${boundary}--\r\n`;
  const body = Buffer.concat([Buffer.from(bodyStart, 'utf8'), buf, Buffer.from(bodyEnd, 'utf8')]);
  return new Promise((resolve) => {
    const fullUrl = `${base}/cv/upload`;
    const opts = requestOptionsFromUrl(fullUrl, {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    });
    const client = httpModuleForUrlString(fullUrl);
    const req = client.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            resolve({ error: res.statusCode, body: data });
            return;
          }
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ error: 'parse', message: e.message });
        }
      });
    });
    req.on('error', (e) => resolve({ error: 'network', message: e.message }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.write(body);
    req.end();
  });
});

ipcMain.handle('upload-topic-cv', async (_event, apiBase, topicId, filename, fileBuffer) => {
  const base = (apiBase || DEFAULT_API_BASE).replace(/\/$/, '');
  const buf = Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer);
  const boundary = '----InterviewGenieTopicCV' + Date.now();
  const bodyStart = [
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="file"; filename="${(filename || 'cv.pdf').replace(/"/g, '%22')}"\r\n`,
    'Content-Type: application/octet-stream\r\n\r\n',
  ].join('');
  const bodyEnd = `\r\n--${boundary}--\r\n`;
  const body = Buffer.concat([Buffer.from(bodyStart, 'utf8'), buf, Buffer.from(bodyEnd, 'utf8')]);
  return new Promise((resolve) => {
    const fullUrl = `${base}/topics/${encodeURIComponent(topicId)}/cv`;
    const opts = requestOptionsFromUrl(fullUrl, {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
    });
    const client = httpModuleForUrlString(fullUrl);
    const req = client.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            resolve({ error: res.statusCode, body: data });
            return;
          }
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ error: 'parse', message: e.message });
        }
      });
    });
    req.on('error', (e) => resolve({ error: 'network', message: e.message }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.write(body);
    req.end();
  });
});

function httpGetJson(apiBase, path, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const fullUrl = apiBase + path;
    const opts = requestOptionsFromUrl(fullUrl, {
      method: 'GET',
      headers: authHeaders(),
    });
    const client = httpModuleForUrlString(fullUrl);
    const req = client.request(opts, (res) => {
      let chunks = '';
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) resolve({ error: res.statusCode, body: chunks });
          else resolve(JSON.parse(chunks));
        } catch (e) {
          resolve({ error: 'parse', message: e.message });
        }
      });
    });
    req.on('error', (e) => resolve({ error: 'network', message: e.message }));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.end();
  });
}

ipcMain.handle('update-topic', async (_event, apiBase, topicId, interviewType, durationMinutes) => {
  const base = (apiBase || DEFAULT_API_BASE).replace(/\/$/, '');
  const body = {};
  if (interviewType != null) body.interview_type = interviewType;
  if (durationMinutes != null) body.duration_minutes = durationMinutes;
  return httpPatchJson(base, `/topics/${encodeURIComponent(topicId)}`, body);
});

ipcMain.handle('get-topic-attempts', async (_event, apiBase, topicId) => {
  const base = (apiBase || DEFAULT_API_BASE).replace(/\/$/, '');
  return httpGetJson(base, `/topics/${encodeURIComponent(topicId)}/attempts`);
});

ipcMain.handle('create-attempt', async (_event, apiBase, topicId) => {
  const base = (apiBase || DEFAULT_API_BASE).replace(/\/$/, '');
  return httpPostJson(base, `/topics/${encodeURIComponent(topicId)}/attempts`, {});
});

ipcMain.handle('get-attempt', async (_event, apiBase, attemptId) => {
  const base = (apiBase || DEFAULT_API_BASE).replace(/\/$/, '');
  return httpGetJson(base, `/attempts/${encodeURIComponent(attemptId)}`);
});

ipcMain.handle('add-attempt-question', async (_event, apiBase, attemptId, question, answer, orderIndex) => {
  const base = (apiBase || DEFAULT_API_BASE).replace(/\/$/, '');
  const body = { question: question || '' };
  if (answer != null) body.answer = answer;
  if (orderIndex != null) body.order_index = orderIndex;
  return httpPostJson(base, `/attempts/${encodeURIComponent(attemptId)}/questions`, body);
});

ipcMain.handle('update-attempt-question-answer', async (_event, apiBase, attemptId, questionId, answer) => {
  const base = (apiBase || DEFAULT_API_BASE).replace(/\/$/, '');
  return httpPatchJson(base, `/attempts/${encodeURIComponent(attemptId)}/questions/${encodeURIComponent(questionId)}`, { answer: answer ?? '' });
});

ipcMain.handle('complete-attempt', async (_event, apiBase, attemptId, score, evaluationSummary) => {
  const base = (apiBase || DEFAULT_API_BASE).replace(/\/$/, '');
  return httpPatchJson(base, `/attempts/${encodeURIComponent(attemptId)}/complete`, { score: score ?? 0, evaluation_summary: evaluationSummary ?? '' });
});

ipcMain.handle('generate-questions', async (_event, audioBase, jobDescription, cvText, previousQuestions, interviewType, numQuestions) => {
  const base = (audioBase || DEFAULT_AUDIO_BASE).replace(/\/$/, '');
  return httpPostJson(base, '/mock/generate-questions', {
    job_description: jobDescription || '',
    cv_text: cvText || '',
    previous_questions: Array.isArray(previousQuestions) ? previousQuestions : [],
    interview_type: interviewType || 'technical',
    num_questions: numQuestions || 5,
  }, {}, 120000);
});

ipcMain.handle('evaluate-attempt', async (_event, audioBase, questionsAndAnswers) => {
  const base = (audioBase || DEFAULT_AUDIO_BASE).replace(/\/$/, '');
  return httpPostJson(base, '/mock/evaluate-attempt', {
    questions_and_answers: Array.isArray(questionsAndAnswers) ? questionsAndAnswers.map((qa) => ({ question: qa.question || '', answer: qa.answer || '' })) : [],
  }, {}, 120000);
});

ipcMain.handle('compare-attempts', async (_event, audioBase, attempt1Data, attempt2Data) => {
  const base = (audioBase || DEFAULT_AUDIO_BASE).replace(/\/$/, '');
  const a1 = attempt1Data || {};
  const a2 = attempt2Data || {};
  return httpPostJson(base, '/mock/compare-attempts', {
    attempt_1: {
      score: a1.score,
      evaluation_summary: a1.evaluation_summary || '',
      questions_and_answers: Array.isArray(a1.questions_and_answers) ? a1.questions_and_answers.map((qa) => ({ question: qa.question || '', answer: qa.answer || '' })) : [],
    },
    attempt_2: {
      score: a2.score,
      evaluation_summary: a2.evaluation_summary || '',
      questions_and_answers: Array.isArray(a2.questions_and_answers) ? a2.questions_and_answers.map((qa) => ({ question: qa.question || '', answer: qa.answer || '' })) : [],
    },
  }, {}, 120000);
});

ipcMain.handle('auth-session', async () => {
  return {
    loggedIn: !!(authState.user && authState.user.sub),
    user: authState.user,
  };
});

ipcMain.handle('auth-logout', async () => {
  clearAuthState();
  return { ok: true };
});

ipcMain.handle('auth-login', async () => {
  const issuer = auth0IssuerBase();
  const clientId = auth0ClientId();
  const redirectUri = auth0CallbackUrl();
  if (!issuer || !clientId || !redirectUri) {
    return { error: 'Missing Auth0 config. Set INTERVIEWGENIE_AUTH0_ISSUER_BASE_URL, INTERVIEWGENIE_AUTH0_CLIENT_ID, INTERVIEWGENIE_AUTH0_CALLBACK_URL.' };
  }

  const verifier = pkceVerifier();
  const challenge = pkceChallenge(verifier);
  const state = crypto.randomBytes(16).toString('hex');

  const authUrl = new URL(`${issuer}/authorize`);
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', 'openid profile email');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  const audience = auth0Audience();
  if (audience) authUrl.searchParams.set('audience', audience);

  try {
    const waitForCode = waitForAuthCode(redirectUri);
    await shell.openExternal(authUrl.toString());
    const cb = await waitForCode;
    if (!cb || !cb.code) return { error: 'No authorization code received.' };
    if (cb.state !== state) return { error: 'State mismatch from Auth0 callback.' };
    const tokens = await exchangeAuthCode({
      issuer,
      clientId,
      code: cb.code,
      verifier,
      redirectUri,
    });
    const payload = decodeJwtPayload(tokens.id_token || '');
    const sub = payload && payload.sub ? String(payload.sub) : '';
    if (!sub) return { error: 'Auth0 id_token missing `sub`.' };
    authState = {
      user: { sub, email: payload.email || null, name: payload.name || null },
      tokens,
    };
    persistAuthState();
    return { ok: true, user: authState.user };
  } catch (e) {
    return { error: e && e.message ? e.message : 'Auth login failed' };
  }
});

ipcMain.handle('dismiss-desktop-update', (_event, latestVersion) => {
  if (latestVersion) writeDismissedDesktopUpdate(String(latestVersion));
  return { ok: true };
});

ipcMain.handle('open-external-url', (_event, url) => {
  const s = url ? String(url) : '';
  if (s && /^https?:\/\//i.test(s)) {
    shell.openExternal(s);
    return { ok: true };
  }
  return { ok: false };
});

app.whenReady().then(async () => {
  loadAuthState();
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') callback(true);
    else callback(false);
  });
  const port = await startServer();
  createWindow(port);
});

app.on('window-all-closed', () => {
  if (server) server.close();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && serverPort != null) createWindow(serverPort);
});
