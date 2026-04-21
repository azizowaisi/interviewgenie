"""When every section node is complete, merge deterministic final_cv and mark run complete."""

from __future__ import annotations

import logging
import os
from typing import Any

from cv_engine_rabbit import publish_cv_event
from cv_engine_run_store import build_final_cv_from_state, engine_run_get_by_cv_id, engine_run_set_dotted
from cv_optimize_rules import merge_rule_skills_into_cv

logger = logging.getLogger(__name__)


def _all_nodes_complete(doc: dict[str, Any]) -> bool:
    st = doc.get("summary") if isinstance(doc.get("summary"), dict) else {}
    if (st.get("status") or "") != "complete":
        return False
    sk = doc.get("skills") if isinstance(doc.get("skills"), dict) else {}
    if (sk.get("status") or "") != "complete":
        return False
    ed = doc.get("education") if isinstance(doc.get("education"), dict) else {}
    if (ed.get("status") or "") != "complete":
        return False
    for node in doc.get("experience") or []:
        if not isinstance(node, dict):
            return False
        if (node.get("status") or "") != "complete":
            return False
    return True


def _suggestions_from_rules(rules: dict[str, Any] | None) -> list[str]:
    if not isinstance(rules, dict):
        return []
    out: list[str] = []
    ms = rules.get("missing_skills")
    if isinstance(ms, list) and ms:
        out.append("Consider adding missing skills (if truthful): " + ", ".join(str(x) for x in ms[:8]))
    kp = rules.get("keyword_phrases")
    if isinstance(kp, list) and kp:
        out.append("Keywords to emphasize (if truthful): " + ", ".join(str(x) for x in kp[:8]))
    return out


def try_finalize_cv_engine_run(cv_id: str) -> bool:
    """Return True if this call transitioned the run to complete."""
    doc = engine_run_get_by_cv_id(cv_id)
    if not doc:
        return False
    if (doc.get("status") or "") == "complete":
        return False
    if not _all_nodes_complete(doc):
        return False

    rules = doc.get("rules") if isinstance(doc.get("rules"), dict) else {}
    ats = doc.get("ats_hints") if isinstance(doc.get("ats_hints"), dict) else None

    final_cv = build_final_cv_from_state(doc)
    try:
        merge_rule_skills_into_cv(final_cv, rules, ats)
    except Exception:
        logger.exception("merge_rule_skills_into_cv failed for cv_id=%s", cv_id)

    suggestions = _suggestions_from_rules(rules)
    engine_run_set_dotted(
        cv_id=cv_id,
        fields={
            "status": "complete",
            "final_cv": final_cv,
            "suggestions": suggestions,
        },
    )

    if os.getenv("CV_ENGINE_PUBLISH_EVENTS", "1").strip().lower() not in ("0", "false", "no", "off"):
        try:
            publish_cv_event(
                routing_key="cv.assembly.complete",
                body={"cv_id": cv_id, "section": "assembly"},
            )
        except Exception:
            logger.exception("publish assembly.complete failed cv_id=%s", cv_id)
    return True
