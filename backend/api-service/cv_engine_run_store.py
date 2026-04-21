"""MongoDB source of truth for event-driven CV engine runs."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from bson import ObjectId

from db import get_cv_engine_runs_collection


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _runs():
    return get_cv_engine_runs_collection()


def engine_run_insert(doc: dict[str, Any]) -> str:
    coll = _runs()
    cv_id = doc.get("_id") or uuid.uuid4().hex
    doc["_id"] = cv_id
    doc.setdefault("created_at", _now())
    doc.setdefault("updated_at", _now())
    coll.insert_one(doc)
    return str(cv_id)


def engine_run_replace_document(*, cv_id: str, doc: dict[str, Any]) -> None:
    coll = _runs()
    prev = coll.find_one({"_id": cv_id})
    d = dict(doc)
    d["_id"] = cv_id
    if prev and prev.get("created_at") is not None:
        d["created_at"] = prev["created_at"]
    else:
        d.setdefault("created_at", _now())
    d["updated_at"] = _now()
    coll.replace_one({"_id": cv_id}, d, upsert=True)


def engine_run_get(*, cv_id: str, user_id: str) -> dict[str, Any] | None:
    doc = _runs().find_one({"_id": cv_id, "user_id": user_id})
    return doc


def engine_run_get_by_cv_id(cv_id: str) -> dict[str, Any] | None:
    return _runs().find_one({"_id": cv_id})


def engine_run_set_dotted(*, cv_id: str, fields: dict[str, Any]) -> None:
    s = dict(fields)
    s["updated_at"] = _now()
    _runs().update_one({"_id": cv_id}, {"$set": s})


def engine_run_update(*, cv_id: str, set_fields: dict[str, Any]) -> None:
    s = dict(set_fields)
    s["updated_at"] = _now()
    _runs().update_one({"_id": cv_id}, {"$set": s})


def engine_run_patch_experience_node(*, cv_id: str, node_id: str, set_fields: dict[str, Any]) -> None:
    spec = {f"experience.$[n].{k}": v for k, v in set_fields.items()}
    spec["updated_at"] = _now()
    _runs().update_one({"_id": cv_id}, {"$set": spec}, array_filters=[{"n.id": node_id}])


def serialize_engine_doc(doc: dict[str, Any] | None) -> dict[str, Any] | None:
    if not doc:
        return None
    out = dict(doc)
    if isinstance(out.get("topic_id"), ObjectId):
        out["topic_id"] = str(out["topic_id"])
    for k in ("created_at", "updated_at"):
        ts = out.get(k)
        if hasattr(ts, "isoformat"):
            out[k] = ts.isoformat()
    for node in out.get("experience") or []:
        if isinstance(node, dict) and hasattr(node.get("updated_at"), "isoformat"):
            node["updated_at"] = node["updated_at"].isoformat()
    return out


def build_final_cv_from_state(doc: dict[str, Any]) -> dict[str, Any]:
    """Deterministic merge — no LLM."""
    name = (doc.get("name") or "").strip()
    summary = ""
    if isinstance(doc.get("summary"), dict):
        summary = str(doc["summary"].get("content") or "")
    skills: list[str] = []
    if isinstance(doc.get("skills"), dict) and isinstance(doc["skills"].get("content"), list):
        skills = [str(s) for s in doc["skills"]["content"] if str(s).strip()]
    education: list[Any] = []
    if isinstance(doc.get("education"), dict) and isinstance(doc["education"].get("items"), list):
        education = doc["education"]["items"]
    experience_out: list[dict[str, Any]] = []
    for node in doc.get("experience") or []:
        if not isinstance(node, dict):
            continue
        opt = node.get("optimized")
        raw = node.get("raw")
        block = opt if isinstance(opt, dict) else (raw if isinstance(raw, dict) else {})
        experience_out.append(
            {
                "role": str(block.get("role") or ""),
                "company": str(block.get("company") or ""),
                "bullets": list(block.get("bullets") or []) if isinstance(block.get("bullets"), list) else [],
            }
        )
    return {
        "name": name,
        "summary": summary,
        "skills": skills,
        "experience": experience_out,
        "education": education if isinstance(education, list) else [],
    }
