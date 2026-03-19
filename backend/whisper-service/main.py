"""
Local speech-to-text using faster-whisper (runs fully offline).
Exposes POST /inference: multipart file (audio) -> {"text": "..."}.
"""
import os
import tempfile
from fastapi import FastAPI, File, UploadFile
from fastapi.responses import JSONResponse

# base = fast, small = better quality; avoid large for low latency
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "base")

app = FastAPI(title="Whisper Service (local STT)", version="0.1.0")

# Lazy-load model on first request
_model = None


def get_model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel
        _model = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
    return _model


@app.get("/health")
async def health() -> JSONResponse:
    return JSONResponse({"status": "ok", "model": WHISPER_MODEL})


@app.post("/inference")
async def inference(file: UploadFile = File(...)) -> JSONResponse:
    audio_bytes = await file.read()
    if not audio_bytes:
        return JSONResponse({"text": ""})
    try:
        model = get_model()
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(audio_bytes)
            path = f.name
        try:
            segments, _ = model.transcribe(
                path, language="en", beam_size=1, vad_filter=True
            )
            text = " ".join(s.text for s in segments if s.text).strip()
            return JSONResponse({"text": text})
        finally:
            try:
                os.unlink(path)
            except Exception:
                pass
    except Exception as e:
        return JSONResponse({"text": "", "error": str(e)[:200]}, status_code=500)
