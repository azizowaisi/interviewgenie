"""Async micro-tasks per CV section (Mongo source of truth + optional Rabbit events)."""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

from cv_engine_rabbit import publish_cv_event
from cv_engine_run_store import (
    build_final_cv_from_state,
    engine_run_get_by_cv_id,
    engine_run_patch_experience_node,
    engine_run_set_dotted,
)
from cv_llm_rewrite import rewrite_bullets_batch, rewrite_summary
from cv_optimize_rules import merge_rule_skills_into_cv

logger = logging.getLogger(__name__)

LLM_SERVICE_URL = os.getenv("LLM_SERVICE_URL", "http://llm-service:8000")

try:
    LLM_TIMEOUT = float(os.getenv("CV_ENGINE_LLM_TIMEOUT_SECONDS", os.getenv("LLM_OPTIMIZE_TIMEOUT_SECONDS", "300")))
except Exception:
    LLM_TIMEOUT = 300.0


def _publish_updated(routing_key: str, cv_id: str, section: str, sub_id: str | None = None) -> None:
    if os.getenv("CV_ENGINE_PUBLISH_EVENTS", "1").strip().lower() in ("0", "false", "no", "off"):
        return
    body: dict[str, Any] = {"cv_id": cv_id, "section": section}
    if sub_id:
        body["sub_id"] = sub_id
    try:
        publish_cv_event(routing_key=routing_key, body=body)
    except Exception:
        logger.exception("publish event %s failed cv_id=%s", routing_key, cv_id)


def _base_cv_slice_for_summary(doc: dict[str, Any]) -> dict[str, Any]:
    name = (doc.get("name") or "").strip()
    sm = doc.get("summary") if isinstance(doc.get("summary"), dict) else {}
    sk = doc.get("skills") if isinstance(doc.get("skills"), dict) else {}
    summary = str(sm.get("content") or "")
    skills = sk.get("content") if isinstance(sk.get("content"), list) else []
    return {
        "name": name,
        "summary": summary,
        "skills": [str(s) for s in skills if str(s).strip()],
    }


def _synthetic_cv_for_skills(doc: dict[str, Any]) -> dict[str, Any]:
    """Approximate full CV text for skill merge (parallel-safe best-effort)."""
    partial = build_final_cv_from_state(doc)
    return {
        "name": partial.get("name") or "",
        "summary": partial.get("summary") or "",
        "skills": partial.get("skills") or [],
        "experience": partial.get("experience") or [],
        "education": partial.get("education") or [],
    }


async def cv_engine_process_summary(cv_id: str) -> None:
    doc = engine_run_get_by_cv_id(cv_id)
    if not doc:
        return
    sm = doc.get("summary") if isinstance(doc.get("summary"), dict) else {}
    if (sm.get("status") or "") == "complete":
        return
    engine_run_set_dotted(cv_id=cv_id, fields={"summary.status": "processing"})
    jd = str(doc.get("job_description") or "")
    rules = doc.get("rules") if isinstance(doc.get("rules"), dict) else {}
    summary_rules = (rules.get("summary_rules") if isinstance(rules.get("summary_rules"), dict) else {}) or {}
    ats = doc.get("ats_hints") if isinstance(doc.get("ats_hints"), dict) else None
    base = _base_cv_slice_for_summary(doc)
    try:
        out = await rewrite_summary(
            base_cv=base,
            job_description=jd,
            summary_rules=summary_rules,
            llm_service_url=LLM_SERVICE_URL,
            timeout=LLM_TIMEOUT,
            ats_hints=ats,
        )
    except Exception as e:
        logger.exception("summary LLM failed cv_id=%s", cv_id)
        out = str(base.get("summary") or "")
        engine_run_set_dotted(cv_id=cv_id, fields={"summary.error": str(e)[:500]})
    engine_run_set_dotted(
        cv_id=cv_id,
        fields={"summary.content": (out or "").strip(), "summary.status": "complete"},
    )
    _publish_updated("cv.summary.updated", cv_id, "summary")


