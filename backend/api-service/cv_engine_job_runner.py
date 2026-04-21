"""Dispatch cv.jobs messages to async section processors (used by cv_engine_worker)."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from cv_engine_tasks import (
    cv_engine_process_education,
    cv_engine_process_experience_node,
    cv_engine_process_skills,
    cv_engine_process_summary,
)

logger = logging.getLogger(__name__)


def handle_cv_engine_job_message(*, routing_key: str, body: dict[str, Any]) -> None:
    cv_id = str(body.get("cv_id") or "")
    if not cv_id:
        logger.warning("cv engine job missing cv_id rk=%s", routing_key)
        return

    async def _run() -> None:
        if routing_key == "cv.summary":
            await cv_engine_process_summary(cv_id)
        elif routing_key == "cv.skills":
            await cv_engine_process_skills(cv_id)
        elif routing_key == "cv.education":
            await cv_engine_process_education(cv_id)
        elif routing_key.startswith("cv.experience."):
            node_id = routing_key.removeprefix("cv.experience.")
            if node_id:
                await cv_engine_process_experience_node(cv_id, node_id)
        else:
            logger.warning("unknown cv.jobs routing_key=%s", routing_key)

    asyncio.run(_run())
