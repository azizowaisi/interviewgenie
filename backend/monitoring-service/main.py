"""
Lightweight in-cluster monitoring API + admin UI for k3s/Kubernetes.

Runs inside the cluster with a ServiceAccount; RBAC grants read access to pods,
services, nodes, logs, and patch on allowlisted Deployments. The Vue admin UI is
served from ``static/`` (Vite build) at ``/admin/``.

Environment
-----------
TARGET_NAMESPACE
    Namespace to inspect (default ``interview-ai``).
ADMIN_TOKEN
    If set, all ``/api/*`` routes require ``X-Admin-Token`` or ``Authorization: Bearer``.
    If unset, /api is reachable without auth on the cluster network — use only behind ingress.
DASHBOARD_ENV_LABEL, DASHBOARD_SERVER_LABEL
    Shown in the admin UI header (non-secret).
RESTARTABLE_DEPLOYMENTS
    Comma-separated deployment names allowed for ``POST /api/restart``.

API surface (JSON unless noted)
-------------------------------
GET  /healthz           Liveness.
GET  /api/config        UI labels + whether auth is required.
GET  /api/cluster       Node summary, pod counts, metrics when metrics-server is installed.
GET  /api/infrastructure  Per-node capacity / allocatable / usage (metrics optional).
GET  /api/pods          Pod list with phase, restarts, optional cpu/mem from metrics.
GET  /api/services      Services with endpoint health-style status and aggregated metrics.
GET  /api/logs          Pod logs (query: pod, optional container, tail).
POST /api/restart       Rollout restart for allowlisted deployments only.
"""
from __future__ import annotations

import asyncio
import os
import re
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, PlainTextResponse
from kubernetes import client, config
from kubernetes.client.rest import ApiException
from starlette.staticfiles import StaticFiles

# --- Config (see module docstring) ---
NAMESPACE = os.environ.get("TARGET_NAMESPACE", "interview-ai")
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "").strip()
DASHBOARD_ENV_LABEL = os.environ.get("DASHBOARD_ENV_LABEL", "Production").strip()
DASHBOARD_SERVER_LABEL = os.environ.get("DASHBOARD_SERVER_LABEL", "").strip()
RESTARTABLE = frozenset(
    d.strip()
    for d in os.environ.get(
        "RESTARTABLE_DEPLOYMENTS",
        "api-service,audio-service,stt-service,question-service,llm-service,"
        "formatter-service,monitoring-service,web,ollama",
    ).split(",")
    if d.strip()
)

app = FastAPI(title="InterviewGenie Monitoring", version="1.0.0")

# K8s clients (sync — run in executor)
_core_v1: Optional[client.CoreV1Api] = None
_apps_v1: Optional[client.AppsV1Api] = None
_custom: Optional[client.CustomObjectsApi] = None


def _init_k8s() -> None:
    global _core_v1, _apps_v1, _custom
    try:
        config.load_incluster_config()
    except config.ConfigException:
        config.load_kube_config()
    _core_v1 = client.CoreV1Api()
    _apps_v1 = client.AppsV1Api()
    _custom = client.CustomObjectsApi()


def _run_sync(fn, *args, **kwargs):
    """Run blocking kubernetes-client calls off the asyncio event loop."""
    loop = asyncio.get_event_loop()
    return loop.run_in_executor(None, lambda: fn(*args, **kwargs))


def _parse_quantity_cpu(s: str) -> float:
    """CPU to millicores (float)."""
    if not s:
        return 0.0
    s = s.strip()
    if s.endswith("n"):
        return float(s[:-1]) / 1_000_000.0
    if s.endswith("u"):
        return float(s[:-1]) / 1000.0
    if s.endswith("m"):
        return float(s[:-1])
    return float(s) * 1000.0


