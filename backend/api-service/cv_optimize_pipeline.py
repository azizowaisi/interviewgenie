from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from cv_docx_optimizer import (
    call_llm_generate,
    docx_bytes_to_structure,
    parse_llm_json_object,
    validate_docx_only,
)
from db import get_cvs_collection, get_topics_collection
from cv_llm_rewrite import rewrite_bullets_batch, rewrite_summary
from cv_optimize_rules import apply_rules, build_rules_prompt


def _generated_dir(upload_dir: str) -> Path:
    base = Path(upload_dir or "/tmp/uploads")
    p = base / "generated"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _progress_cb(on_progress: callable | None):
    def progress(stage: str, pct: int, message: str) -> None:
        if on_progress:
            try:
                on_progress(stage, int(max(0, min(100, pct))), message)
            except Exception:
                pass

    return progress


def _load_topic_or_404(*, topics, tid: str, user_id: str):
    from bson import ObjectId

    try:
        topic_doc = topics.find_one({"_id": ObjectId(tid), "user_id": user_id})
    except Exception:
        topic_doc = None
    if not topic_doc:
        raise HTTPException(404, detail="Topic not found")
    return topic_doc


def _resolve_job_description(*, input_jd: str, topic_doc: dict) -> str:
    jd = (input_jd or "").strip() or (topic_doc.get("job_description") or "").strip()
    if not jd:
        raise HTTPException(400, detail="job_description is required — add it to the job or paste it in the form.")
    return jd


def _load_cv_doc_or_404(*, cvs, cv_oid, user_id: str):
    cv_doc = cvs.find_one({"_id": cv_oid, "user_id": user_id})
    if not cv_doc:
        raise HTTPException(404, detail="CV not found for this topic")
    return cv_doc


def _require_cv_id(topic_doc: dict, *, progress: callable):
    progress("load_cv", 15, "Loading saved CV for this job")
    cv_oid = topic_doc.get("cv_id")
    if not cv_oid:
        raise HTTPException(400, detail="No CV uploaded for this job yet. Upload a CV on the Start page first.")
    return cv_oid


async def _load_docx_bytes_or_422(*, cv_doc: dict) -> bytes:
    fn = (cv_doc.get("filename") or "").lower()
    path = cv_doc.get("original_file_path")
    if not (fn.endswith(".docx") and path and os.path.isfile(path)):
        raise HTTPException(
            422,
            detail="ATS CV optimization requires a .docx CV. Please re-upload your CV as a DOCX file on the Start page.",
        )
    import asyncio
    from pathlib import Path

    data = await asyncio.to_thread(Path(path).read_bytes)
    if not data:
        raise HTTPException(400, detail="Saved CV file is empty.")
    validate_docx_only(cv_doc.get("filename"), None, data)
    return data


def _base_cv_from_structure(structure: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": (structure.get("name") or "").strip(),
        "summary": structure.get("summary") or "",
        "experience": structure.get("experience") or [],
        "skills": structure.get("skills") or [],
    }


async def _generate_rules(*, base_cv: dict[str, Any], jd: str, llm_service_url: str, llm_timeout_seconds: float) -> dict[str, Any]:
    rules_prompt = build_rules_prompt(base_cv, jd)
    raw_rules = await call_llm_generate(rules_prompt, llm_service_url, timeout=llm_timeout_seconds)
    if not raw_rules:
        raise HTTPException(502, detail="Empty response from LLM service (rules)")
    rules_obj = parse_llm_json_object(raw_rules)
    return rules_obj if isinstance(rules_obj, dict) else {}


async def _generate_rules_with_progress(
    *,
    base_cv: dict[str, Any],
    jd: str,
    llm_service_url: str,
    llm_timeout_seconds: float,
    progress: callable,
) -> dict[str, Any]:
    progress("rules_prompt", 35, "Preparing ATS rules for the LLM")
    progress("rules_llm", 45, "Generating ATS rules (fast)")
    progress("rules_parse", 52, "Parsing ATS rules")
    return await _generate_rules(
        base_cv=base_cv,
        jd=jd,
        llm_service_url=llm_service_url,
        llm_timeout_seconds=llm_timeout_seconds,
    )


async def _rewrite_bullets_parallel(
    *,
    experience: list[dict[str, Any]],
    jd: str,
    bullet_rules: dict[str, Any],
    llm_service_url: str,
    llm_timeout_seconds: float,
    progress: callable,
) -> None:
    if not experience:
        return
    import asyncio

    total_entries = len(experience)
    sem = asyncio.Semaphore(int(os.getenv("CV_OPTIMIZE_BULLET_CONCURRENCY", "4")))

    async def rewrite_one(idx: int, item: dict[str, Any]) -> tuple[int, list[str]]:
        async with sem:
            bullets = item.get("bullets") or []
            out_bullets = await rewrite_bullets_batch(
                role=str(item.get("role") or ""),
                company=str(item.get("company") or ""),
                bullets=bullets if isinstance(bullets, list) else [],
                job_description=jd,
                bullet_rules=bullet_rules,
                llm_service_url=llm_service_url,
                timeout=llm_timeout_seconds,
            )
            return idx, out_bullets

    tasks = [asyncio.create_task(rewrite_one(i, it)) for i, it in enumerate(experience) if isinstance(it, dict)]
    done_count = 0
    for fut in asyncio.as_completed(tasks):
        idx, new_bullets = await fut
        experience[idx]["bullets"] = new_bullets
        done_count += 1
        pct = 62 + int((done_count / max(1, total_entries)) * 23)  # 62..85
        progress("rewrite_bullets", pct, f"Rewriting bullets ({done_count}/{total_entries})")


