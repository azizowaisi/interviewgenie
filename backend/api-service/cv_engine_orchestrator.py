"""Bootstrap CV engine run: parse DOCX, coordinator rules LLM, Mongo state tree, Rabbit (or inline) dispatch."""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Any

from bson import ObjectId
from fastapi import HTTPException

from cv_docx_optimizer import docx_bytes_to_structure
from cv_engine_finalize import try_finalize_cv_engine_run
from cv_engine_rabbit import publish_cv_job
from cv_engine_run_store import engine_run_get_by_cv_id, engine_run_insert, engine_run_replace_document, engine_run_set_dotted
from cv_engine_tasks import run_all_cv_engine_tasks_inline
from cv_optimize_pipeline import (
    _fetch_latest_ats_hints,
    _generate_rules_with_progress,
    _load_docx_bytes_or_422,
    _load_topic_or_404,
    _progress_cb,
    _resolve_job_description,
    _require_cv_id,
    _load_cv_doc_or_404,
)
from cv_optimize_rules import apply_rules
from db import get_cvs_collection, get_topics_collection

logger = logging.getLogger(__name__)


def _base_cv_from_structure(structure: dict[str, Any]) -> dict[str, Any]:
    edu = structure.get("education")
    return {
        "name": (structure.get("name") or "").strip(),
        "summary": structure.get("summary") or "",
        "experience": structure.get("experience") or [],
        "skills": structure.get("skills") or [],
        "education": edu if isinstance(edu, list) else [],
    }


def _experience_nodes_from_patched(experience: list[Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for i, it in enumerate(experience or []):
        if not isinstance(it, dict):
            continue
        nid = f"exp_{i + 1}"
        role = str(it.get("role") or "")
        company = str(it.get("company") or "")
        bullets = it.get("bullets") if isinstance(it.get("bullets"), list) else []
        raw = {"role": role, "company": company, "bullets": list(bullets)}
        out.append({"id": nid, "raw": raw, "optimized": {}, "status": "pending"})
    return out


def _publish_section_jobs(cv_id: str) -> None:
    publish_cv_job(routing_key="cv.summary", body={"cv_id": cv_id, "section": "summary", "sub_id": None, "data": {}})
    publish_cv_job(routing_key="cv.skills", body={"cv_id": cv_id, "section": "skills", "sub_id": None, "data": {}})
    publish_cv_job(routing_key="cv.education", body={"cv_id": cv_id, "section": "education", "sub_id": None, "data": {}})
    doc = engine_run_get_by_cv_id(cv_id)
    if not doc:
        return
    for n in doc.get("experience") or []:
        if isinstance(n, dict) and n.get("id"):
            nid = str(n["id"])
            publish_cv_job(
                routing_key=f"cv.experience.{nid}",
                body={"cv_id": cv_id, "section": "experience", "sub_id": nid, "data": {}},
            )


async def bootstrap_cv_engine_run(
    *,
    cv_id: str,
    user_id: str,
    topic_id: str,
    job_description: str,
    llm_service_url: str,
    llm_timeout_seconds: float,
) -> None:
    progress = _progress_cb(None)
    topics = get_topics_collection()
    cvs = get_cvs_collection()
    tid = (topic_id or "").strip()

    try:
        engine_run_set_dotted(cv_id=cv_id, fields={"status": "loading"})

        topic_doc = _load_topic_or_404(topics=topics, tid=tid, user_id=user_id)
        jd = _resolve_job_description(input_jd=job_description, topic_doc=topic_doc)
        ats_hints = _fetch_latest_ats_hints(user_id, tid)

        tid_oid = topic_doc.get("_id")
        if tid_oid is None:
            tid_oid = ObjectId(tid)

        cv_oid = _require_cv_id(topic_doc, progress=progress)
        cv_doc = _load_cv_doc_or_404(cvs=cvs, cv_oid=cv_oid, user_id=user_id)
        data = await _load_docx_bytes_or_422(cv_doc=cv_doc)
        structure = await asyncio.to_thread(docx_bytes_to_structure, data)
        base_cv = _base_cv_from_structure(structure)

        rules = await _generate_rules_with_progress(
            base_cv=base_cv,
            jd=jd,
            llm_service_url=llm_service_url,
            llm_timeout_seconds=llm_timeout_seconds,
            progress=progress,
            ats_hints=ats_hints,
        )
        patched = apply_rules(base_cv, rules, ats_hints)
        exp_in = patched.get("experience") if isinstance(patched.get("experience"), list) else []
        exp_nodes = _experience_nodes_from_patched(exp_in)

        edu = patched.get("education") if isinstance(patched.get("education"), list) else []

        full_doc: dict[str, Any] = {
            "_id": cv_id,
            "user_id": user_id,
            "topic_id": tid_oid,
            "job_description": jd,
            "name": (patched.get("name") or "").strip(),
            "rules": rules,
            "ats_hints": ats_hints or {},
            "summary": {"content": str(patched.get("summary") or ""), "status": "pending"},
            "skills": {
                "content": list(patched.get("skills") or []) if isinstance(patched.get("skills"), list) else [],
                "status": "pending",
            },
            "education": {"items": edu, "status": "pending"},
            "experience": exp_nodes,
            "final_cv": None,
            "suggestions": [],
            "status": "processing",
            "error": None,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
        }

        engine_run_replace_document(cv_id=cv_id, doc=full_doc)

        mode = os.getenv("CV_ENGINE_EXECUTION_MODE", "queue").strip().lower()
        if mode in ("inline", "sync", "local"):
            await run_all_cv_engine_tasks_inline(cv_id)
            try_finalize_cv_engine_run(cv_id)
        else:
            await asyncio.to_thread(_publish_section_jobs, cv_id)
    except HTTPException as he:
        msg = he.detail if isinstance(he.detail, str) else str(he.detail)
        logger.warning("bootstrap_cv_engine_run HTTP error cv_id=%s: %s", cv_id, msg[:200])
        engine_run_set_dotted(cv_id=cv_id, fields={"status": "failed", "error": msg[:800]})
    except Exception as e:
        logger.exception("bootstrap_cv_engine_run failed cv_id=%s", cv_id)
        engine_run_set_dotted(
            cv_id=cv_id,
            fields={"status": "failed", "error": str(e)[:800]},
        )


def insert_bootstrapping_placeholder(
    *,
    cv_id: str,
    user_id: str,
    topic_id: str,
) -> None:
    try:
        tid_oid = ObjectId(topic_id)
    except Exception:
        tid_oid = topic_id
    engine_run_insert(
        {
            "_id": cv_id,
            "user_id": user_id,
            "topic_id": tid_oid,
            "status": "bootstrapping",
            "summary": {"content": "", "status": "pending"},
            "skills": {"content": [], "status": "pending"},
            "education": {"items": [], "status": "pending"},
            "experience": [],
            "rules": {},
            "ats_hints": {},
            "job_description": "",
            "name": "",
            "final_cv": None,
            "suggestions": [],
            "error": None,
        }
    )
