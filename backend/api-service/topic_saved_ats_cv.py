"""Persist latest ATS-optimized DOCX per job topic (same job as CV upload on Start)."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from bson import ObjectId

from db import get_generated_downloads_collection, get_topics_collection


def topic_persist_ats_optimized_cv(*, user_id: str, topic_id: str, file_id: str) -> None:
    fid = (file_id or "").strip()
    tid = (topic_id or "").strip()
    if not fid or not tid:
        return
    topics = get_topics_collection()
    topics.update_one(
        {"_id": ObjectId(tid), "user_id": user_id},
        {
            "$set": {
                "ats_optimized_cv_file_id": fid,
                "ats_optimized_cv_at": datetime.now(timezone.utc),
            }
        },
    )


def topic_clear_saved_ats_cv(*, user_id: str, topic_id: str) -> None:
    tid = (topic_id or "").strip()
    if not tid:
        return
    topics = get_topics_collection()
    topics.update_one(
        {"_id": ObjectId(tid), "user_id": user_id},
        {"$unset": {"ats_optimized_cv_file_id": "", "ats_optimized_cv_at": ""}},
    )


def topic_user_references_download_file(*, user_id: str, file_id: str) -> bool:
    fid = (file_id or "").strip()
    if not fid:
        return False
    coll = get_topics_collection()
    return coll.find_one({"user_id": user_id, "ats_optimized_cv_file_id": fid}) is not None


def topic_delete_saved_ats_cv(*, user_id: str, topic_id: str) -> bool:
    """Unset topic fields, delete generated_downloads row, and remove file from disk if present."""
    tid = (topic_id or "").strip()
    if not tid:
        return False
    topics = get_topics_collection()
    try:
        doc = topics.find_one({"_id": ObjectId(tid), "user_id": user_id})
    except Exception:
        doc = None
    if not doc:
        return False
    fid_raw = doc.get("ats_optimized_cv_file_id")
    topic_clear_saved_ats_cv(user_id=user_id, topic_id=tid)
    if not fid_raw or not isinstance(fid_raw, str):
        return True
    fid = fid_raw.strip()
    if not fid:
        return True
    coll = get_generated_downloads_collection()
    row = coll.find_one({"_id": fid, "user_id": user_id})
    if row:
        path = row.get("abs_path")
        if path and isinstance(path, str):
            try:
                os.unlink(path)
            except OSError:
                pass
        coll.delete_one({"_id": fid, "user_id": user_id})
    return True


def topic_resolve_saved_ats_cv_path(*, user_id: str, topic_id: str) -> tuple[str, str] | None:
    """Return (abs_path, file_id) if topic has a saved ATS CV and file exists."""
    tid = (topic_id or "").strip()
    if not tid:
        return None
    topics = get_topics_collection()
    try:
        doc = topics.find_one({"_id": ObjectId(tid), "user_id": user_id})
    except Exception:
        doc = None
    if not doc:
        return None
    fid = doc.get("ats_optimized_cv_file_id")
    if not fid or not isinstance(fid, str):
        return None
    fid = fid.strip()
    if not fid:
        return None
    row = get_generated_downloads_collection().find_one({"_id": fid, "user_id": user_id})
    if not row:
        return None
    path = row.get("abs_path")
    if not path or not isinstance(path, str) or not os.path.isfile(path):
        return None
    return (path, fid)
