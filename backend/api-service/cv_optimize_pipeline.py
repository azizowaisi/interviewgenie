from __future__ import annotations

import asyncio
import hashlib
import json
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
from cv_assembly_store import (
    assembly_complete_experience_section,
    assembly_create,
    assembly_find_latest,
    assembly_finalize,
    assembly_init_experience_tree,
    assembly_patch_experience_node,
    assembly_resume_from,
    assembly_set_section,
)
from cv_pipeline_events import emit_cv_pipeline_event
from db import get_ats_analysis_collection, get_cvs_collection, get_topics_collection
from cv_llm_rewrite import rewrite_bullets_batch, rewrite_summary
from cv_optimize_rules import apply_rules, build_rules_prompt, merge_rule_skills_into_cv


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


def _sha256_text(s: str) -> str:
    return hashlib.sha256((s or "").encode("utf-8")).hexdigest()


def _sha256_json(obj: Any) -> str:
    try:
        data = json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    except Exception:
        data = str(obj)
    return _sha256_text(data)


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


def _headline_from_topic_or_jd(*, topic_doc: dict, jd: str) -> str:
    # Prefer the topic "topic" field (it’s usually the target role).
    t = str(topic_doc.get("topic") or "").strip()
    if t:
        return t[:120]
    # Fallback: take the first non-empty line of the JD if it looks like a title.
    for ln in (jd or "").splitlines():
        s = ln.strip()
        if not s:
            continue
        if len(s) <= 80:
            return s
        break
    return ""


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
    edu = structure.get("education")
    contact = structure.get("contact")
    return {
        "name": (structure.get("name") or "").strip(),
        "contact": list(contact) if isinstance(contact, list) else [],
        "summary": structure.get("summary") or "",
        "experience": structure.get("experience") or [],
        "skills": structure.get("skills") or [],
        "education": edu if isinstance(edu, list) else [],
    }


