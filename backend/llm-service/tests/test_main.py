"""Unit and mock tests for LLM Service."""
import json
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


@patch("main.httpx.AsyncClient")
def test_warmup_ignores_failure(mock_client):
    mock_client.return_value.__aenter__ = AsyncMock(return_value=AsyncMock())
    mock_client.return_value.__aexit__ = AsyncMock(return_value=None)
    inner = AsyncMock()
    inner.post = AsyncMock(side_effect=Exception("connection refused"))
    mock_client.return_value.__aenter__.return_value = inner
    r = client.get("/warmup")
    assert r.status_code == 200
    assert "ok" in r.json()["status"]


@patch("main.httpx.AsyncClient")
def test_generate_returns_ollama_response(mock_client):
    mock_client.return_value.__aenter__ = AsyncMock(return_value=AsyncMock())
    mock_client.return_value.__aexit__ = AsyncMock(return_value=None)
    inner = AsyncMock()
    resp = AsyncMock()
    resp.raise_for_status = lambda: None
    resp.json = lambda: {"response": "I led a team project successfully."}
    inner.post = AsyncMock(return_value=resp)
    mock_client.return_value.__aenter__.return_value = inner

    r = client.post("/generate", json={"prompt": "Tell me about leadership."})
    assert r.status_code == 200
    assert r.json()["raw_answer"] == "I led a team project successfully."


@patch("main.httpx.AsyncClient")
def test_generate_fallback_on_timeout(mock_client):
    import httpx
    mock_client.return_value.__aenter__ = AsyncMock(return_value=AsyncMock())
    mock_client.return_value.__aexit__ = AsyncMock(return_value=None)
    inner = AsyncMock()
    inner.post = AsyncMock(side_effect=httpx.TimeoutException("timeout"))
    mock_client.return_value.__aenter__.return_value = inner

    r = client.post("/generate", json={"prompt": "Hi"})
    assert r.status_code == 200
    assert "Situation" in r.json()["raw_answer"]


def test_generate_stream_returns_ndjson():
    """Without Ollama, service falls back to MOCK_ANSWER; we get 200 and NDJSON."""
    r = client.post("/generate/stream", json={"prompt": "Hi"})
    assert r.status_code == 200
    assert "application/x-ndjson" in r.headers.get("content-type", "")
    # Body is streamed; TestClient consumes it. Should contain at least one token line or mock.
    text = r.text or ""
    assert "token" in text or "Situation" in text
