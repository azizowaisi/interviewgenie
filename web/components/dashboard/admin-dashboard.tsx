"use client";

import { useCallback, useEffect, useState } from "react";
import { monFetch, monRequestInit } from "@/lib/api-fetch";
import { MONITORING_ADMIN_TOKEN_LS, readClientMonitoringToken } from "@/lib/monitoring-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Activity, Cpu, HardDrive, RefreshCw, Server, ScrollText, Boxes } from "lucide-react";
import { publicAppUrl } from "@/lib/public-urls";

const RESTART_DEPLOYMENTS = [
  "api-service",
  "audio-service",
  "stt-service",
  "question-service",
  "llm-service",
  "formatter-service",
  "monitoring-service",
  "web",
  "ollama",
] as const;

const SERVICE_LABELS: Record<string, string> = {
  "api-service": "Backend",
  "audio-service": "Audio pipeline",
  web: "Web",
  "frontend": "Frontend",
  "mongo": "MongoDB",
  "mongodb": "MongoDB",
  "ollama": "Ollama",
  "whisper-service": "Whisper",
  "stt-service": "STT",
  "question-service": "Question",
  "llm-service": "LLM",
  "formatter-service": "Formatter",
  "monitoring-service": "Monitoring",
};

function formatBytes(n: number | null | undefined) {
  if (n == null || n <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

function formatCpuMillis(m: number | null | undefined) {
  if (m == null || m <= 0) return "—";
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(2)} cores`;
}

function UsageBar({ pct }: { pct: number | null | undefined }) {
  if (pct == null || Number.isNaN(pct)) {
    return <div className="mt-1 h-1.5 w-full max-w-[12rem] rounded bg-muted" />;
  }
  const p = Math.min(100, Math.max(0, pct));
  return (
    <div className="mt-1 h-1.5 w-full max-w-[12rem] overflow-hidden rounded bg-muted">
      <div className="h-full bg-primary transition-all" style={{ width: `${p}%` }} />
    </div>
  );
}

type Cluster = {
  nodes?: { name: string; cpu_percent?: number | null; memory_percent?: number | null }[];
  pods_total?: number;
  pods_running?: number;
  pods_failed?: number;
  /** From monitoring API: false when metrics.k8s.io (metrics-server) has no data */
  metrics_available?: boolean;
  namespace_requests_cpu_millicores?: number;
  namespace_requests_memory_bytes?: number;
  namespace_limits_cpu_millicores?: number;
  namespace_limits_memory_bytes?: number;
};

type InfraSummary = {
  nodes_total: number;
  nodes_ready: number;
  allocatable_cpu_millicores_total: number;
  allocatable_memory_bytes_total: number;
  capacity_ephemeral_bytes_total: number;
  allocatable_ephemeral_bytes_total: number;
  used_cpu_millicores_total?: number | null;
  used_memory_bytes_total?: number | null;
  remaining_cpu_millicores_total?: number | null;
  remaining_memory_bytes_total?: number | null;
};

type InfraNode = {
  name: string;
  ready: boolean;
  instance_type?: string;
  capacity_cpu_display?: string;
  allocatable_cpu_millicores?: number;
  allocatable_memory_bytes?: number;
  used_cpu_millicores?: number | null;
  used_memory_bytes?: number | null;
  remaining_cpu_millicores?: number | null;
  remaining_memory_bytes?: number | null;
  cpu_percent?: number | null;
  memory_percent?: number | null;
  allocatable_ephemeral_bytes?: number;
};

type InfraPayload = {
  nodes: InfraNode[];
  summary: InfraSummary;
  metrics_available?: boolean;
  note_ephemeral?: string;
};

function isValidClusterPayload(data: unknown): data is Cluster {
  if (data == null || typeof data !== "object") return false;
  const o = data as Record<string, unknown>;
  return (
    typeof o.pods_total === "number" &&
    typeof o.pods_running === "number" &&
    typeof o.pods_failed === "number" &&
    Array.isArray(o.nodes)
  );
}

type MonEndpointsOk = { cluster: boolean; pods: boolean; services: boolean; config: boolean; infrastructure: boolean };

type PodRow = {
  name: string;
  node?: string;
  status: string;
  cpu: string;
  memory: string;
  usage_cpu_millicores?: number | null;
  usage_memory_bytes?: number | null;
  requests_cpu_millicores?: number;
  requests_memory_bytes?: number;
  limits_cpu_millicores?: number;
  limits_memory_bytes?: number;
};
type SvcRow = {
  name: string;
  status: string;
  cpu_millicores?: number | null;
  memory_bytes?: number | null;
  pods_ready?: string;
};

export function AdminDashboard() {
  const [cluster, setCluster] = useState<Cluster | null>(null);
  const [infra, setInfra] = useState<InfraPayload | null>(null);
  const [pods, setPods] = useState<PodRow[]>([]);
  const [services, setServices] = useState<SvcRow[]>([]);
  const [config, setConfig] = useState<{ environment_label?: string; namespace?: string } | null>(null);
  const [logs, setLogs] = useState("");
  const [logPod, setLogPod] = useState("");
  const [restartDep, setRestartDep] = useState<string>(RESTART_DEPLOYMENTS[0]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [monOk, setMonOk] = useState<MonEndpointsOk>({
    cluster: false,
    pods: false,
    services: false,
    config: false,
    infrastructure: false,
  });
  const [adminTokenDraft, setAdminTokenDraft] = useState("");

  useEffect(() => {
    setAdminTokenDraft(readClientMonitoringToken());
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const [c, p, s, cfg, inf] = await Promise.all([
        monFetch("cluster"),
        monFetch("pods"),
        monFetch("services"),
        monFetch("config"),
        monFetch("infrastructure"),
      ]);
      const errs: string[] = [];
      const nextOk: MonEndpointsOk = {
        cluster: false,
        pods: false,
        services: false,
        config: false,
        infrastructure: false,
      };

      if (c.ok) {
        try {
          const raw = await c.json();
          if (isValidClusterPayload(raw)) {
            setCluster(raw);
            nextOk.cluster = true;
          } else {
            setCluster(null);
            errs.push("cluster: invalid or empty JSON (expected pods_total, pods_running, pods_failed, nodes[])");
          }
        } catch {
          setCluster(null);
          errs.push("cluster: response was not JSON");
        }
      } else {
        setCluster(null);
        errs.push(`cluster HTTP ${c.status}`);
      }

      if (p.ok) {
        try {
          const j = (await p.json()) as { pods?: PodRow[] };
          const list = j.pods || [];
          setPods(list);
          setLogPod((prev) => prev || list[0]?.name || "");
          nextOk.pods = true;
        } catch {
          setPods([]);
          errs.push("pods: response was not JSON");
        }
      } else {
        setPods([]);
        errs.push(`pods HTTP ${p.status}`);
      }

      if (s.ok) {
        try {
          const j = (await s.json()) as { services?: SvcRow[] };
          setServices(j.services || []);
          nextOk.services = true;
        } catch {
          setServices([]);
          errs.push("services: response was not JSON");
        }
      } else {
        setServices([]);
        errs.push(`services HTTP ${s.status}`);
      }

      if (cfg.ok) {
        try {
          setConfig(await cfg.json());
          nextOk.config = true;
        } catch {
          setConfig(null);
          errs.push("config: response was not JSON");
        }
      } else {
        setConfig(null);
        errs.push(`config HTTP ${cfg.status}`);
      }

      if (inf.ok) {
        try {
          const raw = (await inf.json()) as InfraPayload;
          if (raw && Array.isArray(raw.nodes) && raw.summary) {
            setInfra(raw);
            nextOk.infrastructure = true;
          } else {
            setInfra(null);
            errs.push("infrastructure: invalid JSON shape");
          }
        } catch {
          setInfra(null);
          errs.push("infrastructure: response was not JSON");
        }
      } else {
        setInfra(null);
        errs.push(`infrastructure HTTP ${inf.status}`);
      }

      setMonOk(nextOk);

      if (errs.length) {
        const hint401 =
          errs.some((e) => e.includes("401")) || c.status === 401 || cfg.status === 401
            ? " If the monitoring API uses a token: paste the same value as Secret monitoring-admin key ADMIN_TOKEN below (stored in this browser), or set MONITORING_ADMIN_TOKEN on the web Deployment and restart the web pod."
            : "";
        const hintUpstream =
          !hint401 && errs.some((e) => /HTTP (502|503|504)/.test(e))
            ? " The Next.js BFF could not reach monitoring-service — check web env MONITORING_URL (e.g. http://monitoring-service:3001) and that the monitoring-service pod is running."
            : "";
        setMsg(`${errs.join(". ")}.${hint401}${hintUpstream}`);
      }
    } catch (e) {
      setMonOk({ cluster: false, pods: false, services: false, config: false, infrastructure: false });
      setMsg(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const nodes = cluster?.nodes || [];
  const withCpu = nodes.filter((n) => n.cpu_percent != null);
  const withMem = nodes.filter((n) => n.memory_percent != null);
  const avgCpu =
    withCpu.length > 0 ? withCpu.reduce((a, n) => a + (n.cpu_percent ?? 0), 0) / withCpu.length : null;
  const avgMem =
    withMem.length > 0 ? withMem.reduce((a, n) => a + (n.memory_percent ?? 0), 0) / withMem.length : null;

  const sum = infra?.summary;
  const clusterCpuPct =
    sum && sum.allocatable_cpu_millicores_total > 0 && sum.used_cpu_millicores_total != null
      ? Math.min(100, (100 * sum.used_cpu_millicores_total) / sum.allocatable_cpu_millicores_total)
      : null;
  const clusterMemPct =
    sum && sum.allocatable_memory_bytes_total > 0 && sum.used_memory_bytes_total != null
      ? Math.min(100, (100 * sum.used_memory_bytes_total) / sum.allocatable_memory_bytes_total)
      : null;
  const ns = cluster;
  const nsReqCpuPct =
    sum && ns?.namespace_requests_cpu_millicores != null && sum.allocatable_cpu_millicores_total > 0
      ? Math.min(100, (100 * ns.namespace_requests_cpu_millicores) / sum.allocatable_cpu_millicores_total)
      : null;
  const nsReqMemPct =
    sum && ns?.namespace_requests_memory_bytes != null && sum.allocatable_memory_bytes_total > 0
      ? Math.min(100, (100 * ns.namespace_requests_memory_bytes) / sum.allocatable_memory_bytes_total)
      : null;

  const hasValidCluster = cluster != null && isValidClusterPayload(cluster);
  /** Do not show Healthy unless the live pod list loaded; avoids false green when only placeholders render. */
  const podsEndpointOk = monOk.pods;
  const podCountMismatch =
    hasValidCluster &&
    podsEndpointOk &&
    (cluster.pods_total ?? 0) > 0 &&
    pods.length === 0;
  const systemOk =
    hasValidCluster && podsEndpointOk && !podCountMismatch && (cluster.pods_failed ?? 0) === 0;
  const systemPartial = hasValidCluster && !podsEndpointOk;
  const systemUnknown = !loading && !hasValidCluster;

  async function loadLogs() {
    if (!logPod) return;
    setMsg(null);
    try {
      const r = await monFetch(`logs?pod=${encodeURIComponent(logPod)}&tail=800`);
      setLogs(r.ok ? await r.text() : await r.text());
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Logs failed");
    }
  }

  async function restartService() {
    setMsg(null);
    try {
      const r = await fetch(
        `/api/mon/restart?deployment=${encodeURIComponent(restartDep)}`,
        monRequestInit({ method: "POST" }),
      );
      const t = await r.text();
      setMsg(r.ok ? `Restart triggered: ${restartDep}` : t);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Restart failed");
    }
  }

  /** Placeholder row order when /api/services has not loaded (k8s uses `web` + `stt-service`, not compose-only `whisper-service`). */
  const highlighted = ["api-service", "web", "mongo", "ollama", "stt-service"];
  const displayServices =
    services.length > 0
      ? [...services].sort((a, b) => {
          const ai = highlighted.indexOf(a.name);
          const bi = highlighted.indexOf(b.name);
          if (ai === -1 && bi === -1) return a.name.localeCompare(b.name);
          if (ai === -1) return 1;
          if (bi === -1) return -1;
          return ai - bi;
        })
      : highlighted.map((name) => ({
          name,
          status: "—",
          cpu_millicores: null as number | null,
          memory_bytes: null as number | null,
          pods_ready: "—",
        }));

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 border-r border-border bg-card p-4 md:block">
        <div className="mb-8 flex items-center gap-2 font-semibold">
          <Server className="h-5 w-5 text-primary" />
          Infrastructure
        </div>
        <nav className="grid gap-1 text-sm">
          <span className="rounded-lg bg-secondary px-3 py-2 font-medium">Overview</span>
          <a
            href={publicAppUrl}
            className="rounded-lg px-3 py-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            InterviewGenie
          </a>
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-background/95 px-4 py-4 backdrop-blur">
          <div>
            <h1 className="text-lg font-semibold">Cluster</h1>
            <p className="text-xs text-muted-foreground">
              {config?.environment_label ?? "—"} · NS {config?.namespace ?? "—"}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="flex w-full min-w-[12rem] max-w-md flex-col gap-1 sm:w-auto">
              <Label htmlFor="admin-mon-token" className="text-xs text-muted-foreground">
                Monitoring API token (if cluster uses Secret monitoring-admin)
              </Label>
              <div className="flex gap-2">
                <Input
                  id="admin-mon-token"
                  type="password"
                  autoComplete="off"
                  placeholder="ADMIN_TOKEN value"
                  className="h-9 font-mono text-xs"
                  value={adminTokenDraft}
                  onChange={(e) => setAdminTokenDraft(e.target.value)}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="shrink-0"
                  onClick={() => {
                    const v = adminTokenDraft.trim();
                    if (v) localStorage.setItem(MONITORING_ADMIN_TOKEN_LS, v);
                    else localStorage.removeItem(MONITORING_ADMIN_TOKEN_LS);
                    void refresh();
                  }}
                >
                  Save and refresh
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={refresh} disabled={loading}>
                <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <Button size="sm" variant="outline" asChild>
                <a href={publicAppUrl}>Close</a>
              </Button>
            </div>
          </div>
        </header>

        <div className="flex-1 space-y-8 p-4 md:p-6">
          {msg && (
            <p className="rounded-xl border border-border bg-secondary/30 p-3 text-sm text-muted-foreground">{msg}</p>
          )}

          <section>
            <h2 className="mb-4 flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Activity className="h-4 w-4" />
              Cluster overview
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card className="shadow-md">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <Cpu className="h-4 w-4" />
                    CPU usage
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{avgCpu != null && !Number.isNaN(avgCpu) ? `${avgCpu.toFixed(1)}%` : "—"}</p>
                  <p className="text-xs text-muted-foreground">Avg. across nodes</p>
                </CardContent>
              </Card>
              <Card className="shadow-md">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <HardDrive className="h-4 w-4" />
                    Memory usage
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{avgMem != null && !Number.isNaN(avgMem) ? `${avgMem.toFixed(1)}%` : "—"}</p>
                  <p className="text-xs text-muted-foreground">Avg. across nodes</p>
                </CardContent>
              </Card>
              <Card className="shadow-md">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <Boxes className="h-4 w-4" />
                    Pods running
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{hasValidCluster ? cluster.pods_running : "—"}</p>
                  <p className="text-xs text-muted-foreground">of {hasValidCluster ? cluster.pods_total : "—"} total</p>
                </CardContent>
              </Card>
              <Card className="shadow-md">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <Server className="h-4 w-4" />
                    System status
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <Badge variant="outline" className="text-sm">
                      Loading…
                    </Badge>
                  ) : systemUnknown ? (
                    <Badge variant="warning" className="text-sm">
                      Unavailable
                    </Badge>
                  ) : systemPartial ? (
                    <Badge variant="warning" className="text-sm">
                      Partial data
                    </Badge>
                  ) : podCountMismatch ? (
                    <Badge variant="warning" className="text-sm">
                      Inconsistent
                    </Badge>
                  ) : (
                    <Badge variant={systemOk ? "success" : "destructive"} className="text-sm">
                      {systemOk ? "Healthy" : "Check failures"}
                    </Badge>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    Failed pods: {hasValidCluster ? cluster.pods_failed : "—"}
                  </p>
                </CardContent>
              </Card>
            </div>
            {hasValidCluster && cluster.metrics_available === false && (
              <p className="mt-3 max-w-3xl text-xs text-muted-foreground">
                CPU and memory stay empty until the cluster exposes{" "}
                <span className="font-mono text-[11px]">metrics.k8s.io</span> (install or enable{" "}
                <strong className="font-normal">metrics-server</strong>; on k3s,{" "}
                <span className="font-mono text-[11px]">kubectl top nodes</span> should work). Pod list
                CPU/memory columns use the same source.
              </p>
            )}
          </section>

          {monOk.infrastructure && sum && (
            <section>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Server className="h-4 w-4" />
                Infrastructure capacity
              </h2>
              <p className="mb-4 max-w-3xl text-xs text-muted-foreground">
                <strong className="font-normal text-foreground">Used vs remaining</strong> for CPU and RAM comes from
                the Kubernetes metrics API (same as <span className="font-mono text-[11px]">kubectl top nodes</span>).
                Ephemeral storage shows kube-reported <strong className="font-normal">capacity / allocatable</strong>{" "}
                only — live disk fill level is not in metrics-server.
              </p>
              <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Card className="shadow-md">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Cluster CPU</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm">
                    <p>
                      <span className="text-muted-foreground">Used</span>{" "}
                      <span className="font-medium">{formatCpuMillis(sum.used_cpu_millicores_total ?? undefined)}</span>
                      <span className="text-muted-foreground"> · Remaining </span>
                      <span className="font-medium">
                        {formatCpuMillis(sum.remaining_cpu_millicores_total ?? undefined)}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Allocatable {formatCpuMillis(sum.allocatable_cpu_millicores_total)}
                    </p>
                    <UsageBar pct={clusterCpuPct} />
                  </CardContent>
                </Card>
                <Card className="shadow-md">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Cluster memory</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm">
                    <p>
                      <span className="text-muted-foreground">Used</span>{" "}
                      <span className="font-medium">{formatBytes(sum.used_memory_bytes_total ?? undefined)}</span>
                      <span className="text-muted-foreground"> · Free </span>
                      <span className="font-medium">{formatBytes(sum.remaining_memory_bytes_total ?? undefined)}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Allocatable {formatBytes(sum.allocatable_memory_bytes_total)}
                    </p>
                    <UsageBar pct={clusterMemPct} />
                  </CardContent>
                </Card>
                <Card className="shadow-md">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Ephemeral (nodes)</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm">
                    <p>
                      <span className="text-muted-foreground">Capacity</span>{" "}
                      <span className="font-medium">{formatBytes(sum.capacity_ephemeral_bytes_total)}</span>
                    </p>
                    <p>
                      <span className="text-muted-foreground">Allocatable</span>{" "}
                      <span className="font-medium">{formatBytes(sum.allocatable_ephemeral_bytes_total)}</span>
                    </p>
                  </CardContent>
                </Card>
                <Card className="shadow-md">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">Nodes</CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm">
                    <p className="text-2xl font-bold">
                      {sum.nodes_ready}/{sum.nodes_total}
                    </p>
                    <p className="text-xs text-muted-foreground">Ready / total</p>
                  </CardContent>
                </Card>
              </div>

              {hasValidCluster && ns?.namespace_requests_cpu_millicores != null && (
                <Card className="mb-6 shadow-md">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">
                      Namespace <span className="font-mono text-sm">{config?.namespace ?? "—"}</span> — scheduling
                    </CardTitle>
                    <CardDescription>
                      Sum of container <strong className="font-normal">requests</strong> in this namespace vs cluster
                      allocatable (not the same as live usage).
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="text-sm">
                        CPU requests {formatCpuMillis(ns.namespace_requests_cpu_millicores)} of cluster{" "}
                        {formatCpuMillis(sum.allocatable_cpu_millicores_total)}
                      </p>
                      <UsageBar pct={nsReqCpuPct} />
                    </div>
                    <div>
                      <p className="text-sm">
                        Memory requests {formatBytes(ns.namespace_requests_memory_bytes)} of cluster{" "}
                        {formatBytes(sum.allocatable_memory_bytes_total)}
                      </p>
                      <UsageBar pct={nsReqMemPct} />
                    </div>
                  </CardContent>
                </Card>
              )}

              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Per node</h3>
              <Card className="shadow-md">
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Node</TableHead>
                          <TableHead>Ready</TableHead>
                          <TableHead>CPU</TableHead>
                          <TableHead>Memory</TableHead>
                          <TableHead>Ephemeral alloc.</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(infra?.nodes ?? []).map((n) => (
                          <TableRow key={n.name}>
                            <TableCell>
                              <div className="font-mono text-xs">{n.name}</div>
                              {n.instance_type ? (
                                <div className="text-[11px] text-muted-foreground">{n.instance_type}</div>
                              ) : null}
                            </TableCell>
                            <TableCell>
                              <Badge variant={n.ready ? "success" : "destructive"}>{n.ready ? "Yes" : "No"}</Badge>
                            </TableCell>
                            <TableCell className="min-w-[10rem] text-xs">
                              {n.cpu_percent != null ? (
                                <>
                                  <div>{n.cpu_percent}% used</div>
                                  <UsageBar pct={n.cpu_percent} />
                                  <div className="mt-1 text-muted-foreground">
                                    {formatCpuMillis(n.used_cpu_millicores ?? undefined)} /{" "}
                                    {formatCpuMillis(n.allocatable_cpu_millicores)} · left{" "}
                                    {formatCpuMillis(n.remaining_cpu_millicores ?? undefined)}
                                  </div>
                                </>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="min-w-[10rem] text-xs">
                              {n.memory_percent != null ? (
                                <>
                                  <div>{n.memory_percent}% used</div>
                                  <UsageBar pct={n.memory_percent} />
                                  <div className="mt-1 text-muted-foreground">
                                    {formatBytes(n.used_memory_bytes ?? undefined)} /{" "}
                                    {formatBytes(n.allocatable_memory_bytes)} · free{" "}
                                    {formatBytes(n.remaining_memory_bytes ?? undefined)}
                                  </div>
                                </>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-xs">{formatBytes(n.allocatable_ephemeral_bytes)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
              {infra?.note_ephemeral ? (
                <p className="mt-2 text-xs text-muted-foreground">{infra.note_ephemeral}</p>
              ) : null}
            </section>
          )}

          <Separator />

          <section>
            <h2 className="mb-2 text-sm font-medium text-muted-foreground">Services</h2>
            <p className="mb-4 max-w-3xl text-xs text-muted-foreground">
              <strong className="font-normal text-foreground">Degraded</strong> means the Service&apos;s selector
              matches pods that are not all <span className="font-mono text-[11px]">Running</span> (for example a
              second pod stuck <span className="font-mono text-[11px]">Pending</span> on a bad image during rollout).
              Fix stuck rollouts or missing Docker Hub tags; CPU/memory here also need metrics-server.
            </p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {displayServices.slice(0, 12).map((svc) => (
                <Card key={svc.name} className="shadow-md">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{SERVICE_LABELS[svc.name] ?? svc.name}</CardTitle>
                    <CardDescription className="font-mono text-xs">{svc.name}</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Status</span>
                      <Badge variant="outline">{svc.status}</Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">CPU</span>
                      <span>{svc.cpu_millicores != null ? `${svc.cpu_millicores} m` : "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Memory</span>
                      <span>{formatBytes(svc.memory_bytes ?? null)}</span>
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Pods</span>
                      <span>{svc.pods_ready}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-medium text-muted-foreground">Pods</h2>
            <p className="mb-4 max-w-3xl text-xs text-muted-foreground">
              <strong className="font-normal text-foreground">Usage</strong> columns need metrics-server.{" "}
              <strong className="font-normal text-foreground">Requests / limits</strong> come from each pod spec
              (what scheduling reserves).
            </p>
            <Card className="shadow-md">
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Pod</TableHead>
                        <TableHead>Node</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Usage CPU</TableHead>
                        <TableHead>Usage RAM</TableHead>
                        <TableHead>Requests CPU</TableHead>
                        <TableHead>Requests RAM</TableHead>
                        <TableHead>Limits CPU</TableHead>
                        <TableHead>Limits RAM</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pods.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={9} className="text-center text-muted-foreground">
                            No pod data — fix errors above (401 → align monitoring-admin / MONITORING_ADMIN_TOKEN; 5xx →
                            MONITORING_URL / monitoring-service pod).
                          </TableCell>
                        </TableRow>
                      ) : (
                        pods.map((pod) => (
                          <TableRow key={pod.name}>
                            <TableCell className="min-w-[10rem] font-mono text-xs">{pod.name}</TableCell>
                            <TableCell className="max-w-[8rem] truncate font-mono text-[11px] text-muted-foreground">
                              {pod.node || "—"}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{pod.status}</Badge>
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs">
                              {pod.usage_cpu_millicores != null
                                ? formatCpuMillis(pod.usage_cpu_millicores)
                                : pod.cpu || "—"}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs">
                              {pod.usage_memory_bytes != null
                                ? formatBytes(pod.usage_memory_bytes)
                                : pod.memory || "—"}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs">
                              {formatCpuMillis(pod.requests_cpu_millicores)}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs">
                              {formatBytes(pod.requests_memory_bytes)}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs">
                              {(pod.limits_cpu_millicores ?? 0) > 0
                                ? formatCpuMillis(pod.limits_cpu_millicores)
                                : "—"}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-xs">
                              {(pod.limits_memory_bytes ?? 0) > 0 ? formatBytes(pod.limits_memory_bytes) : "—"}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <Card className="shadow-md">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <ScrollText className="h-4 w-4" />
                  Logs viewer
                </CardTitle>
                <CardDescription>Select a pod and load recent logs.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-2">
                  <Label>Pod</Label>
                  <select
                    value={logPod}
                    onChange={(e) => setLogPod(e.target.value)}
                    className="flex h-10 w-full rounded-xl border border-input bg-secondary/50 px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {pods.length === 0 ? (
                      <option value="">—</option>
                    ) : (
                      pods.map((p) => (
                        <option key={p.name} value={p.name}>
                          {p.name}
                        </option>
                      ))
                    )}
                  </select>
                </div>
                <Button variant="secondary" className="w-fit" onClick={loadLogs}>
                  Load logs
                </Button>
                <pre className="max-h-80 overflow-auto rounded-xl border border-border bg-secondary/20 p-4 text-xs leading-relaxed">
                  {logs || "—"}
                </pre>
              </CardContent>
            </Card>

            <Card className="shadow-md">
              <CardHeader>
                <CardTitle className="text-base">Actions</CardTitle>
                <CardDescription>Restart a deployment (allow-listed on the monitoring API).</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-2">
                  <Label>Deployment</Label>
                  <select
                    value={restartDep}
                    onChange={(e) => setRestartDep(e.target.value)}
                    className="flex h-10 w-full rounded-xl border border-input bg-secondary/50 px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {RESTART_DEPLOYMENTS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
                <Button variant="destructive" className="w-fit" onClick={restartService}>
                  Restart service
                </Button>
              </CardContent>
            </Card>
          </section>
        </div>
      </div>
    </div>
  );
}
