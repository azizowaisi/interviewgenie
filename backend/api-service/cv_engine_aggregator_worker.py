"""Consume cv.events and finalize runs when all section nodes are complete."""

from __future__ import annotations

import json
import logging
import os

import pika

from cv_engine_finalize import try_finalize_cv_engine_run
from cv_engine_schema import EXCHANGE_EVENTS

logger = logging.getLogger(__name__)

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@rabbitmq:5672/")
QUEUE_NAME = os.getenv("CV_ENGINE_EVENTS_QUEUE", "cv.engine.events")


def _connect():
    params = pika.URLParameters(RABBITMQ_URL)
    params.socket_timeout = 10
    params.heartbeat = int(os.getenv("RABBITMQ_HEARTBEAT_SECONDS", "0") or 0)
    params.blocked_connection_timeout = int(os.getenv("RABBITMQ_BLOCKED_TIMEOUT_SECONDS", "600"))
    return pika.BlockingConnection(params)


def _ensure_bind(ch) -> None:
    ch.exchange_declare(exchange=EXCHANGE_EVENTS, exchange_type="topic", durable=True)
    ch.queue_declare(queue=QUEUE_NAME, durable=True)
    ch.queue_bind(queue=QUEUE_NAME, exchange=EXCHANGE_EVENTS, routing_key="cv.#")


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
            ch.basic_qos(prefetch_count=8)

            def handle(_ch, method, _props, body: bytes):
                msg = _parse(body)
                rk = method.routing_key or ""
                if not msg:
                    _ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
                    return
                if rk.startswith("cv.assembly."):
                    _ch.basic_ack(delivery_tag=method.delivery_tag)
                    return
                cv_id = msg.get("cv_id")
                if not cv_id:
                    _ch.basic_ack(delivery_tag=method.delivery_tag)
                    return
                try:
                    done = try_finalize_cv_engine_run(str(cv_id))
                    if done:
                        logger.info("cv engine run finalized cv_id=%s", cv_id)
                except Exception:
                    logger.exception("aggregator finalize failed cv_id=%s", cv_id)
                _ch.basic_ack(delivery_tag=method.delivery_tag)

            ch.basic_consume(queue=QUEUE_NAME, on_message_callback=handle, auto_ack=False)
            logger.info("cv-engine-aggregator listening on %s (exchange=%s)", QUEUE_NAME, EXCHANGE_EVENTS)
            ch.start_consuming()
        except Exception:
            logger.exception("cv-engine-aggregator connection loop error; retrying…")


if __name__ == "__main__":
    main()