def _parse_quantity_mem(s: str) -> int:
    """Memory to bytes (int)."""
    if not s:
        return 0
    s = s.strip()
    mult = 1
    if s.endswith("Ki"):
        mult = 1024
        s = s[:-2]
    elif s.endswith("Mi"):
        mult = 1024**2
        s = s[:-2]
    elif s.endswith("Gi"):
        mult = 1024**3
        s = s[:-2]
    elif s.endswith("K") or s.endswith("k"):
        mult = 1000
        s = s[:-1]
    elif s.endswith("M"):
        mult = 1000**2
        s = s[:-1]
    elif s.endswith("G"):
        mult = 1000**3
        s = s[:-1]
    try:
        return int(float(s) * mult)
    except ValueError:
        return 0


@app.middleware("http")
async def admin_auth(request: Request, call_next):
    if request.url.path.startswith("/api/") and ADMIN_TOKEN:
        token = request.headers.get("x-admin-token") or ""
        auth = request.headers.get("authorization") or ""
        if auth.lower().startswith("bearer "):
            token = auth[7:].strip()
        if token != ADMIN_TOKEN:
            return Response(status_code=401, content="Unauthorized")
    return await call_next(request)


@app.on_event("startup")
async def startup():
    _init_k8s()
    if ADMIN_TOKEN:
        print("monitoring: ADMIN_TOKEN is set — API requires X-Admin-Token or Bearer")
    else:
        print("monitoring: WARNING — ADMIN_TOKEN not set; /api is open to cluster network")


@app.get("/healthz")
async def healthz():
    return {"ok": True}


@app.get("/api/config")
async def api_config():
    """Non-sensitive labels for the admin UI topbar."""
    return {
        "namespace": NAMESPACE,
        "environment_label": DASHBOARD_ENV_LABEL or "Production",
        "server_label": DASHBOARD_SERVER_LABEL or "Kubernetes",
        "auth_required": bool(ADMIN_TOKEN),
    }


async def _pod_metrics_map(ns: str) -> dict[tuple[str, str], dict[str, str]]:
    """Map (pod_name, container_name) -> cpu, memory strings."""
    out: dict[tuple[str, str], dict[str, str]] = {}
    if _custom is None:
        return out
    try:
        obj = await _run_sync(
            _custom.list_namespaced_custom_object,
            "metrics.k8s.io",
            "v1beta1",
            ns,
            "pods",
        )
    except ApiException:
        return out
    for item in obj.get("items", []):
        name = item.get("metadata", {}).get("name", "")
        for c in item.get("containers", []):
            cname = c.get("name", "")
            usage = c.get("usage", {})
            out[(name, cname)] = {
                "cpu": usage.get("cpu", ""),
                "memory": usage.get("memory", ""),
            }
    return out


async def _node_metrics_list() -> list[dict[str, Any]]:
    """Raw metrics.k8s.io Node metrics; empty if metrics-server missing or forbidden."""
    if _custom is None:
        return []
    try:
        obj = await _run_sync(
            _custom.list_cluster_custom_object,
            "metrics.k8s.io",
            "v1beta1",
            "nodes",
        )
    except ApiException:
        return []
    return obj.get("items", [])


