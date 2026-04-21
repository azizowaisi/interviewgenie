"""Mongo updates for cv_optimize_jobs (shared by RabbitMQ worker and inline API execution)."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from db import get_cv_optimize_jobs_collection


def _now() -> datetime:
    return datetime.now(timezone.utc)


def cv_format_job_error(exc: BaseException) -> str:
    """Store a human-readable message (Starlette/FastAPI HTTPException detail is not str(exc))."""
    try:
        from starlette.exceptions import HTTPException
    except ImportError:
        return str(exc)[:500]
    if isinstance(exc, HTTPException):
        d = exc.detail
        if isinstance(d, str):
            return d[:500]
        if isinstance(d, dict):
            inner = d.get("detail", d)
            if isinstance(inner, str):
                return inner[:500]
            try:
                return json.dumps(d, default=str)[:500]
            except Exception:
                return str(d)[:500]
        if isinstance(d, list):
            parts: list[str] = []
            for item in d:
                if isinstance(item, dict):
                    msg = item.get("msg") or item.get("message")
                    loc = item.get("loc")
                    if loc is not None and msg is not None:
                        parts.append(f"{loc}: {msg}")
                    elif msg is not None:
                        parts.append(str(msg))
                    else:
                        parts.append(str(item))
                else:
                    parts.append(str(item))
            out = "; ".join(parts)
            return (out[:500] if out else str(exc)[:500])
        return str(d)[:500]
    return str(exc)[:500]


def cv_job_error_to_api(value: Any) -> str | None:
    """Normalize Mongo `error` field for JSON (may be str, dict, or legacy types)."""
    if value is None:
        return None
    if isinstance(value, str):
        return value[:500] if value.strip() else None
    try:
        return json.dumps(value, default=str)[:500]
    except Exception:
        return str(value)[:500]


def cv_job_set(job_id: str, updates: dict[str, Any]) -> None:
    u = dict(updates)
    u.setdefault("updated_at", _now())
    get_cv_optimize_jobs_collection().update_one({"_id": job_id}, {"$set": u})


def cv_job_push_event(job_id: str, stage: str, progress: int, message: str) -> None:
    now = _now()
    ev = {"ts": now, "stage": stage, "progress": int(progress), "message": message}
    get_cv_optimize_jobs_collection().update_one(
        {"_id": job_id},
        {
            "$set": {
                "stage": stage,
                "progress": int(progress),
                "message": message,
                "updated_at": now,
            },
            "$push": {"events": {"$each": [ev], "$slice": -30}},
        },
    )
