"""Unit tests for Question Service."""
import pytest
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_process_returns_prompt():
    r = client.post("/process", json={"text": "Tell me about a conflict at work."})
    assert r.status_code == 200
    data = r.json()
    assert "prompt" in data
    assert "STAR" in data["prompt"]
    assert "Tell me about a conflict at work." in data["prompt"]
    assert "2-3" in data["prompt"] or "concise" in data["prompt"].lower()


def test_process_strips_whitespace():
    r = client.post("/process", json={"text": "  \n  What is your strength?  \n  "})
    assert r.status_code == 200
    assert "What is your strength?" in r.json()["prompt"]


def test_process_empty_text():
    r = client.post("/process", json={"text": ""})
    assert r.status_code == 200
    assert "Question:" in r.json()["prompt"]