@app.get("/api/cluster")
async def api_cluster():
    """High-level cluster snapshot: nodes, pod totals, optional node CPU/mem % from metrics-server."""
    if _core_v1 is None:
        raise HTTPException(503, "K8s not ready")
    pods = await _run_sync(
        _core_v1.list_namespaced_pod, namespace=NAMESPACE, _request_timeout=30
    )
    nodes = await _run_sync(_core_v1.list_node, _request_timeout=30)
    metrics_items = await _node_metrics_list()

    m_by_name = {m["metadata"]["name"]: m for m in metrics_items}

    nodes_out = []
    for n in nodes.items:
        name = n.metadata.name
        ready = any(
            c.type == "Ready" and c.status == "True"
            for c in (n.status.conditions or [])
        )
        alloc_cpu = n.status.allocatable.get("cpu", "0") if n.status.allocatable else "0"
        alloc_mem = n.status.allocatable.get("memory", "0") if n.status.allocatable else "0"
        cpu_m = _parse_quantity_cpu(alloc_cpu)
        mem_b = _parse_quantity_mem(alloc_mem)
        cpu_pct = None
        mem_pct = None
        mi = m_by_name.get(name)
        if mi and cpu_m > 0:
            u = mi.get("usage", {})
            used_cpu = _parse_quantity_cpu(u.get("cpu", "0"))
            cpu_pct = min(100.0, round(100.0 * used_cpu / cpu_m, 1))
        if mi and mem_b > 0:
            u = mi.get("usage", {})
            used_mem = _parse_quantity_mem(u.get("memory", "0"))
            mem_pct = min(100.0, round(100.0 * used_mem / mem_b, 1))

        nodes_out.append(
            {
                "name": name,
                "ready": ready,
                "cpu_percent": cpu_pct,
                "memory_percent": mem_pct,
            }
        )

    def pod_is_failed(p) -> bool:
        if p.status.phase in ("Failed", "Unknown"):
            return True
        for cs in p.status.container_statuses or []:
            w = cs.state.waiting if cs.state else None
            if w and w.reason in (
                "CrashLoopBackOff",
                "ImagePullBackOff",
                "ErrImagePull",
                "CreateContainerConfigError",
            ):
                return True
        return False

    total = len(pods.items)
    running = sum(1 for p in pods.items if p.status.phase == "Running")
    failed = sum(1 for p in pods.items if pod_is_failed(p))

    return {
        "namespace": NAMESPACE,
        "nodes": nodes_out,
        "pods_total": total,
        "pods_running": running,
        "pods_failed": failed,
        "metrics_available": bool(metrics_items),
    }


@app.get("/api/infrastructure")
async def api_infrastructure():
    """Node capacity & allocatable (AWS-console style infra view)."""
    if _core_v1 is None:
        raise HTTPException(503, "K8s not ready")
    nodes = await _run_sync(_core_v1.list_node, _request_timeout=30)
    metrics_items = await _node_metrics_list()
    m_by_name = {m["metadata"]["name"]: m for m in metrics_items}

    out = []
    for n in nodes.items:
        name = n.metadata.name
        ready = any(
            c.type == "Ready" and c.status == "True"
            for c in (n.status.conditions or [])
        )
        cap = n.status.capacity or {}
        alloc = n.status.allocatable or {}
        labels = n.metadata.labels or {}
        ni = n.status.node_info
        alloc_cpu = alloc.get("cpu", "0")
        alloc_mem = alloc.get("memory", "0")
        cpu_m = _parse_quantity_cpu(alloc_cpu)
        mem_b = _parse_quantity_mem(alloc_mem)
        cpu_pct = None
        mem_pct = None
        mi = m_by_name.get(name)
        if mi and cpu_m > 0:
            u = mi.get("usage", {})
            used_cpu = _parse_quantity_cpu(u.get("cpu", "0"))
            cpu_pct = min(100.0, round(100.0 * used_cpu / cpu_m, 1))
        if mi and mem_b > 0:
            u = mi.get("usage", {})
            used_mem = _parse_quantity_mem(u.get("memory", "0"))
            mem_pct = min(100.0, round(100.0 * used_mem / mem_b, 1))

        cap_cpu_raw = cap.get("cpu", "")
        cores_display = cap_cpu_raw
        if cap_cpu_raw and not str(cap_cpu_raw).endswith("m"):
            try:
                cval = float(str(cap_cpu_raw).strip())
                cores_display = f"{int(cval) if cval == int(cval) else cval} cores"
            except ValueError:
                pass

        out.append(
            {
                "name": name,
                "ready": ready,
                "architecture": labels.get("kubernetes.io/arch", ""),
                "instance_type": labels.get("node.kubernetes.io/instance-type", "")
                or labels.get("beta.kubernetes.io/instance-type", ""),
                "os_image": ni.os_image if ni else "",
                "kernel_version": ni.kernel_version if ni else "",
                "kubelet_version": ni.kubelet_version if ni else "",
                "container_runtime": ni.container_runtime_version if ni else "",
                "capacity_cpu": cap_cpu_raw,
                "capacity_cpu_display": cores_display,
                "capacity_memory": cap.get("memory", ""),
                "capacity_memory_bytes": _parse_quantity_mem(cap.get("memory", "0")),
                "capacity_ephemeral_bytes": _parse_quantity_mem(cap.get("ephemeral-storage", "0")),
                "allocatable_cpu": alloc_cpu,
                "allocatable_memory": alloc.get("memory", ""),
                "allocatable_ephemeral_bytes": _parse_quantity_mem(alloc.get("ephemeral-storage", "0")),
                "cpu_percent": cpu_pct,
                "memory_percent": mem_pct,
            }
        )
    return {
        "nodes": out,
        "metrics_available": bool(metrics_items),
    }


