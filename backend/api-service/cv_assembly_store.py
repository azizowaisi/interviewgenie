"""MongoDB-backed CV section assembly state (event-sourced friendly; workers can split later)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from bson import ObjectId

from db import get_cv_assemblies_collection

SECTION_KEYS = ("coordinator", "summary", "skills", "experience", "education")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _empty_section() -> dict[str, Any]:
    return {"status": "pending", "content": None, "error": None, "updated_at": None}


def assembly_create(
    *,
    job_id: str,
    user_id: str,
    topic_id: ObjectId,
    jd_hash: str | None = None,
    base_cv_hash: str | None = None,
) -> None:
    coll = get_cv_assemblies_collection()
    now = _now()
    sections = {k: _empty_section() for k in SECTION_KEYS}
    coll.replace_one(
        {"_id": job_id},
        {
            "_id": job_id,
            "user_id": user_id,
            "topic_id": topic_id,
            "jd_hash": jd_hash,
            "base_cv_hash": base_cv_hash,
            "job_status": "processing",
            "sections": sections,
            "final_cv": None,
            "events": [],
            "created_at": now,
            "updated_at": now,
        },
        upsert=True,
    )


def assembly_set_section(
    *,
    job_id: str,
    section: str,
    status: str,
    content: Any = None,
    error: str | None = None,
) -> None:
    if section not in SECTION_KEYS:
        return
    coll = get_cv_assemblies_collection()
    now = _now()
    doc: dict[str, Any] = {
        f"sections.{section}.status": status,
        f"sections.{section}.updated_at": now,
        "updated_at": now,
    }
    if content is not None:
        doc[f"sections.{section}.content"] = content
    if error is not None:
        doc[f"sections.{section}.error"] = error
    coll.update_one({"_id": job_id}, {"$set": doc})


def assembly_push_event(*, job_id: str, event_type: str, detail: dict[str, Any] | None = None) -> None:
    coll = get_cv_assemblies_collection()
    ev = {"ts": _now(), "type": event_type, "detail": detail or {}}
    coll.update_one(
        {"_id": job_id},
        {"$push": {"events": {"$each": [ev], "$slice": -50}}, "$set": {"updated_at": _now()}},
    )


def assembly_init_experience_tree(*, job_id: str, experience: list[dict[str, Any]]) -> None:
    """Replace ``sections.experience`` with a node tree (one LLM unit per entry)."""
    coll = get_cv_assemblies_collection()
    now = _now()
    items: list[dict[str, Any]] = []
    for i, ex in enumerate(experience):
        if not isinstance(ex, dict):
            continue
        raw_bullets = ex.get("bullets") if isinstance(ex.get("bullets"), list) else []
        bullets = [str(b).strip() for b in raw_bullets if isinstance(b, str) and str(b).strip()]
        items.append(
            {
                "id": f"exp_{i}",
                "status": "pending",
                "raw": {
                    "role": str(ex.get("role") or ""),
                    "company": str(ex.get("company") or ""),
                    "bullets": bullets,
                },
                "optimized": None,
                "error": None,
                "updated_at": None,
            }
        )
    coll.update_one(
        {"_id": job_id},
        {
            "$set": {
                "sections.experience": {
                    "status": "processing" if items else "complete",
                    "content": None,
                    "error": None,
                    "items": items,
                    "updated_at": now,
                },
                "updated_at": now,
            }
        },
    )


def assembly_patch_experience_node(
    *,
    job_id: str,
    node_id: str,
    status: str,
    optimized: dict[str, Any] | None = None,
    error: str | None = None,
) -> None:
    """Update one experience node by stable ``id`` (e.g. ``exp_0``)."""
    coll = get_cv_assemblies_collection()
    now = _now()
    spec: dict[str, Any] = {
        "sections.experience.items.$[n].status": status,
        "sections.experience.items.$[n].updated_at": now,
        "updated_at": now,
    }
    if optimized is not None:
        spec["sections.experience.items.$[n].optimized"] = optimized
    if error is not None:
        spec["sections.experience.items.$[n].error"] = error
    coll.update_one({"_id": job_id}, {"$set": spec}, array_filters=[{"n.id": node_id}])


def assembly_complete_experience_section(*, job_id: str, experience_snapshot: list[dict[str, Any]]) -> None:
    """Mark experience section done and store denormalized list for quick reads / renderer."""
    coll = get_cv_assemblies_collection()
    now = _now()
    coll.update_one(
        {"_id": job_id},
        {
            "$set": {
                "sections.experience.status": "complete",
                "sections.experience.content": experience_snapshot,
                "sections.experience.updated_at": now,
                "updated_at": now,
            }
        },
    )


def assembly_finalize(
    *,
    job_id: str,
    job_status: str,
    final_cv: dict[str, Any] | None,
) -> None:
    coll = get_cv_assemblies_collection()
    coll.update_one(
        {"_id": job_id},
        {
            "$set": {
                "job_status": job_status,
                "final_cv": final_cv,
                "updated_at": _now(),
            }
        },
    )


def assembly_get_for_user(*, job_id: str, user_id: str) -> dict[str, Any] | None:
    coll = get_cv_assemblies_collection()
    doc = coll.find_one({"_id": job_id, "user_id": user_id})
    if not doc:
        return None
    out = dict(doc)
    if isinstance(out.get("topic_id"), ObjectId):
        out["topic_id"] = str(out["topic_id"])
    for k in ("created_at", "updated_at"):
        ts = out.get(k)
        if hasattr(ts, "isoformat"):
            out[k] = ts.isoformat()
    secs = out.get("sections")
    if isinstance(secs, dict):
        for _sk, sec in secs.items():
            if isinstance(sec, dict):
                u = sec.get("updated_at")
                if hasattr(u, "isoformat"):
                    sec["updated_at"] = u.isoformat()
                if _sk == "experience" and isinstance(sec.get("items"), list):
                    for node in sec["items"]:
                        if isinstance(node, dict):
                            nu = node.get("updated_at")
                            if hasattr(nu, "isoformat"):
                                node["updated_at"] = nu.isoformat()
    for e in out.get("events") or []:
        if isinstance(e, dict) and hasattr(e.get("ts"), "isoformat"):
            e["ts"] = e["ts"].isoformat()
    return out


def assembly_find_latest(
    *,
    user_id: str,
    topic_id: ObjectId,
    jd_hash: str | None,
    base_cv_hash: str | None,
) -> dict[str, Any] | None:
    """Find latest assembly for the same topic + fingerprint (for resume)."""
    coll = get_cv_assemblies_collection()
    q: dict[str, Any] = {"user_id": user_id, "topic_id": topic_id}
    if jd_hash is not None:
        q["jd_hash"] = jd_hash
    if base_cv_hash is not None:
        q["base_cv_hash"] = base_cv_hash
    doc = coll.find_one(q, sort=[("updated_at", -1)])
    return doc if isinstance(doc, dict) else None


def assembly_resume_from(
    *,
    job_id: str,
    source_doc: dict[str, Any],
) -> None:
    """Copy completed/skipped section outputs from a previous assembly into a new job."""
    coll = get_cv_assemblies_collection()
    now = _now()
    src_sections = source_doc.get("sections")
    if not isinstance(src_sections, dict):
        return
    merged: dict[str, Any] = {}
    for k in SECTION_KEYS:
        sec = src_sections.get(k)
        if not isinstance(sec, dict):
            continue
        status = sec.get("status")
        if status not in ("complete", "skipped"):
            continue
        merged[k] = sec
        merged[k]["updated_at"] = now
        # don't carry old error forward
        merged[k]["error"] = None
    if not merged:
        return
    coll.update_one(
        {"_id": job_id},
        {
            "$set": {f"sections.{k}": v for k, v in merged.items()} | {"updated_at": now},
            "$push": {
                "events": {"$each": [{"ts": now, "type": "cv.resumed", "detail": {"from": str(source_doc.get("_id"))}}], "$slice": -50}
            },
        },
    )