async def _render_docx_bytes(*, final_cv: dict[str, Any], cv_renderer_url: str) -> bytes:
    import httpx

    rbase = (cv_renderer_url or "").rstrip("/")
    if not rbase:
        raise HTTPException(500, detail="CV_RENDERER_URL is not set")
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(f"{rbase}/render/docx", json=final_cv)
        resp.raise_for_status()
        data = resp.content
    if not data:
        raise HTTPException(502, detail="Renderer returned empty DOCX")
    return data


def _summarize_suggestions(rules: dict[str, Any]) -> list[str]:
    suggestions: list[str] = []
    ms = rules.get("missing_skills")
    if isinstance(ms, list) and ms:
        suggestions.append("Consider adding missing skills (if truthful): " + ", ".join(str(x) for x in ms[:8]))
    kp = rules.get("keyword_phrases")
    if isinstance(kp, list) and kp:
        suggestions.append("Keywords to emphasize (if truthful): " + ", ".join(str(x) for x in kp[:8]))
    return suggestions


async def optimize_docx_for_topic(
    *,
    user_id: str,
    topic_id: str,
    job_description: str,
    llm_service_url: str,
    llm_timeout_seconds: float,
    cv_renderer_url: str,
    upload_dir: str,
    on_progress: callable | None = None,
) -> dict[str, Any]:
    """Core pipeline used by both HTTP endpoint and Rabbit worker.

    Reads the CV linked to topic_id, asks LLM to optimize, writes a DOCX into upload_dir,
    and returns {file_id, abs_path, suggestions}.
    """
    progress = _progress_cb(on_progress)

    tid = (topic_id or "").strip()
    if not tid:
        raise HTTPException(400, detail="topic_id is required")

    progress("start", 5, "Starting job")
    topics = get_topics_collection()
    cvs = get_cvs_collection()
    topic_doc = _load_topic_or_404(topics=topics, tid=tid, user_id=user_id)
    jd = _resolve_job_description(input_jd=job_description, topic_doc=topic_doc)

    cv_oid = _require_cv_id(topic_doc, progress=progress)

    cv_doc = _load_cv_doc_or_404(cvs=cvs, cv_oid=cv_oid, user_id=user_id)
    progress("parse_docx", 25, "Reading DOCX and extracting structure")
    data = await _load_docx_bytes_or_422(cv_doc=cv_doc)
    structure = docx_bytes_to_structure(data)
    base_cv = _base_cv_from_structure(structure)

    rules = await _generate_rules_with_progress(
        base_cv=base_cv,
        jd=jd,
        llm_service_url=llm_service_url,
        llm_timeout_seconds=llm_timeout_seconds,
        progress=progress,
    )

    progress("apply_rules", 56, "Applying ATS rules deterministically")
    patched = apply_rules(base_cv, rules)  # name/skills order/skill add (conservative)

    progress("rewrite_summary", 60, "Rewriting summary")
    patched["summary"] = await rewrite_summary(
        base_cv=patched,
        job_description=jd,
        summary_rules=(rules.get("summary_rules") if isinstance(rules, dict) else {}) or {},
        llm_service_url=llm_service_url,
        timeout=llm_timeout_seconds,
    )

    exp_in = patched.get("experience") if isinstance(patched.get("experience"), list) else []
    if exp_in:
        progress("rewrite_bullets", 62, f"Rewriting bullets (0/{len(exp_in)})")
        bullet_rules = (rules.get("bullet_rules") if isinstance(rules, dict) else {}) or {}
        await _rewrite_bullets_parallel(
            experience=exp_in,
            jd=jd,
            bullet_rules=bullet_rules if isinstance(bullet_rules, dict) else {},
            llm_service_url=llm_service_url,
            llm_timeout_seconds=llm_timeout_seconds,
            progress=progress,
        )

    final_cv = {
        "name": (patched.get("name") or "").strip(),
        "summary": patched.get("summary") or "",
        "experience": exp_in,
        "skills": patched.get("skills") or [],
    }

    file_id = uuid.uuid4().hex
    out_dir = _generated_dir(upload_dir)
    out_name = f"ats_optimized_{user_id}_{file_id}.docx"
    out_path = out_dir / out_name

    progress("render_docx", 92, "Rendering deterministic DOCX")
    data = await _render_docx_bytes(final_cv=final_cv, cv_renderer_url=cv_renderer_url)

    progress("write_docx", 96, "Saving DOCX")
    import asyncio

    await asyncio.to_thread(out_path.write_bytes, data)

    progress("done", 100, "Done — ready to download")
    suggestions = _summarize_suggestions(rules) if isinstance(rules, dict) else []
    return {
        "file_id": file_id,
        "abs_path": str(out_path.resolve()),
        "suggestions": suggestions,
        "created_at": datetime.now(timezone.utc),
    }

