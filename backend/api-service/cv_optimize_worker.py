from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone

import pika

from cv_optimize_job_mongo import cv_format_job_error, cv_job_push_event, cv_job_set
from cv_optimize_pipeline import optimize_docx_for_topic
from db import get_generated_downloads_collection
from topic_saved_ats_cv import topic_persist_ats_optimized_cv

logger = logging.getLogger(__name__)

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@rabbitmq:5672/")
LLM_SERVICE_URL = os.getenv("LLM_SERVICE_URL", "http://llm-service:8000")
CV_RENDERER_URL = os.getenv("CV_RENDERER_URL", "http://cv-renderer-service:8000")
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "/cv_storage")
LLM_OPTIMIZE_TIMEOUT_SECONDS = float(os.getenv("LLM_OPTIMIZE_TIMEOUT_SECONDS", "300"))

QUEUE_NAME = os.getenv("CV_OPTIMIZE_QUEUE", "cv.optimize.requested")


def _now():
    return datetime.now(timezone.utc)


def _connect():
    params = pika.URLParameters(RABBITMQ_URL)
    # Slightly longer socket timeout to tolerate busy dev laptops.
    params.socket_timeout = 10
    # Callback does long work; disable heartbeat to avoid disconnect mid-job.
    params.heartbeat = int(os.getenv("RABBITMQ_HEARTBEAT_SECONDS", "0"))
    params.blocked_connection_timeout = int(os.getenv("RABBITMQ_BLOCKED_TIMEOUT_SECONDS", "600"))
    return pika.BlockingConnection(params)


def _ensure_queue(ch):
    ch.queue_declare(queue=QUEUE_NAME, durable=True)


def _parse_message(body: bytes) -> dict | None:
    try:
        msg = json.loads(body.decode("utf-8"))
        return msg if isinstance(msg, dict) else None
    except Exception:
        return None


def _extract_fields(msg: dict) -> tuple[str, str, str, str] | None:
    job_id = str(msg.get("job_id") or "")
    user_id = str(msg.get("user_id") or "")
    topic_id = str(msg.get("topic_id") or "")
    job_description = str(msg.get("job_description") or "")
    if not job_id or not user_id or not topic_id:
        return None
    return job_id, user_id, topic_id, job_description


def _complete_job_success(
    job_id: str,
    file_id: str,
    suggestions: list,
    *,
    user_id: str,
    topic_id: str,
    _ch,
    method,
) -> None:
    cv_job_set(
        job_id,
        {
            "status": "done",
            "updated_at": _now(),
            "completed_at": _now(),
            "file_id": file_id,
            "download_url": f"/cv/download/{file_id}",
            "suggestions": suggestions or [],
            "stage": "done",
            "progress": 100,
            "message": "Done — ready to download",
        },
    )
    try:
        topic_persist_ats_optimized_cv(user_id=user_id, topic_id=topic_id, file_id=file_id)
    except Exception:
        logger.exception("Could not persist saved ATS CV for job %s topic=%s", job_id, topic_id)
    logger.info("Job %s done", job_id)
    _ch.basic_ack(delivery_tag=method.delivery_tag)


def _complete_job_failed(job_id: str, exc: Exception, *, _ch, method) -> None:
    logger.exception("Job %s failed: %s", job_id, str(exc)[:200])
    cv_job_set(
        job_id,
        {
            "status": "failed",
            "updated_at": _now(),
            "completed_at": _now(),
            "error": cv_format_job_error(exc),
            "stage": "failed",
            "progress": 100,
            "message": "Failed",
        },
    )
    _ch.basic_ack(delivery_tag=method.delivery_tag)


def main():
    logging.basicConfig(level=logging.INFO)
    while True:
        try:
            conn = _connect()
            ch = conn.channel()
            _ensure_queue(ch)
            ch.basic_qos(prefetch_count=1)

            def handle(_ch, method, _props, body: bytes):
                msg = _parse_message(body)
                if not msg:
                    logger.warning("Bad message body, rejecting")
                    _ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
                    return

                fields = _extract_fields(msg)
                if not fields:
                    logger.warning("Missing fields in message, rejecting: %s", msg)
                    _ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
                    return
                job_id, user_id, topic_id, job_description = fields

                logger.info("Job %s started (topic=%s)", job_id, topic_id)
                cv_job_set(job_id, {"status": "running", "started_at": _now(), "updated_at": _now(), "error": None})
                cv_job_push_event(job_id, "starting", 5, "Worker picked up the job")
                try:
                    result = _run(job_id, user_id, topic_id, job_description)
                    _complete_job_success(
                        job_id,
                        str(result["file_id"]),
                        result.get("suggestions") or [],
                        user_id=user_id,
                        topic_id=topic_id,
                        _ch=_ch,
                        method=method,
                    )
                except Exception as e:
                    _complete_job_failed(job_id, e, _ch=_ch, method=method)

            ch.basic_consume(queue=QUEUE_NAME, on_message_callback=handle, auto_ack=False)
            logger.info("Worker consuming queue=%s", QUEUE_NAME)
            ch.start_consuming()
        except Exception as e:
            logger.exception("Worker loop error: %s", str(e)[:200])
            time.sleep(2)


def _run(job_id: str, user_id: str, topic_id: str, job_description: str):
    import asyncio

    async def run_async():
        def on_progress(stage: str, pct: int, message: str):
            cv_job_push_event(job_id, stage, pct, message)

        return await optimize_docx_for_topic(
            user_id=user_id,
            topic_id=topic_id,
            job_description=job_description,
            llm_service_url=LLM_SERVICE_URL,
            llm_timeout_seconds=LLM_OPTIMIZE_TIMEOUT_SECONDS,
            cv_renderer_url=CV_RENDERER_URL,
            upload_dir=UPLOAD_DIR,
            on_progress=on_progress,
            pipeline_job_id=job_id,
        )

    result = asyncio.run(run_async())
    # Persist download mapping so api-service can serve it later.
    downloads = get_generated_downloads_collection()
    downloads.replace_one(
        {"_id": result["file_id"]},
        {"_id": result["file_id"], "user_id": user_id, "abs_path": result["abs_path"], "created_at": result["created_at"]},
        upsert=True,
    )
    return result


if __name__ == "__main__":
    main()

