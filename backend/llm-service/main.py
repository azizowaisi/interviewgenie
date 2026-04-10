from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from fastapi.responses import JSONResponse, StreamingResponse
import httpx
import os
import json

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://ollama:11434")
# Balanced speed + reasoning on ARM64 CPU nodes.
MODEL_NAME = os.getenv("OLLAMA_MODEL", "mistral")
_OLLAMA_TIMEOUT_S = float(os.getenv("OLLAMA_TIMEOUT_SECONDS", "1200"))
OLLAMA_TIMEOUT = httpx.Timeout(_OLLAMA_TIMEOUT_S, connect=10.0, read=_OLLAMA_TIMEOUT_S, write=10.0)
ALLOW_MOCK = os.getenv("LLM_ALLOW_MOCK", "").strip().lower() in ("1", "true", "yes", "on")
MAX_PREDICT = int(os.getenv("OLLAMA_NUM_PREDICT", "1200"))


class LlmRequest(BaseModel):
    prompt: str


class LlmResponse(BaseModel):
    raw_answer: str


app = FastAPI(title="LLM Service (Ollama client)", version="0.1.0")


@app.get("/health")
async def health() -> JSONResponse:
    return JSONResponse({"status": "ok"})


@app.get("/ready")
async def ready() -> JSONResponse:
    """Ready only when Ollama is reachable and the configured model is available."""
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.get(f"{OLLAMA_HOST}/api/tags")
            resp.raise_for_status()
            data = resp.json()
            models = data.get("models") or []
            names = {m.get("name") for m in models if isinstance(m, dict)}
            # Ollama tags often include ":latest" (e.g. "mistral:latest").
            if MODEL_NAME in names or any(isinstance(n, str) and n.split(":", 1)[0] == MODEL_NAME for n in names):
                return JSONResponse({"status": "ready", "model": MODEL_NAME})
            return JSONResponse({"status": "not_ready", "model": MODEL_NAME}, status_code=503)
        except Exception:
            return JSONResponse({"status": "not_ready", "model": MODEL_NAME}, status_code=503)


@app.get("/warmup")
async def warmup() -> JSONResponse:
    """Trigger a minimal generate so Ollama keeps the model loaded (avoids cold start)."""
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            await client.post(
                f"{OLLAMA_HOST}/api/generate",
                json={"model": MODEL_NAME, "prompt": "Hi", "stream": False},
            )
    except Exception:
        pass
    return JSONResponse({"status": "ok", "model": MODEL_NAME})


MOCK_ANSWER = """Situation: I was working on a team project with a tight deadline.
Task: I needed to coordinate tasks and ensure everyone delivered on time.
Action: I set up daily standups, broke work into small milestones, and helped unblock teammates.
Result: We shipped on time and the stakeholder was very satisfied."""


@app.post("/generate", response_model=LlmResponse)
async def generate(body: LlmRequest) -> LlmResponse:
    async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client:
        try:
            resp = await client.post(
                f"{OLLAMA_HOST}/api/generate",
                json={
                    "model": MODEL_NAME,
                    "prompt": body.prompt,
                    "stream": False,
                    # Ask Ollama to emit strict JSON when supported.
                    "format": "json",
                    "options": {"num_predict": MAX_PREDICT},
                },
            )
            if resp.status_code == 404:
                # Common: model not pulled yet; Ollama replies 404 with {"error":"model ... not found"}.
                detail = "LLM model not found in Ollama. Pull it (e.g. `ollama pull mistral`)."
                try:
                    j = resp.json()
                    err = j.get("error")
                    if err:
                        detail = f"LLM model not found in Ollama: {err}"
                except Exception:
                    pass
                raise HTTPException(status_code=503, detail=detail)
            resp.raise_for_status()
            data = resp.json()
            answer = (data.get("response", "") or "").strip()
            if answer:
                return LlmResponse(raw_answer=answer)
            if ALLOW_MOCK:
                return LlmResponse(raw_answer=MOCK_ANSWER)
            raise HTTPException(status_code=503, detail="LLM returned an empty response")
        except (httpx.RequestError, httpx.HTTPStatusError, ValueError) as e:
            if ALLOW_MOCK:
                return LlmResponse(raw_answer=MOCK_ANSWER)
            raise HTTPException(status_code=503, detail="LLM backend unavailable") from e


@app.post("/generate/stream")
async def generate_stream(body: LlmRequest):
    """Stream LLM tokens as newline-delimited JSON: {"token": "..."} per line."""

    async def stream_tokens():
        async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT) as client:
            try:
                async with client.stream(
                    "POST",
                    f"{OLLAMA_HOST}/api/generate",
                    json={"model": MODEL_NAME, "prompt": body.prompt, "stream": True},
                ) as resp:
                    resp.raise_for_status()
                    full = []
                    async for line in resp.aiter_lines():
                        if not line:
                            continue
                        try:
                            data = json.loads(line)
                            token = data.get("response", "")
                            if token:
                                full.append(token)
                                yield json.dumps({"token": token}) + "\n"
                            if data.get("done"):
                                break
                        except json.JSONDecodeError:
                            pass
                    if not full and ALLOW_MOCK:
                        yield json.dumps({"token": MOCK_ANSWER}) + "\n"
            except Exception:
                if ALLOW_MOCK:
                    yield json.dumps({"token": MOCK_ANSWER}) + "\n"
                return

    return StreamingResponse(
        stream_tokens(),
        media_type="application/x-ndjson",
    )

