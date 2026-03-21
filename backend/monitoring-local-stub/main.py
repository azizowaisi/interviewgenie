"""
Minimal monitoring API for local Docker when Kubernetes is not available.
Same routes/shape as backend/monitoring-service so the Next.js /admin UI works.
"""
from __future__ import annotations

from fastapi import FastAPI, Query
from fastapi.responses import PlainTextResponse

app = FastAPI(title="InterviewGenie Monitoring (local stub)", version="0.1.0")


@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.get("/api/config")
def api_config():
    return {
        "namespace": "local-docker",
        "environment_label": "Local (stub)",
        "server_label": "Docker Compose",
        "auth_required": False,
    }


@app.get("/api/cluster")
def api_cluster():
    return {
        "namespace": "local-docker",
        "nodes": [
            {"name": "docker-desktop", "ready": True, "cpu_percent": 12.5, "memory_percent": 48.0},
        ],
        "pods_total": 8,
        "pods_running": 8,
        "pods_failed": 0,
        "metrics_available": False,
    }


@app.get("/api/pods")
def api_pods():
    pods = [
        {"name": "api-service-local", "status": "Running", "restarts": 0, "started_at": None, "cpu": "10m", "memory": "128Mi"},
        {"name": "audio-service-local", "status": "Running", "restarts": 0, "started_at": None, "cpu": "20m", "memory": "256Mi"},
        {"name": "mongo-local", "status": "Running", "restarts": 0, "started_at": None, "cpu": "5m", "memory": "512Mi"},
    ]
    return {"pods": pods}


@app.get("/api/services")
def api_services():
    services = [
        {
            "name": "api-service",
            "type": "ClusterIP",
            "cluster_ip": "10.0.0.1",
            "status": "Running",
            "pods_ready": "1/1",
            "cpu_millicores": 40.0,
            "memory_bytes": 200_000_000,
            "uptime_seconds": 3600,
        },
        {
            "name": "audio-service",
            "type": "ClusterIP",
            "cluster_ip": "10.0.0.2",
            "status": "Running",
            "pods_ready": "1/1",
            "cpu_millicores": 60.0,
            "memory_bytes": 300_000_000,
            "uptime_seconds": 3600,
        },
        {
            "name": "mongo",
            "type": "ClusterIP",
            "cluster_ip": "10.0.0.3",
            "status": "Running",
            "pods_ready": "1/1",
            "cpu_millicores": 20.0,
            "memory_bytes": 400_000_000,
            "uptime_seconds": 7200,
        },
        {
            "name": "ollama",
            "type": "ClusterIP",
            "cluster_ip": "10.0.0.4",
            "status": "Running",
            "pods_ready": "1/1",
            "cpu_millicores": 200.0,
            "memory_bytes": 1_500_000_000,
            "uptime_seconds": 3600,
        },
        {
            "name": "whisper-service",
            "type": "ClusterIP",
            "cluster_ip": "10.0.0.5",
            "status": "Running",
            "pods_ready": "1/1",
            "cpu_millicores": 100.0,
            "memory_bytes": 800_000_000,
            "uptime_seconds": 3600,
        },
    ]
    return {"services": services}


@app.get("/api/logs")
def api_logs(pod: str = Query(...), tail: int = Query(500, ge=1, le=10000)):
    _ = tail
    return PlainTextResponse(
        f"(local stub) Logs for pod `{pod}`.\n"
        "Connect real monitoring-service in Kubernetes for live logs.\n"
    )


@app.post("/api/restart")
def api_restart(deployment: str = Query(...)):
    return {"ok": True, "deployment": deployment, "namespace": "local-docker", "note": "stub — no restart performed"}