@app.get("/api/pods")
async def api_pods():
    """All pods in TARGET_NAMESPACE with status and first-container metrics if available."""
    if _core_v1 is None:
        raise HTTPException(503, "K8s not ready")
    pods = await _run_sync(
        _core_v1.list_namespaced_pod, namespace=NAMESPACE, _request_timeout=30
    )
    mm = await _pod_metrics_map(NAMESPACE)

    rows = []
    for p in pods.items:
        name = p.metadata.name
        phase = p.status.phase or ""
        restarts = 0
        for cs in p.status.container_statuses or []:
            restarts += cs.restart_count or 0
        start = None
        if p.status.start_time:
            start = p.status.start_time.isoformat()
        cpu_s, mem_s = "", ""
        for cs in p.status.container_statuses or []:
            key = (name, cs.name)
            if key in mm:
                cpu_s = mm[key].get("cpu", "")
                mem_s = mm[key].get("memory", "")
                break
        rows.append(
            {
                "name": name,
                "status": phase,
                "restarts": restarts,
                "started_at": start,
                "cpu": cpu_s,
                "memory": mem_s,
            }
        )
    return {"pods": rows}


@app.get("/api/services")
async def api_services():
    """Services matched to pods via spec.selector; derives ready counts and roll-up resource hints."""
    if _core_v1 is None:
        raise HTTPException(503, "K8s not ready")
    svcs = await _run_sync(
        _core_v1.list_namespaced_service, namespace=NAMESPACE, _request_timeout=30
    )
    pods = await _run_sync(
        _core_v1.list_namespaced_pod, namespace=NAMESPACE, _request_timeout=30
    )
    mm = await _pod_metrics_map(NAMESPACE)

    def pod_matches_selector(pod_labels: dict, sel: dict) -> bool:
        if not sel:
            return False
        for k, v in sel.items():
            if pod_labels.get(k) != v:
                return False
        return True

    out = []
    for s in svcs.items:
        name = s.metadata.name
        sel = s.spec.selector or {}
        matching = []
        for p in pods.items:
            labels = p.metadata.labels or {}
            if pod_matches_selector(labels, sel):
                matching.append(p)
        running = sum(1 for p in matching if p.status.phase == "Running")
        unhealthy = any(
            p.status.phase not in ("Running", "Succeeded")
            or any(
                cs.state.waiting and cs.state.waiting.reason == "CrashLoopBackOff"
                for cs in (p.status.container_statuses or [])
            )
            for p in matching
        )
        status = "Running" if matching and running == len(matching) and not unhealthy else (
            "Degraded" if matching else "NoEndpoints"
        )
        if unhealthy:
            status = "CrashLoop" if any(
                any(
                    cs.state.waiting and cs.state.waiting.reason == "CrashLoopBackOff"
                    for cs in (p.status.container_statuses or [])
                )
                for p in matching
            ) else "Degraded"

        total_cpu_m = 0.0
        total_mem_b = 0
        oldest_start = None
        for p in matching:
            if p.status.start_time:
                ts = p.status.start_time
                if oldest_start is None or ts < oldest_start:
                    oldest_start = ts
            for cs in p.status.container_statuses or []:
                key = (p.metadata.name, cs.name)
                if key in mm:
                    total_cpu_m += _parse_quantity_cpu(mm[key].get("cpu", ""))
                    total_mem_b += _parse_quantity_mem(mm[key].get("memory", ""))

        uptime_s = None
        if oldest_start:
            uptime_s = int((datetime.now(timezone.utc) - oldest_start.replace(tzinfo=timezone.utc)).total_seconds())

        out.append(
            {
                "name": name,
                "type": s.spec.type or "ClusterIP",
                "cluster_ip": s.spec.cluster_ip,
                "status": status,
                "pods_ready": f"{running}/{len(matching)}",
                "cpu_millicores": round(total_cpu_m, 1) if total_cpu_m else None,
                "memory_bytes": total_mem_b if total_mem_b else None,
                "uptime_seconds": uptime_s,
            }
        )
    return {"services": sorted(out, key=lambda x: x["name"])}


