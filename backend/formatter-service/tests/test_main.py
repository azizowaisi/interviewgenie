"""Unit tests for Formatter Service."""
import pytest
from fastapi.testclient import TestClient

from main import app, extract_section

client = TestClient(app)


def test_extract_section_situation():
    text = "Situation: I was a team lead. Task: Deliver on time."
    assert extract_section(text, "Situation") == "I was a team lead."


def test_extract_section_task():
    text = "Situation: X. Task: I had to coordinate. Action: Daily standups."
    assert extract_section(text, "Task") == "I had to coordinate."


def test_extract_section_result():
    text = "Action: I did X. Result: We shipped on time."
    assert extract_section(text, "Result") == "We shipped on time."


def test_extract_section_missing_returns_empty():
    text = "No STAR headers here."
    assert extract_section(text, "Situation") == ""


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_format_parses_star():
    raw = (
        "Situation: I led a project.\n"
        "Task: Deliver on time.\n"
        "Action: I held standups.\n"
        "Result: We shipped."
    )
    r = client.post("/format", json={"raw_answer": raw})
    assert r.status_code == 200
    data = r.json()
    assert data["situation"] == "I led a project."
    assert data["task"] == "Deliver on time."
    assert data["action"] == "I held standups."
    assert data["result"] == "We shipped."


def test_format_fallback_to_raw():
    r = client.post("/format", json={"raw_answer": "Just one paragraph with no STAR."})
    assert r.status_code == 200
    data = r.json()
    assert data["situation"] == "Just one paragraph with no STAR."
    assert data["task"] == ""
    assert data["action"] == ""
    assert data["result"] == ""
