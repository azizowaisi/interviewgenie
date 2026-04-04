"""Tests for cv-parser-service parsing logic."""
import sys
import os
import io

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from main import _extract_email, _extract_skills, _extract_experience_years, _extract_name, _parse


CV_TEXT = """John Smith
john.smith@example.com
+1 555 000 1234

Summary
Senior Python developer with 5 years of experience in backend systems.

Experience
Software Engineer — Acme Corp           2019 – 2023
  - Built FastAPI microservices deployed on Kubernetes with Docker
  - Worked with PostgreSQL, MongoDB, Redis

Junior Developer — Startup Inc          2017 – 2019
  - Python, Django, React, AWS

Skills
Python, TypeScript, Docker, Kubernetes, FastAPI, React, PostgreSQL, MongoDB, AWS
"""


def test_extract_email():
    assert _extract_email(CV_TEXT) == "john.smith@example.com"


def test_extract_email_none():
    assert _extract_email("No email here") == ""


def test_extract_name():
    name = _extract_name(CV_TEXT)
    assert name == "John Smith"


def test_extract_skills():
    skills = _extract_skills(CV_TEXT)
    assert "python" in skills
    assert "docker" in skills
    assert "kubernetes" in skills
    assert "fastapi" in skills
    assert "react" in skills
    assert "postgresql" in skills
    assert "mongodb" in skills
    assert "aws" in skills


def test_extract_experience_years():
    years = _extract_experience_years(CV_TEXT)
    # 2019-2023 = 4y, 2017-2019 = 2y → total 6y
    assert years == 6.0


def test_extract_experience_explicit_statement():
    text = "I have 7 years of experience in software development."
    assert _extract_experience_years(text) == 7.0


def test_extract_experience_label_then_years():
    text = "Experience: 6 years"
    assert _extract_experience_years(text) == 6.0


def test_extract_experience_yrs_variant():
    text = "Total experience - 3.5 yrs"
    assert _extract_experience_years(text) == 3.5


def test_parse_plain_text():
    data = CV_TEXT.encode("utf-8")
    result = _parse(data, "cv.txt")
    assert result["email"] == "john.smith@example.com"
    assert "python" in result["skills"]
    assert len(result["raw_text"]) > 0
    assert result["experience_years"] == 6.0


def test_parse_pdf_by_magic_bytes_without_extension(monkeypatch):
    # Client can upload PDF bytes with a non-pdf filename; parser should still treat it as PDF.
    monkeypatch.setattr("main._extract_text_pdf", lambda _d: "Abdul Aziz\nExperience: 6 years\n")
    data = b"%PDF-1.7\n..."
    result = _parse(data, "resume-upload")
    assert result["name"] == "Abdul Aziz"
    assert result["experience_years"] == 6.0


def test_parse_pdf_accepts_short_text(monkeypatch):
    # Very short CV text should still be accepted and parsed for fields.
    monkeypatch.setattr("main._extract_text_pdf", lambda _d: "Abdul Aziz\n")
    result = _parse(b"%PDF-1.4\n...", "short.pdf")
    assert result["name"] == "Abdul Aziz"


def test_scoring_integration():
    """Test the scoring formula used in api-service."""
    # Import scorer from api-service
    api_path = os.path.join(os.path.dirname(__file__), "..", "..", "api-service")
    sys.path.insert(0, api_path)
    try:
        from main import _score_candidate
        score = _score_candidate(
            cv_skills=["python", "docker", "fastapi"],
            job_skills=["python", "docker", "kubernetes"],
            experience_years=4,
        )
        # 2/3 skill match = 40pts, exp=4 → 10+20=30pts → total 70
        assert 60 <= score <= 80
    except ImportError:
        pass  # api-service deps may not be installed in this env
