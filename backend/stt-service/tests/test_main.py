"""Unit and mock tests for STT Service."""
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_transcribe_empty_file():
    r = client.post("/transcribe", files={"file": ("audio.wav", b"", "audio/wav")})
    assert r.status_code == 200
    assert r.json() == {"text": ""}


@patch("main.WHISPER_URL", "http://whisper:8000")
@patch("main._transcribe_via_http", new_callable=AsyncMock, return_value="Tell me about leadership.")
def test_transcribe_via_whisper_http(mock_http):
    r = client.post(
        "/transcribe",
        files={"file": ("audio.wav", b"\x00\x00\x01\x00", "audio/wav")},
    )
    assert r.status_code == 200
    assert r.json()["text"] == "Tell me about leadership."
    mock_http.assert_called_once()


def test_transcribe_no_whisper_returns_empty():
    """When WHISPER_URL is unset and no binary, transcribe returns empty text."""
    r = client.post(
        "/transcribe",
        files={"file": ("audio.wav", b"fake-wav-bytes", "audio/wav")},
    )
    assert r.status_code == 200
    assert r.json()["text"] == ""
