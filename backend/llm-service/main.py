from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.responses import JSONResponse, StreamingResponse
import httpx
import os
import json

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://ollama:11434")
# Ultra-low latency: qwen2.5:0.5b (~400MB, <1GB RAM). Alternatives: llama3.2:1b, phi3
MODEL_NAME = os.getenv("OLLAMA_MODEL", "qwen2.5:0.5b")


class LlmRequest(BaseModel):
    prompt: str


class LlmResponse(BaseModel):
    raw_answer: str


app = FastAPI(title="LLM Service (Ollama client)", version="0.1.0")


@app.get("/health")
async def health() -> JSONResponse:
    return JSONResponse({"status": "ok"})


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
    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            resp = await client.post(
                f"{OLLAMA_HOST}/api/generate",
                json={"model": MODEL_NAME, "prompt": body.prompt, "stream": False},
            )
            resp.raise_for_status()
            data = resp.json()
            return LlmResponse(raw_answer=data.get("response", "") or MOCK_ANSWER)
        except (httpx.TimeoutException, httpx.ConnectError) as e:
            return LlmResponse(raw_answer=MOCK_ANSWER)


@app.post("/generate/stream")
async def generate_stream(body: LlmRequest):
    """Stream LLM tokens as newline-delimited JSON: {"token": "..."} per line."""

    async def stream_tokens():
        async with httpx.AsyncClient(timeout=120.0) as client:
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
                    if not full:
                        yield json.dumps({"token": MOCK_ANSWER}) + "\n"
            except (httpx.TimeoutException, httpx.ConnectError):
                yield json.dumps({"token": MOCK_ANSWER}) + "\n"

    return StreamingResponse(
        stream_tokens(),
        media_type="application/x-ndjson",
    )

