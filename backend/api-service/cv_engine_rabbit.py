"""Publish CV engine jobs and events to RabbitMQ (topic exchanges)."""

from __future__ import annotations

import json
import logging
import os
from typing import Any

import pika

from cv_engine_schema import EXCHANGE_EVENTS, EXCHANGE_JOBS

logger = logging.getLogger(__name__)

RABBITMQ_URL = os.getenv("RABBITMQ_URL", "amqp://guest:guest@rabbitmq:5672/")


def _declare_exchanges(ch: Any) -> None:
    ch.exchange_declare(exchange=EXCHANGE_JOBS, exchange_type="topic", durable=True)
    ch.exchange_declare(exchange=EXCHANGE_EVENTS, exchange_type="topic", durable=True)


def publish_cv_job(*, routing_key: str, body: dict[str, Any]) -> None:
    payload = json.dumps(body, ensure_ascii=False, default=str)
    params = pika.URLParameters(RABBITMQ_URL)
    params.socket_timeout = 10
    params.heartbeat = int(os.getenv("RABBITMQ_HEARTBEAT_SECONDS", "0") or 0)
    conn = pika.BlockingConnection(params)
    try:
        ch = conn.channel()
        _declare_exchanges(ch)
        ch.basic_publish(
            exchange=EXCHANGE_JOBS,
            routing_key=routing_key,
            body=payload.encode("utf-8"),
            properties=pika.BasicProperties(content_type="application/json", delivery_mode=2),
        )
    finally:
        try:
            conn.close()
        except Exception:
            pass


def publish_cv_event(*, routing_key: str, body: dict[str, Any]) -> None:
    payload = json.dumps(body, ensure_ascii=False, default=str)
    params = pika.URLParameters(RABBITMQ_URL)
    params.socket_timeout = 10
    conn = pika.BlockingConnection(params)
    try:
        ch = conn.channel()
        _declare_exchanges(ch)
        ch.basic_publish(
            exchange=EXCHANGE_EVENTS,
            routing_key=routing_key,
            body=payload.encode("utf-8"),
            properties=pika.BasicProperties(content_type="application/json", delivery_mode=1),
        )
    finally:
        try:
            conn.close()
        except Exception:
            pass