async def cv_engine_process_skills(cv_id: str) -> None:
    doc = engine_run_get_by_cv_id(cv_id)
    if not doc:
        return
    sk = doc.get("skills") if isinstance(doc.get("skills"), dict) else {}
    if (sk.get("status") or "") == "complete":
        return
    engine_run_set_dotted(cv_id=cv_id, fields={"skills.status": "processing"})
    rules = doc.get("rules") if isinstance(doc.get("rules"), dict) else {}
    ats = doc.get("ats_hints") if isinstance(doc.get("ats_hints"), dict) else None
    synth = _synthetic_cv_for_skills(doc)
    try:
        merge_rule_skills_into_cv(synth, rules, ats)
        content = synth.get("skills") if isinstance(synth.get("skills"), list) else []
        cleaned = [str(s).strip() for s in content if str(s).strip()]
    except Exception as e:
        logger.exception("skills merge failed cv_id=%s", cv_id)
        prev = sk.get("content") if isinstance(sk.get("content"), list) else []
        cleaned = [str(s).strip() for s in prev if str(s).strip()]
        engine_run_set_dotted(cv_id=cv_id, fields={"skills.error": str(e)[:500]})
    engine_run_set_dotted(
        cv_id=cv_id,
        fields={"skills.content": cleaned, "skills.status": "complete"},
    )
    _publish_updated("cv.skills.updated", cv_id, "skills")


async def cv_engine_process_education(cv_id: str) -> None:
    doc = engine_run_get_by_cv_id(cv_id)
    if not doc:
        return
    ed = doc.get("education") if isinstance(doc.get("education"), dict) else {}
    if (ed.get("status") or "") == "complete":
        return
    engine_run_set_dotted(cv_id=cv_id, fields={"education.status": "processing"})
    items = ed.get("items") if isinstance(ed.get("items"), list) else []
    # Deterministic only: keep list order; strip empty entries if strings
    kept: list[Any] = []
    for it in items:
        if isinstance(it, str):
            s = it.strip()
            if s:
                kept.append(s)
        elif isinstance(it, dict):
            kept.append(it)
        else:
            kept.append(it)
    engine_run_set_dotted(cv_id=cv_id, fields={"education.items": kept, "education.status": "complete"})
    _publish_updated("cv.education.updated", cv_id, "education")


async def cv_engine_process_experience_node(cv_id: str, node_id: str) -> None:
    doc = engine_run_get_by_cv_id(cv_id)
    if not doc:
        return
    node: dict[str, Any] | None = None
    for n in doc.get("experience") or []:
        if isinstance(n, dict) and str(n.get("id") or "") == node_id:
            node = n
            break
    if not node:
        return
    if (node.get("status") or "") == "complete":
        return
    engine_run_patch_experience_node(cv_id=cv_id, node_id=node_id, set_fields={"status": "processing"})
    raw = node.get("raw") if isinstance(node.get("raw"), dict) else {}
    role = str(raw.get("role") or "")
    company = str(raw.get("company") or "")
    bullets = raw.get("bullets") if isinstance(raw.get("bullets"), list) else []
    jd = str(doc.get("job_description") or "")
    rules = doc.get("rules") if isinstance(doc.get("rules"), dict) else {}
    bullet_rules = (rules.get("bullet_rules") if isinstance(rules.get("bullet_rules"), dict) else {}) or {}
    ats = doc.get("ats_hints") if isinstance(doc.get("ats_hints"), dict) else None
    try:
        out_bullets = await rewrite_bullets_batch(
            role=role,
            company=company,
            bullets=bullets,
            job_description=jd,
            bullet_rules=bullet_rules,
            llm_service_url=LLM_SERVICE_URL,
            timeout=LLM_TIMEOUT,
            ats_hints=ats,
        )
    except Exception as e:
        logger.exception("experience LLM failed cv_id=%s node=%s", cv_id, node_id)
        out_bullets = [str(b).strip() for b in bullets if isinstance(b, str) and str(b).strip()]
        engine_run_patch_experience_node(
            cv_id=cv_id,
            node_id=node_id,
            set_fields={"error": str(e)[:500]},
        )
    engine_run_patch_experience_node(
        cv_id=cv_id,
        node_id=node_id,
        set_fields={
            "optimized": {"role": role, "company": company, "bullets": out_bullets},
            "status": "complete",
        },
    )
    _publish_updated(f"cv.experience.{node_id}.updated", cv_id, "experience", sub_id=node_id)


async def run_all_cv_engine_tasks_inline(cv_id: str) -> None:
    doc = engine_run_get_by_cv_id(cv_id)
    if not doc:
        return
    exp_ids: list[str] = []
    for n in doc.get("experience") or []:
        if isinstance(n, dict) and n.get("id"):
            exp_ids.append(str(n["id"]))
    await asyncio.gather(
        cv_engine_process_summary(cv_id),
        cv_engine_process_skills(cv_id),
        cv_engine_process_education(cv_id),
        *[cv_engine_process_experience_node(cv_id, nid) for nid in exp_ids],
    )
