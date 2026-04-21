"""Emit CV pipeline events: Mongo (always) + optional RabbitMQ for future microservices."""

from __future__ import annotations

import json
import logging
import os
from typing import Any

from cv_assembly_store import assembly_push_event

logger = logging.getLogger(__name__)

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "")
CV_PIPELINE_EXCHANGE = os.getenv("CV_PIPELINE_EXCHANGE", "cv.pipeline")
CV_PIPELINE_EVENTS_RABBIT = os.getenv("CV_PIPELINE_EVENTS_RABBIT", "").strip().lower() in ("1", "true", "yes", "on")


def emit_cv_pipeline_event(
    *,
    job_id: str,
    event_type: str,
    section: str | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    """Record in Mongo; optionally publish to RabbitMQ for external aggregators."""
    detail = dict(extra or {})
    if section:
        detail["section"] = section
    try:
        assembly_push_event(job_id=job_id, event_type=event_type, detail=detail)
    except Exception:
        logger.exception("assembly_push_event failed for %s", job_id)

    if not CV_PIPELINE_EVENTS_RABBIT or not RABBITMQ_URL:
        return
    payload = {"job_id": job_id, "event": event_type, "section": section, **(extra or {})}
    try:
        import pika

        params = pika.URLParameters(RABBITMQ_URL)
        params.socket_timeout = 5
        conn = pika.BlockingConnection(params)
        try:
            ch = conn.channel()
            ch.exchange_declare(exchange=CV_PIPELINE_EXCHANGE, exchange_type="topic", durable=True)
            body = json.dumps(payload, default=str, ensure_ascii=False)
            rk = event_type.replace(".", "_")
            ch.basic_publish(
                exchange=CV_PIPELINE_EXCHANGE,
                routing_key=rk,
                body=body.encode("utf-8"),
                properties=pika.BasicProperties(content_type="application/json", delivery_mode=1),
            )
        finally:
            try:
                conn.close()
            except Exception:
                pass
    except Exception:
        logger.debug("Rabbit publish skipped or failed for %s", event_type, exc_info=True)
