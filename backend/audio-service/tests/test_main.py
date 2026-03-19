"""Unit and mock tests for Audio Service."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app, run_pipeline, run_pipeline_from_text

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_run_pipeline_success():
    """Mock all downstream services; pipeline returns STAR dict."""
    async def mock_post(url, **kwargs):
        m = MagicMock()
        m.raise_for_status = MagicMock()
        if "transcribe" in str(url):
            m.json = lambda: {"text": "Tell me about a time you led a project."}
        elif "process" in str(url):
            m.json = lambda: {"prompt": "Answer in STAR: Tell me about leadership."}
        elif "generate" in str(url) and "stream" not in str(url):
            m.json = lambda: {"raw_answer": "Situation: I led. Task: Deliver. Action: Standups. Result: Shipped."}
        elif "format" in str(url):
            m.json = lambda: {
                "situation": "I led.",
                "task": "Deliver.",
                "action": "Standups.",
                "result": "Shipped.",
            }
        else:
            m.json = lambda: {}
        return m

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(side_effect=mock_post)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch("main.httpx.AsyncClient", return_value=mock_client):
        result = await run_pipeline(b"fake-audio-bytes")
    assert "error" not in result
    assert result.get("situation") == "I led."
    assert result.get("result") == "Shipped."


@pytest.mark.asyncio
async def test_run_pipeline_empty_transcript():
    async def mock_post(url, **kwargs):
        m = MagicMock()
        m.raise_for_status = MagicMock()
        if "transcribe" in str(url):
            m.json = lambda: {"text": ""}
        else:
            m.json = lambda: {}
        return m

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(side_effect=mock_post)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch("main.httpx.AsyncClient", return_value=mock_client):
        result = await run_pipeline(b"fake-audio-bytes")
    assert "error" in result
    assert "No speech" in result["error"]


@pytest.mark.asyncio
async def test_run_pipeline_from_text_empty():
    result = await run_pipeline_from_text("   ")
    assert "error" in result
    assert "No question" in result["error"]


@pytest.mark.asyncio
async def test_run_pipeline_from_text_success():
    async def mock_post(url, **kwargs):
        m = MagicMock()
        m.raise_for_status = MagicMock()
        if "process" in str(url):
            m.json = lambda: {"prompt": "STAR answer for: typed question"}
        elif "format" in str(url):
            m.json = lambda: {"situation": "X.", "task": "Y.", "action": "Z.", "result": "Done."}
        else:
            m.json = lambda: {}
        return m

    async def mock_aiter_lines():
        yield '{"token": "Situation: X. "}'
        yield '{"token": "Task: Y. Action: Z. Result: Done."}'

    mock_stream_resp = MagicMock()
    mock_stream_resp.raise_for_status = MagicMock()
    mock_stream_resp.aiter_lines = mock_aiter_lines

    mock_stream_ctx = MagicMock()
    mock_stream_ctx.__aenter__ = AsyncMock(return_value=mock_stream_resp)
    mock_stream_ctx.__aexit__ = AsyncMock(return_value=None)

    mock_client = AsyncMock()
    mock_client.post = AsyncMock(side_effect=mock_post)
    mock_client.stream = AsyncMock(return_value=mock_stream_ctx)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch("main.httpx.AsyncClient", return_value=mock_client):
        result = await run_pipeline_from_text("What is your strength?")
    assert "error" not in result
    assert result.get("situation") == "X."
