"""Consume cv.jobs (topic exchange) and run section micro-tasks."""

from __future__ import annotations

import json
import logging
import os

import pika

from cv_engine_job_runner import handle_cv_engine_job_message
from cv_engine_schema import EXCHANGE_JOBS

logger = logging.getLogger(__name__)

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@rabbitmq:5672/")
QUEUE_NAME = os.getenv("CV_ENGINE_JOBS_QUEUE", "cv.engine.jobs")


def _connect():
    params = pika.URLParameters(RABBITMQ_URL)
    params.socket_timeout = 10
    params.heartbeat = int(os.getenv("RABBITMQ_HEARTBEAT_SECONDS", "0") or 0)
    params.blocked_connection_timeout = int(os.getenv("RABBITMQ_BLOCKED_TIMEOUT_SECONDS", "600"))
    return pika.BlockingConnection(params)


def _ensure_bind(ch) -> None:
    ch.exchange_declare(exchange=EXCHANGE_JOBS, exchange_type="topic", durable=True)
    ch.queue_declare(queue=QUEUE_NAME, durable=True)
    ch.queue_bind(queue=QUEUE_NAME, exchange=EXCHANGE_JOBS, routing_key="cv.#")


def _parse(body: bytes) -> dict | None:
    try:
        o = json.loads(body.decode("utf-8"))
        return o if isinstance(o, dict) else None
    except Exception:
        return None


def main():
    logging.basicConfig(level=logging.INFO)
    while True:
        try:
            conn = _connect()
            ch = conn.channel()
            _ensure_bind(ch)
            ch.basic_qos(prefetch_count=int(os.getenv("CV_ENGINE_PREFETCH", "4")))

            def handle(_ch, method, _props, body: bytes):
                msg = _parse(body)
                if not msg:
                    _ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
                    return
                rk = method.routing_key or ""
                try:
                    handle_cv_engine_job_message(routing_key=rk, body=msg)
                    _ch.basic_ack(delivery_tag=method.delivery_tag)
                except Exception:
                    logger.exception("cv engine job failed rk=%s", rk)
                    _ch.basic_nack(delivery_tag=method.delivery_tag, requeue=True)

            ch.basic_consume(queue=QUEUE_NAME, on_message_callback=handle, auto_ack=False)
            logger.info("cv-engine-worker listening on %s (exchange=%s)", QUEUE_NAME, EXCHANGE_JOBS)
            ch.start_consuming()
        except Exception:
            logger.exception("cv-engine-worker connection loop error; retrying…")


if __name__ == "__main__":
    main()