async def _call_llm_generate_with_progress_pulse(
    *,
    prompt: str,
    llm_service_url: str,
    timeout: float,
    progress: callable,
    stage: str,
    pct: int,
    base_message: str,
    num_predict: int | None = None,
) -> str:
    """Wait on the LLM and refresh the status line periodically so the job does not look stuck."""
    import contextlib
    try:
        interval = float(os.getenv("CV_OPTIMIZE_LLM_PULSE_SECONDS", "12"))
    except Exception:
        interval = 12.0
    interval = max(5.0, min(interval, 60.0))

    # NOTE: httpx "timeout" is not a hard deadline — it's per-operation. If the server keeps the
    # connection alive (e.g., slow drip / proxy buffering), it can exceed the intended wall clock.
    # Enforce a hard deadline here to avoid the common "stuck at 45%" production failure mode.
    task = asyncio.create_task(call_llm_generate(prompt, llm_service_url, timeout=timeout, num_predict=num_predict))
    elapsed = 0.0
    while True:
        done, _ = await asyncio.wait({task}, timeout=interval, return_when=asyncio.FIRST_COMPLETED)
        if task in done:
            return task.result()
        elapsed += interval
        if elapsed >= timeout:
            task.cancel()
            with contextlib.suppress(Exception):
                await task
            raise HTTPException(
                504,
                detail=f"LLM timeout after {int(timeout)}s at stage={stage}. Ollama/CPU models may be overloaded; try again or reduce job size.",
            )
        em = int(elapsed // 60)
        es = int(elapsed % 60)
        if em:
            tail = f" ({em}m {es}s — still running; CPU models can take several minutes)"
        else:
            tail = f" ({int(es)}s…)"
        progress(stage, pct, base_message + tail)


def _fetch_latest_ats_hints(user_id: str, topic_id: str) -> dict[str, Any] | None:
    """Load latest /ats/analyze row so CV generation matches ATS page suggestions."""
    from bson import ObjectId

    try:
        oid = ObjectId(topic_id)
    except Exception:
        return None
    coll = get_ats_analysis_collection()
    doc = coll.find_one({"user_id": user_id, "topic_id": oid}, sort=[("created_at", -1)])
    if not doc:
        return None
    return {
        "suggested_skills_to_add": list(doc.get("suggested_skills_to_add") or []),
        "professional_summary_suggestions": list(doc.get("professional_summary_suggestions") or []),
        "skills_section_suggestions": list(doc.get("skills_section_suggestions") or []),
        "experience_suggestions": list(doc.get("experience_suggestions") or []),
        "rewrite_summary": doc.get("rewrite_summary"),
        "rewrite_experience_indices": doc.get("rewrite_experience_indices"),
        "rewrite_reasons": doc.get("rewrite_reasons"),
        "experience_entry_suggestions": doc.get("experience_entry_suggestions"),
    }


async def _generate_rules_with_progress(
    *,
    base_cv: dict[str, Any],
    jd: str,
    llm_service_url: str,
    llm_timeout_seconds: float,
    progress: callable,
    ats_hints: dict[str, Any] | None,
) -> dict[str, Any]:
    progress("rules_prompt", 35, "Preparing ATS rules for the LLM")
    progress("rules_llm", 45, "Generating ATS rules…")
    # If we already have structured ATS hints from /ats/analyze, skip the expensive rules LLM step.
    # This avoids the common "stuck at 45%" failure mode on CPU-bound local models.
    if isinstance(ats_hints, dict):
        rewrite_summary = ats_hints.get("rewrite_summary")
        rewrite_exp = ats_hints.get("rewrite_experience_indices")
        if rewrite_summary is not None or rewrite_exp is not None:
            progress("rules_skip", 50, "Using ATS suggestions (skipping rules LLM)")
            ms = ats_hints.get("suggested_skills_to_add")
            rules_out: dict[str, Any] = {
                "rewrite_summary": bool(rewrite_summary) if rewrite_summary is not None else True,
                "rewrite_experience_indices": list(rewrite_exp or []),
            }
            if isinstance(ms, list) and ms:
                rules_out["missing_skills"] = ms
            return rules_out
    # Only mark \"parsing\" after the LLM call returns.
    rules_prompt = build_rules_prompt(base_cv, jd, ats_hints)
    try:
        rules_timeout = float(os.getenv("CV_OPTIMIZE_RULES_TIMEOUT_SECONDS", "180"))
    except Exception:
        rules_timeout = 180.0
    rules_timeout = max(30.0, min(rules_timeout, llm_timeout_seconds))
    raw_rules = await _call_llm_generate_with_progress_pulse(
        prompt=rules_prompt,
        llm_service_url=llm_service_url,
        timeout=rules_timeout,
        progress=progress,
        stage="rules_llm",
        pct=45,
        base_message="Generating ATS rules…",
        num_predict=int(os.getenv("CV_OPTIMIZE_RULES_NUM_PREDICT", "240")),
    )
    if not raw_rules:
        raise HTTPException(502, detail="Empty response from LLM service (rules)")
    progress("rules_parse", 52, "Parsing ATS rules")
    rules_obj = parse_llm_json_object(raw_rules)
    return rules_obj if isinstance(rules_obj, dict) else {}


async def warmup_llm(*, llm_service_url: str) -> None:
    """Best-effort warmup so Ollama loads the model before the first heavy /generate call."""
    import httpx

    base = (llm_service_url or "").rstrip("/")
    if not base:
        return
    try:
        timeout = float(os.getenv("LLM_WARMUP_TIMEOUT_SECONDS", "180"))
    except Exception:
        timeout = 180.0
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            await client.get(f"{base}/warmup")
    except Exception:
        return


async def _rewrite_bullets_parallel(
    *,
    experience: list[dict[str, Any]],
    jd: str,
    bullet_rules: dict[str, Any],
    llm_service_url: str,
    llm_timeout_seconds: float,
    progress: callable,
    ats_hints: dict[str, Any] | None,
    rewrite_indices: set[int] | None = None,
    assembly_job_id: str | None = None,
) -> None:
    if not experience:
        return
    import asyncio

    total_entries = len(experience)
    sem = asyncio.Semaphore(int(os.getenv("CV_OPTIMIZE_BULLET_CONCURRENCY", "4")))
    track_nodes = bool((assembly_job_id or "").strip())
    aid = (assembly_job_id or "").strip() if track_nodes else ""

    async def rewrite_one(idx: int, item: dict[str, Any]) -> tuple[int, list[str]]:
        node_id = f"exp_{idx}"
        role = str(item.get("role") or "")
        company = str(item.get("company") or "")
        bullets = item.get("bullets") or []
        src = bullets if isinstance(bullets, list) else []
        if rewrite_indices is not None and idx not in rewrite_indices:
            # Keep original bullets; still mark node so the UI doesn't look stuck.
            cleaned = [str(b).strip() for b in src if isinstance(b, str) and str(b).strip()]
            if track_nodes:
                try:
                    assembly_patch_experience_node(
                        job_id=aid,
                        node_id=node_id,
                        status="skipped",
                        optimized={"role": role, "company": company, "bullets": cleaned},
                    )
                    emit_cv_pipeline_event(
                        job_id=aid,
                        event_type="experience.node_skipped",
                        section="experience",
                        extra={"node_id": node_id},
                    )
                except Exception:
                    pass
            return idx, cleaned
        if track_nodes:
            try:
                assembly_patch_experience_node(job_id=aid, node_id=node_id, status="processing")
                emit_cv_pipeline_event(
                    job_id=aid,
                    event_type="experience.node_processing",
                    section="experience",
                    extra={"node_id": node_id},
                )
            except Exception:
                pass
        try:
            async with sem:
                out_bullets = await rewrite_bullets_batch(
                    role=role,
                    company=company,
                    bullets=src,
                    job_description=jd,
                    bullet_rules=bullet_rules,
                    llm_service_url=llm_service_url,
                    timeout=llm_timeout_seconds,
                    ats_hints=ats_hints,
                )
            if track_nodes:
                try:
                    assembly_patch_experience_node(
                        job_id=aid,
                        node_id=node_id,
                        status="complete",
                        optimized={"role": role, "company": company, "bullets": out_bullets},
                    )
                    emit_cv_pipeline_event(
                        job_id=aid,
                        event_type="experience.node_updated",
                        section="experience",
                        extra={"node_id": node_id},
                    )
                except Exception:
                    pass
            return idx, out_bullets
        except Exception as e:
            if track_nodes:
                try:
                    assembly_patch_experience_node(
                        job_id=aid,
                        node_id=node_id,
                        status="failed",
                        error=str(e)[:500],
                    )
                    emit_cv_pipeline_event(
                        job_id=aid,
                        event_type="experience.node_failed",
                        section="experience",
                        extra={"node_id": node_id, "error": str(e)[:200]},
                    )
                except Exception:
                    pass
            fallback = [str(b).strip() for b in src if isinstance(b, str) and str(b).strip()]
            return idx, fallback

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


def _refresh_skills_after_rewrites(
    *,
    patched: dict[str, Any],
    rules: dict[str, Any],
    ats_hints: dict[str, Any] | None,
    progress: callable,
) -> None:
    progress("merge_skills", 88, "Refreshing skills from CV text after rewrites")
    merge_rule_skills_into_cv(patched, rules, ats_hints)  # type: ignore[arg-type]


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
    pipeline_job_id: str | None = None,
) -> dict[str, Any]:
    """Core pipeline used by both HTTP endpoint and Rabbit worker.

    Reads the CV linked to topic_id, asks LLM to optimize, writes a DOCX into upload_dir,
    and returns {file_id, abs_path, suggestions}.

    When ``pipeline_job_id`` is set, section state + events are stored in MongoDB (``cv_assemblies``)
    for progressive UI and optional RabbitMQ fan-out (``CV_PIPELINE_EVENTS_RABBIT=1``).
    """
    progress = _progress_cb(on_progress)
    assembly_id = (pipeline_job_id or "").strip()
    track = bool(assembly_id)

    tid = (topic_id or "").strip()
    if not tid:
        raise HTTPException(400, detail="topic_id is required")

    progress("start", 5, "Starting job")

    # Overlap model load with Mongo + DOCX I/O so the first LLM call is less likely to wait on Ollama alone.
    warm_task = asyncio.create_task(warmup_llm(llm_service_url=llm_service_url))

    topics = get_topics_collection()
    cvs = get_cvs_collection()
    topic_doc = _load_topic_or_404(topics=topics, tid=tid, user_id=user_id)
    jd = _resolve_job_description(input_jd=job_description, topic_doc=topic_doc)
    headline = _headline_from_topic_or_jd(topic_doc=topic_doc, jd=jd)
    ats_hints = _fetch_latest_ats_hints(user_id, tid)

    cv_oid = _require_cv_id(topic_doc, progress=progress)

    cv_doc = _load_cv_doc_or_404(cvs=cvs, cv_oid=cv_oid, user_id=user_id)
    progress("parse_docx", 24, "Reading DOCX file from disk…")
    data = await _load_docx_bytes_or_422(cv_doc=cv_doc)
    progress(
        "parse_docx",
        26,
        "Extracting text structure from DOCX (large files can take a minute; not stuck on the LLM yet)…",
    )
    # python-docx is CPU-heavy; never run it on the asyncio event loop (blocks all API traffic in inline mode).
    structure = await asyncio.to_thread(docx_bytes_to_structure, data)
    progress("parse_docx", 29, "DOCX structure ready")
    base_cv = _base_cv_from_structure(structure)

    if track:
        from bson import ObjectId

        tid_oid = topic_doc.get("_id")
        if tid_oid is None:
            tid_oid = ObjectId(tid)
        # Fingerprint: allow resume only when the inputs are identical.
        jd_hash = _sha256_text((jd or "").strip())
        base_cv_hash = _sha256_json(base_cv)
        assembly_create(
            job_id=assembly_id,
            user_id=user_id,
            topic_id=tid_oid,
            jd_hash=jd_hash,
            base_cv_hash=base_cv_hash,
        )
        emit_cv_pipeline_event(job_id=assembly_id, event_type="cv.created")
        emit_cv_pipeline_event(job_id=assembly_id, event_type="section_processing_started")

        # Resume: copy previously completed section outputs into this new job.
        try:
            src = assembly_find_latest(user_id=user_id, topic_id=tid_oid, jd_hash=jd_hash, base_cv_hash=base_cv_hash)
        except Exception:
            src = None
        if isinstance(src, dict) and str(src.get("_id")) != assembly_id:
            try:
                assembly_resume_from(job_id=assembly_id, source_doc=src)
            except Exception:
                pass

        edu = base_cv.get("education") if isinstance(base_cv.get("education"), list) else []
        assembly_set_section(job_id=assembly_id, section="education", status="complete", content=edu)
        emit_cv_pipeline_event(job_id=assembly_id, event_type="education.updated", section="education")

    try:
        await warm_task
    except Exception:
        pass

    try:
        if track:
            assembly_set_section(job_id=assembly_id, section="coordinator", status="processing")
            emit_cv_pipeline_event(job_id=assembly_id, event_type="coordinator.started", section="coordinator")

        rules = await _generate_rules_with_progress(
            base_cv=base_cv,
            jd=jd,
            llm_service_url=llm_service_url,
            llm_timeout_seconds=llm_timeout_seconds,
            progress=progress,
            ats_hints=ats_hints,
        )

        if track:
            assembly_set_section(
                job_id=assembly_id,
                section="coordinator",
                status="complete",
                content={
                    "summary_rules": bool((rules or {}).get("summary_rules")),
                    "bullet_rules": bool((rules or {}).get("bullet_rules")),
                    "skills_rules": bool((rules or {}).get("skills_rules")),
                },
            )
            emit_cv_pipeline_event(job_id=assembly_id, event_type="coordinator.updated", section="coordinator")

        progress("apply_rules", 56, "Applying ATS rules deterministically")
        patched = apply_rules(base_cv, rules, ats_hints)

        # If we resumed from a previous identical run, reuse any completed section outputs
        # so we don't redo LLM work on re-click.
        resumed_sections: dict[str, Any] | None = None
        if track:
            try:
                from db import get_cv_assemblies_collection

                coll = get_cv_assemblies_collection()
                resumed_doc = coll.find_one({"_id": assembly_id})
                if isinstance(resumed_doc, dict) and isinstance(resumed_doc.get("sections"), dict):
                    resumed_sections = resumed_doc.get("sections")
            except Exception:
                resumed_sections = None

        if isinstance(resumed_sections, dict):
            ssec = resumed_sections.get("summary")
            if isinstance(ssec, dict) and ssec.get("status") in ("complete", "skipped"):
                if isinstance(ssec.get("content"), str) and ssec.get("content"):
                    patched["summary"] = ssec.get("content")
            ksec = resumed_sections.get("skills")
            if isinstance(ksec, dict) and ksec.get("status") in ("complete", "skipped"):
                if isinstance(ksec.get("content"), list):
                    patched["skills"] = ksec.get("content")

        if track:
            assembly_set_section(
                job_id=assembly_id,
                section="skills",
                status="complete",
                content=list(patched.get("skills") or []),
            )
            emit_cv_pipeline_event(job_id=assembly_id, event_type="skills.updated", section="skills")

        exp_in = patched.get("experience") if isinstance(patched.get("experience"), list) else []
        bullet_rules = (rules.get("bullet_rules") if isinstance(rules, dict) else {}) or {}
        rewrite_summary_flag = bool(rules.get("rewrite_summary", True)) if isinstance(rules, dict) else True
        rewrite_exp_raw = rules.get("rewrite_experience_indices") if isinstance(rules, dict) else None

        # Prefer deterministic targets from ATS analysis (if available), so we only rewrite suggested areas.
        if isinstance(ats_hints, dict):
            if isinstance(ats_hints.get("rewrite_summary"), bool):
                rewrite_summary_flag = bool(ats_hints.get("rewrite_summary"))
            if isinstance(ats_hints.get("rewrite_experience_indices"), list):
                rewrite_exp_raw = ats_hints.get("rewrite_experience_indices")
        rewrite_exp_indices: set[int] | None = None
        if isinstance(rewrite_exp_raw, list):
            tmp: set[int] = set()
            for v in rewrite_exp_raw:
                try:
                    i = int(v)
                except Exception:
                    continue
                if i >= 0:
                    tmp.add(i)
            rewrite_exp_indices = tmp

        # If we resumed, reuse previously optimized experience entries for indices we are not rewriting.
        if isinstance(resumed_sections, dict):
            exsec = resumed_sections.get("experience")
            if isinstance(exsec, dict) and exsec.get("status") in ("complete", "skipped"):
                prev_list = exsec.get("content")
                if isinstance(prev_list, list) and prev_list:
                    for i, prev in enumerate(prev_list):
                        if i >= len(exp_in):
                            break
                        if not isinstance(prev, dict) or not isinstance(exp_in[i], dict):
                            continue
                        if rewrite_exp_indices is not None and i in rewrite_exp_indices:
                            continue
                        prev_bullets = prev.get("bullets")
                        if isinstance(prev_bullets, list) and prev_bullets:
                            exp_in[i]["bullets"] = prev_bullets

        parallel_sections = os.getenv("CV_OPTIMIZE_PARALLEL_SECTIONS", "1").strip().lower() not in (
            "0",
            "false",
            "no",
            "off",
        )

        async def run_summary_section() -> None:
            # If summary was already completed in a resumed identical run, don't redo it.
            if isinstance(resumed_sections, dict):
                ssec = resumed_sections.get("summary")
                if isinstance(ssec, dict) and ssec.get("status") == "complete" and isinstance(ssec.get("content"), str):
                    if track:
                        assembly_set_section(
                            job_id=assembly_id,
                            section="summary",
                            status="complete",
                            content=ssec.get("content") or "",
                        )
                        emit_cv_pipeline_event(job_id=assembly_id, event_type="summary.resumed", section="summary")
                    patched["summary"] = ssec.get("content") or ""
                    return
            if not rewrite_summary_flag:
                if track:
                    assembly_set_section(
                        job_id=assembly_id,
                        section="summary",
                        status="complete",
                        content=patched.get("summary") or "",
                    )
                    emit_cv_pipeline_event(job_id=assembly_id, event_type="summary.skipped", section="summary")
                return
            if track:
                assembly_set_section(job_id=assembly_id, section="summary", status="processing")
                emit_cv_pipeline_event(job_id=assembly_id, event_type="summary.processing_started", section="summary")
            progress("rewrite_summary", 60, "Rewriting summary")
            try:
                summary_timeout = float(os.getenv("CV_OPTIMIZE_SUMMARY_TIMEOUT_SECONDS", "180"))
            except Exception:
                summary_timeout = 180.0
            summary_timeout = max(30.0, min(summary_timeout, llm_timeout_seconds))
            try:
                patched["summary"] = await rewrite_summary(
                    base_cv=patched,
                    job_description=jd,
                    summary_rules=(rules.get("summary_rules") if isinstance(rules, dict) else {}) or {},
                    llm_service_url=llm_service_url,
                    timeout=summary_timeout,
                    ats_hints=ats_hints,
                )
            except Exception as e:
                # Don't fail the whole job if summary rewrite times out; keep original summary and continue.
                if track:
                    try:
                        assembly_set_section(
                            job_id=assembly_id,
                            section="summary",
                            status="failed",
                            error=str(e)[:500],
                            content=(patched.get("summary") or ""),
                        )
                        emit_cv_pipeline_event(
                            job_id=assembly_id,
                            event_type="summary.failed",
                            section="summary",
                            extra={"error": str(e)[:200]},
                        )
                    except Exception:
                        pass
                return
            if track:
                assembly_set_section(
                    job_id=assembly_id,
                    section="summary",
                    status="complete",
                    content=patched.get("summary") or "",
                )
                emit_cv_pipeline_event(job_id=assembly_id, event_type="summary.updated", section="summary")

        async def run_experience_section() -> None:
            if track:
                assembly_init_experience_tree(job_id=assembly_id, experience=exp_in)
            if not exp_in:
                if track:
                    emit_cv_pipeline_event(job_id=assembly_id, event_type="experience.updated", section="experience")
                return
            if track:
                emit_cv_pipeline_event(
                    job_id=assembly_id, event_type="experience.processing_started", section="experience"
                )
            progress("rewrite_bullets", 62, f"Rewriting bullets (0/{len(exp_in)})")
            try:
                bullets_timeout = float(os.getenv("CV_OPTIMIZE_BULLETS_TIMEOUT_SECONDS", "240"))
            except Exception:
                bullets_timeout = 240.0
            bullets_timeout = max(30.0, min(bullets_timeout, llm_timeout_seconds))
            await _rewrite_bullets_parallel(
                experience=exp_in,
                jd=jd,
                bullet_rules=bullet_rules if isinstance(bullet_rules, dict) else {},
                llm_service_url=llm_service_url,
                llm_timeout_seconds=bullets_timeout,
                progress=progress,
                ats_hints=ats_hints,
                rewrite_indices=rewrite_exp_indices,
                assembly_job_id=assembly_id if track else None,
            )
            if track:
                snapshot = [
                    {
                        "role": str(x.get("role") or ""),
                        "company": str(x.get("company") or ""),
                        "bullets": list(x.get("bullets") or []) if isinstance(x.get("bullets"), list) else [],
                    }
                    for x in exp_in
                    if isinstance(x, dict)
                ]
                assembly_complete_experience_section(job_id=assembly_id, experience_snapshot=snapshot)
                emit_cv_pipeline_event(job_id=assembly_id, event_type="experience.updated", section="experience")

        if parallel_sections:
            # Section failures should not abort the whole pipeline; we can still render a CV with fallbacks.
            await asyncio.gather(run_summary_section(), run_experience_section(), return_exceptions=True)
        else:
            await run_summary_section()
            await run_experience_section()

        if isinstance(rules, dict):
            _refresh_skills_after_rewrites(patched=patched, rules=rules, ats_hints=ats_hints, progress=progress)

        if track:
            assembly_set_section(
                job_id=assembly_id,
                section="skills",
                status="complete",
                content=list(patched.get("skills") or []),
            )
            emit_cv_pipeline_event(job_id=assembly_id, event_type="skills.refreshed", section="skills")

        final_cv = {
            "name": (patched.get("name") or "").strip(),
            "headline": headline,
            "contact": list(patched.get("contact") or []) if isinstance(patched.get("contact"), list) else [],
            "summary": patched.get("summary") or "",
            "experience": exp_in,
            "skills": patched.get("skills") or [],
            "education": patched.get("education") if isinstance(patched.get("education"), list) else [],
        }

        file_id = uuid.uuid4().hex
        out_dir = _generated_dir(upload_dir)
        out_name = f"ats_optimized_{user_id}_{file_id}.docx"
        out_path = out_dir / out_name

        progress("render_docx", 92, "Rendering deterministic DOCX")
        data = await _render_docx_bytes(final_cv=final_cv, cv_renderer_url=cv_renderer_url)

        progress("write_docx", 96, "Saving DOCX")
        await asyncio.to_thread(out_path.write_bytes, data)

        progress("done", 100, "Done — ready to download")
        suggestions = _summarize_suggestions(rules) if isinstance(rules, dict) else []
        result = {
            "file_id": file_id,
            "abs_path": str(out_path.resolve()),
            "suggestions": suggestions,
            "created_at": datetime.now(timezone.utc),
        }
        if track:
            assembly_finalize(job_id=assembly_id, job_status="complete", final_cv=final_cv)
            emit_cv_pipeline_event(job_id=assembly_id, event_type="cv.assembly_complete")
        return result
    except BaseException as e:
        if track:
            try:
                # Record the failure on any in-flight section for easier debugging in the UI.
                try:
                    assembly_set_section(job_id=assembly_id, section="coordinator", status="failed", error=str(e)[:500])
                    assembly_set_section(job_id=assembly_id, section="summary", status="failed", error=str(e)[:500])
                    assembly_set_section(job_id=assembly_id, section="experience", status="failed", error=str(e)[:500])
                except Exception:
                    pass
                assembly_finalize(job_id=assembly_id, job_status="failed", final_cv=None)
                emit_cv_pipeline_event(job_id=assembly_id, event_type="cv.pipeline_failed", extra={"error": str(e)[:200]})
            except Exception:
                pass
        raise

