"use client";

import { useCallback, useEffect, useState } from "react";
import { monFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Activity, Cpu, HardDrive, RefreshCw, Server, ScrollText, Boxes } from "lucide-react";
import { publicAppUrl } from "@/lib/public-urls";

const RESTART_DEPLOYMENTS = [
  "api-service",
  "audio-service",
  "stt-service",
  "question-service",
  "llm-service",
  "formatter-service",
  "ollama",
  "whisper-service",
] as const;

const SERVICE_LABELS: Record<string, string> = {
  "api-service": "Backend",
  "audio-service": "Audio pipeline",
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

type Cluster = {
  nodes?: { name: string; cpu_percent?: number | null; memory_percent?: number | null }[];
  pods_total?: number;
  pods_running?: number;
  pods_failed?: number;
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

type MonEndpointsOk = { cluster: boolean; pods: boolean; services: boolean; config: boolean };

type PodRow = { name: string; status: string; cpu: string; memory: string };
type SvcRow = {
  name: string;
  status: string;
  cpu_millicores?: number | null;
  memory_bytes?: number | null;
  pods_ready?: string;
};

export function AdminDashboard() {
  const [cluster, setCluster] = useState<Cluster | null>(null);
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
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    setMsg(null);
    try {
      const [c, p, s, cfg] = await Promise.all([
        monFetch("cluster"),
        monFetch("pods"),
        monFetch("services"),
        monFetch("config"),
      ]);
      const errs: string[] = [];
      const nextOk: MonEndpointsOk = { cluster: false, pods: false, services: false, config: false };

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

      setMonOk(nextOk);

      if (errs.length) {
        const hint401 =
          errs.some((e) => e.includes("401")) || c.status === 401 || cfg.status === 401
            ? " If the monitoring API uses a token, set Secret monitoring-admin with key ADMIN_TOKEN and ensure the web pod has MONITORING_ADMIN_TOKEN (same value). Redeploy web after creating the secret."
            : "";
        const hintUpstream =
          !hint401 && errs.some((e) => /HTTP (502|503|504)/.test(e))
            ? " The Next.js BFF could not reach monitoring-service — check web env MONITORING_URL (e.g. http://monitoring-service:3001) and that the monitoring-service pod is running."
            : "";
        setMsg(`${errs.join(". ")}.${hint401}${hintUpstream}`);
      }
    } catch (e) {
      setMonOk({ cluster: false, pods: false, services: false, config: false });
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
      const r = await fetch(`/api/mon/restart?deployment=${encodeURIComponent(restartDep)}`, {
        method: "POST",
        cache: "no-store",
      });
      const t = await r.text();
      setMsg(r.ok ? `Restart triggered: ${restartDep}` : t);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Restart failed");
    }
  }

  const highlighted = ["api-service", "frontend", "mongo", "ollama", "whisper-service"];
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
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={refresh} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href={publicAppUrl}>Close</a>
            </Button>
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
          </section>

          <Separator />

          <section>
            <h2 className="mb-4 text-sm font-medium text-muted-foreground">Services</h2>
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
            <h2 className="mb-4 text-sm font-medium text-muted-foreground">Pods</h2>
            <Card className="shadow-md">
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pod name</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>CPU</TableHead>
                      <TableHead>Memory</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pods.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground">
                          No pod data — fix errors above (401 → align monitoring-admin / MONITORING_ADMIN_TOKEN; 5xx →
                          MONITORING_URL / monitoring-service pod).
                        </TableCell>
                      </TableRow>
                    ) : (
                      pods.map((pod) => (
                        <TableRow key={pod.name}>
                          <TableCell className="font-mono text-xs">{pod.name}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{pod.status}</Badge>
                          </TableCell>
                          <TableCell>{pod.cpu || "—"}</TableCell>
                          <TableCell>{pod.memory || "—"}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
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