@app.get("/api/logs")
async def api_logs(
    pod: str = Query(..., description="Pod name"),
    container: Optional[str] = Query(None),
    tail: int = Query(500, ge=1, le=10000),
):
    """Stream recent pod logs; pod name validated to reduce injection risk."""
    if _core_v1 is None:
        raise HTTPException(503, "K8s not ready")
    if not re.match(r"^[a-z0-9]([-a-z0-9]*[a-z0-9])?$", pod, re.I):
        raise HTTPException(400, "Invalid pod name")
    kwargs: dict[str, Any] = {
        "name": pod,
        "namespace": NAMESPACE,
        "tail_lines": tail,
        "timestamps": True,
        "_request_timeout": 60,
    }
    if container:
        kwargs["container"] = container
    try:
        logs = await _run_sync(_core_v1.read_namespaced_pod_log, **kwargs)
    except ApiException as e:
        raise HTTPException(e.status or 502, e.reason or str(e))
    return PlainTextResponse(logs or "(empty)")


@app.post("/api/restart")
async def api_restart(
    deployment: str = Query(..., description="Deployment name"),
    namespace: str = Query(NAMESPACE),
):
    """kubectl rollout restart via patched restartedAt annotation; RESTARTABLE_DEPLOYMENTS only."""
    if _apps_v1 is None:
        raise HTTPException(503, "K8s not ready")
    if namespace != NAMESPACE:
        raise HTTPException(403, "Restart only allowed in configured namespace")
    if deployment not in RESTARTABLE:
        raise HTTPException(403, f"Deployment not in restart allowlist: {deployment}")
    if not re.match(r"^[a-z0-9]([-a-z0-9]*[a-z0-9])?$", deployment, re.I):
        raise HTTPException(400, "Invalid deployment name")
    body = {
        "spec": {
            "template": {
                "metadata": {
                    "annotations": {
                        "kubectl.kubernetes.io/restartedAt": datetime.now(timezone.utc).strftime(
                            "%Y-%m-%dT%H:%M:%SZ"
                        )
                    }
                }
            }
        }
    }
    try:
        await _run_sync(
            _apps_v1.patch_namespaced_deployment,
            name=deployment,
            namespace=namespace,
            body=body,
            _request_timeout=30,
        )
    except ApiException as e:
        raise HTTPException(e.status or 502, e.reason or str(e))
    return {"ok": True, "deployment": deployment, "namespace": namespace}


# --- Static UI (Vite + Vue build → static/index.html + static/assets/*) ---
static_dir = os.path.join(os.path.dirname(__file__), "static")
_admin_assets = os.path.join(static_dir, "assets")
if os.path.isdir(_admin_assets):
    app.mount("/assets", StaticFiles(directory=_admin_assets), name="admin_assets")


@app.get("/admin")
async def admin_redirect():
    from fastapi.responses import RedirectResponse

    return RedirectResponse(url="/admin/", status_code=302)


@app.get("/admin/")
async def admin_index():
    return FileResponse(os.path.join(static_dir, "index.html"))


@app.get("/admin/{path:path}")
async def admin_spa(path: str):
    # Client-side routes; serve index for non-file paths
    if path and "." in path.split("/")[-1]:
        fp = os.path.join(static_dir, path)
        if os.path.isfile(fp):
            return FileResponse(fp)
    return FileResponse(os.path.join(static_dir, "index.html"))


@app.get("/")
async def root():
    return FileResponse(os.path.join(static_dir, "index.html"))
