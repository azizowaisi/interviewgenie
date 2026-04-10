"""Unit and mock tests for LLM Service."""
import importlib
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient


def _client_with_env(monkeypatch, allow_mock: bool):
    monkeypatch.setenv("LLM_ALLOW_MOCK", "1" if allow_mock else "0")
    import main  # local module
    importlib.reload(main)
    return TestClient(main.app)


def test_health(monkeypatch):
    client = _client_with_env(monkeypatch, allow_mock=False)
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


@patch("main.httpx.AsyncClient")
def test_warmup_ignores_failure(mock_client, monkeypatch):
    client = _client_with_env(monkeypatch, allow_mock=False)
    mock_client.return_value.__aenter__ = AsyncMock(return_value=AsyncMock())
    mock_client.return_value.__aexit__ = AsyncMock(return_value=None)
    inner = AsyncMock()
    inner.post = AsyncMock(side_effect=Exception("connection refused"))
    mock_client.return_value.__aenter__.return_value = inner
    r = client.get("/warmup")
    assert r.status_code == 200
    assert "ok" in r.json()["status"]


@patch("main.httpx.AsyncClient")
def test_generate_returns_ollama_response(mock_client, monkeypatch):
    client = _client_with_env(monkeypatch, allow_mock=False)
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
def test_generate_fallback_on_timeout(mock_client, monkeypatch):
    import httpx
    client = _client_with_env(monkeypatch, allow_mock=True)
    mock_client.return_value.__aenter__ = AsyncMock(return_value=AsyncMock())
    mock_client.return_value.__aexit__ = AsyncMock(return_value=None)
    inner = AsyncMock()
    inner.post = AsyncMock(side_effect=httpx.TimeoutException("timeout"))
    mock_client.return_value.__aenter__.return_value = inner

    r = client.post("/generate", json={"prompt": "Hi"})
    assert r.status_code == 200
    assert "Situation" in r.json()["raw_answer"]


def test_generate_stream_returns_ndjson(monkeypatch):
    """Without Ollama, service falls back to MOCK_ANSWER; we get 200 and NDJSON."""
    client = _client_with_env(monkeypatch, allow_mock=True)
    r = client.post("/generate/stream", json={"prompt": "Hi"})
    assert r.status_code == 200
    assert "application/x-ndjson" in r.headers.get("content-type", "")
    # Body is streamed; TestClient consumes it. Should contain at least one token line or mock.
    text = r.text or ""
    assert "token" in text or "Situation" in text


@patch("main.httpx.AsyncClient")
def test_generate_returns_503_when_no_mock(mock_client, monkeypatch):
    import httpx
    client = _client_with_env(monkeypatch, allow_mock=False)
    mock_client.return_value.__aenter__ = AsyncMock(return_value=AsyncMock())
    mock_client.return_value.__aexit__ = AsyncMock(return_value=None)
    inner = AsyncMock()
    inner.post = AsyncMock(side_effect=httpx.TimeoutException("timeout"))
    mock_client.return_value.__aenter__.return_value = inner

    r = client.post("/generate", json={"prompt": "Hi"})
    assert r.status_code == 503
