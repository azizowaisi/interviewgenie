"""
STT Service: convert audio to text.
Uses WHISPER_URL if set (e.g. whisper.cpp server), otherwise returns mock for dev.
"""
import os
import subprocess
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, UploadFile
from fastapi.responses import JSONResponse

WHISPER_URL = os.getenv("WHISPER_URL", "")  # e.g. http://whisper-server:8080/inference
WHISPER_CPP_PATH = os.getenv("WHISPER_CPP_PATH", "/usr/local/bin/whisper")  # optional binary
# Use base or small for low latency; avoid large
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "base")  # base | small (path suffix)

app = FastAPI(title="STT Service (Whisper.cpp)", version="0.1.0")


@app.get("/health")
async def health() -> JSONResponse:
    return JSONResponse({"status": "ok"})


async def _transcribe_via_http(audio_bytes: bytes) -> str:
    import httpx
    async with httpx.AsyncClient(timeout=30.0) as client:
        files = {"file": ("audio.wav", audio_bytes, "audio/wav")}
        r = await client.post(f"{WHISPER_URL.rstrip('/')}/inference", files=files)
        r.raise_for_status()
        data = r.json()
        return data.get("text", "").strip()


def _transcribe_via_binary(audio_bytes: bytes) -> str:
    if not Path(WHISPER_CPP_PATH).exists():
        return ""
    model_name = WHISPER_MODEL if WHISPER_MODEL else "base"
    model_path = f"/models/ggml-{model_name}.en.bin"
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        f.write(audio_bytes)
        path = f.name
    try:
        out = subprocess.run(
            [WHISPER_CPP_PATH, "-f", path, "-m", model_path],
            capture_output=True,
            text=True,
            timeout=60,
            cwd=os.path.dirname(path),
        )
        if out.returncode != 0:
            return ""
        return (out.stdout or "").strip()
    finally:
        try:
            os.unlink(path)
        except Exception:
            pass


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)) -> JSONResponse:
    audio_bytes = await file.read()
    if not audio_bytes:
        return JSONResponse({"text": ""})

    text = ""
    if WHISPER_URL:
        try:
            text = await _transcribe_via_http(audio_bytes)
        except Exception:
            pass
    if not text and WHISPER_CPP_PATH and Path(WHISPER_CPP_PATH).exists():
        text = _transcribe_via_binary(audio_bytes)
    if not text:
        # No STT configured (WHISPER_URL unset and no whisper binary). Return empty so the
        # pipeline reports empty_transcription instead of pretending we heard a fixed question.
        pass
    return JSONResponse({"text": text})
