#!/usr/bin/env bash
# Check all InterviewGenie services: health, URLs, ports.
# Usage: ./scripts/check_services.sh   (from repo root)
set -e

COMPOSE_PROJECT="interviewgenie"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()  { echo -e "${GREEN}OK${NC}   $*"; }
fail() { echo -e "${RED}FAIL${NC} $*"; return 1; }
warn() { echo -e "${YELLOW}WARN${NC} $*"; }

echo "=== InterviewGenie service checks ==="
echo ""

# --- Host-exposed services ---
echo "--- Host (localhost) ---"

# Audio service: port 8000
if curl -sf --connect-timeout 3 "http://localhost:8000/health" >/dev/null; then
  ok "audio-service  http://localhost:8000/health  (port 8000)"
else
  fail "audio-service  http://localhost:8000/health  (port 8000)"
fi

# Ollama: port 11434
if curl -sf --connect-timeout 3 "http://localhost:11434/api/tags" >/dev/null 2>&1; then
  ok "ollama         http://localhost:11434  (port 11434, /api/tags)"
elif curl -sf --connect-timeout 3 "http://localhost:11434" >/dev/null 2>&1; then
  ok "ollama         http://localhost:11434  (port 11434, root OK)"
else
  warn "ollama         http://localhost:11434  (port 11434) - not reachable (profile ollama?)"
fi

echo ""
echo "--- Internal services (from audio-service container) ---"

# Internal health checks via Python in audio-service (slim image has no curl)
while IFS= read -r line; do
  if [[ "$line" == OK* ]]; then ok "${line#OK   }"; else fail "${line#FAIL }"; fi
done < <(docker compose exec -T audio-service python3 -c "
import urllib.request
import sys
for name in ['stt-service', 'question-service', 'llm-service', 'formatter-service']:
  url = f'http://{name}:8000/health'
  try:
    urllib.request.urlopen(url, timeout=3)
    print(f'OK   {name}  {url}  (port 8000)')
  except Exception:
    print(f'FAIL {name}  {url}  (port 8000)')
    sys.exit(1)
" 2>/dev/null) || true

echo ""
echo "--- WebSocket (audio-service) ---"
# Quick WebSocket: connect, send WAV + done, expect at least one JSON within 5s
if command -v python3 >/dev/null 2>&1; then
  if python3 -c "
import asyncio, json, struct, sys
try:
  import websockets
except ImportError:
  sys.exit(2)
def wav():
  rate, ch, bps = 16000, 1, 16
  align = ch * (bps // 8)
  size = 1600 * align
  h = b'RIFF' + (36 + size).to_bytes(4,'little') + b'WAVEfmt ' + (16).to_bytes(4,'little') + (1).to_bytes(2,'little') + (ch).to_bytes(2,'little') + (rate).to_bytes(4,'little') + (rate*align).to_bytes(4,'little') + (align).to_bytes(2,'little') + (bps).to_bytes(2,'little') + b'data' + (size).to_bytes(4,'little')
  return h + b'\\x00' * size
async def run():
  async with websockets.connect('ws://localhost:8000/ws/audio', close_timeout=3) as ws:
    await ws.send(wav())
    await ws.send(json.dumps({'done': True}))
    msg = await asyncio.wait_for(ws.recv(), timeout=5.0)
    if isinstance(msg, bytes): return True
    return 'status' in json.loads(msg) or 'error' in json.loads(msg) or 'answer_done' in json.loads(msg)
asyncio.run(run())
" 2>/dev/null; then
    ok "WebSocket ws://localhost:8000/ws/audio  (got response within 5s)"
  else
    code=$?
    if [ "$code" = 2 ]; then
      warn "WebSocket skip (install: pip install websockets)"
    else
      fail "WebSocket ws://localhost:8000/ws/audio  (no response in 5s or error)"
    fi
  fi
else
  warn "WebSocket skip (python3 not found)"
fi

echo ""
echo "=== Done ==="
