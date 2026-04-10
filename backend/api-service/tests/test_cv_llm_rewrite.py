import pytest

from cv_llm_rewrite import rewrite_bullets_batch, rewrite_summary


@pytest.mark.asyncio
async def test_rewrite_summary_falls_back_on_empty_llm(monkeypatch):
    async def fake_call(_prompt: str, _url: str, timeout: float = 120.0) -> str:
        return ""

    import cv_llm_rewrite as mod

    monkeypatch.setattr(mod, "call_llm_generate", fake_call)

    base = {"summary": "Original summary", "name": "A", "skills": []}
    out = await rewrite_summary(
        base_cv=base,
        job_description="JD",
        summary_rules={"max_lines": 3},
        llm_service_url="http://x",
        timeout=1.0,
    )
    assert out == "Original summary"


@pytest.mark.asyncio
async def test_rewrite_bullets_batch_falls_back_on_bad_json(monkeypatch):
    async def fake_call(_prompt: str, _url: str, timeout: float = 120.0) -> str:
        return "not json"

    import cv_llm_rewrite as mod

    monkeypatch.setattr(mod, "call_llm_generate", fake_call)

    src = ["Built backend services"]
    out = await rewrite_bullets_batch(
        role="Engineer",
        company="Acme",
        bullets=src,
        job_description="JD",
        bullet_rules={"require_metric": True},
        llm_service_url="http://x",
        timeout=1.0,
    )
    assert out == src

