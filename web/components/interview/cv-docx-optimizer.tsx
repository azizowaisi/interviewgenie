"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { appFetch } from "@/lib/api-fetch";

type JobCreateResponse = {
  job_id: string;
  status: string;
  execution_mode?: string;
};

type JobStatusResponse = {
  job_id: string;
  status: "queued" | "running" | "done" | "failed";
  stage?: string | null;
  progress?: number | null;
  message?: string | null;
  events?: { ts?: string | null; stage?: string | null; progress?: number | null; message?: string | null }[];
  error?: string | null;
  download_url?: string | null;
  suggestions?: string[];
  stale_queued?: boolean;
  stale_queued_message?: string | null;
  assembly?: {
    job_status?: string;
    sections?: Record<
      string,
      {
        status?: string;
        content?: unknown;
        error?: string | null;
        updated_at?: string | null;
        items?: {
          id: string;
          status?: string;
          raw?: { role?: string; company?: string; bullets?: string[] };
          optimized?: { role?: string; company?: string; bullets?: string[] } | null;
          error?: string | null;
          updated_at?: string | null;
        }[];
      }
    >;
  } | null;
};

type Props = {
  topicId: string;
  initialJobDescription?: string;
};

function parseApiError(raw: string, status: number): string {
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const d = j.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) return JSON.stringify(d);
  } catch {
    /* ignore */
  }
  return raw || `Request failed (${status})`;
}

function jobStorageKey(topicId: string): string {
  return `ats_cv_optimize_job:${topicId}`;
}

function loadStoredJobId(topicId: string): string | null {
  if (typeof window === "undefined") return null;
  if (!topicId.trim()) return null;
  try {
    const raw = window.localStorage.getItem(jobStorageKey(topicId));
    if (!raw) return null;
    const j = JSON.parse(raw) as { job_id?: unknown };
    const jid = typeof j.job_id === "string" ? j.job_id.trim() : "";
    return jid || null;
  } catch {
    return null;
  }
}

function storeJobId(topicId: string, jobId: string) {
  if (typeof window === "undefined") return;
  if (!topicId.trim() || !jobId.trim()) return;
  try {
    window.localStorage.setItem(jobStorageKey(topicId), JSON.stringify({ job_id: jobId.trim(), ts: Date.now() }));
  } catch {
    /* ignore */
  }
}

function clearStoredJobId(topicId: string) {
  if (typeof window === "undefined") return;
  if (!topicId.trim()) return;
  try {
    window.localStorage.removeItem(jobStorageKey(topicId));
  } catch {
    /* ignore */
  }
}

function formatFailedJobMessage(j: JobStatusResponse): string {
  const err = j.error;
  if (err != null && String(err).trim() !== "") {
    if (typeof err === "string") return err;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  const m = j.message;
  if (m && m.trim() && m !== "Failed") return m;
  const ev = j.events;
  if (ev?.length) {
    const last = ev[ev.length - 1];
    const lm = last?.message;
    if (lm && String(lm).trim()) return String(lm);
    if (last?.stage) return `Last stage: ${last.stage}`;
  }
  if (j.stage) return `Failed at stage: ${j.stage}`;
  return "Generation failed with no detail from the server. Check api-service, cv-optimize-worker, llm-service, and cv-renderer-service logs.";
}

export function CvDocxOptimizer({ topicId, initialJobDescription }: Props) {
  const [jobDescription, setJobDescription] = useState(initialJobDescription || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  /** Server already has a saved ATS DOCX for this job — next run replaces it (delete + regenerate). */
  const [hasSavedAtsCv, setHasSavedAtsCv] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "queued" | "running" | "done" | "failed">("idle");
  const [progress, setProgress] = useState<number>(0);
  const [message, setMessage] = useState<string>("");
  const [events, setEvents] = useState<{ ts?: string | null; stage?: string | null; progress?: number | null; message?: string | null }[]>([]);
  const [assembly, setAssembly] = useState<JobStatusResponse["assembly"]>(null);
  const [queueHint, setQueueHint] = useState<string | null>(null);
  const busy = loading || status === "queued" || status === "running";
  const statusLabel = message || (status === "queued" ? "Queued…" : status === "running" ? "Running…" : "");
  const statusLine = `${Math.max(0, Math.min(100, progress))}% — ${statusLabel || "Starting…"}`;

  useEffect(() => {
    setJobDescription(initialJobDescription || "");
    setError(null);
    setQueueHint(null);
    setDownloadUrl(null);
    setHasSavedAtsCv(false);
    setStatus("idle");
    setProgress(0);
    setMessage("");
    setEvents([]);
    setAssembly(null);

    // Resume in-flight job after refresh, or show server-saved ATS CV for this job (same topic as Start upload).
    const stored = loadStoredJobId(topicId);
    if (stored) {
      setJobId(stored);
      setStatus("queued");
      setProgress(0);
      setMessage("Resuming — checking status…");
      return;
    }
    setJobId(null);
    if (!topicId.trim()) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await appFetch(`/topics/${encodeURIComponent(topicId.trim())}`);
        if (!r.ok || cancelled) return;
        const t = (await r.json()) as { saved_ats_cv_file_id?: string | null };
        if (cancelled || !t.saved_ats_cv_file_id) return;
        setHasSavedAtsCv(true);
        setDownloadUrl(`/api/app/topics/${encodeURIComponent(topicId.trim())}/saved-ats-cv`);
        setStatus("done");
        setProgress(100);
        setMessage("Saved ATS CV — download anytime until you upload a new CV.");
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialJobDescription, topicId]);

  useEffect(() => {
    if (!jobId) return;
    if (status === "done" || status === "failed") return;

    const jid = jobId;
    let cancelled = false;
    let t: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      let terminal = false;
      try {
        const statusPath = `/cv/optimize/jobs/${encodeURIComponent(jid)}`;
        const r = await appFetch(statusPath);
        const raw = await r.text();
        if (!r.ok) throw new Error(`Status check failed (${statusPath}): ${parseApiError(raw, r.status)}`);
        const j = JSON.parse(raw) as JobStatusResponse;
        if (cancelled) return;
        setStatus(j.status);
        if (typeof j.progress === "number") setProgress(Math.max(0, Math.min(100, j.progress)));
        if (typeof j.message === "string") setMessage(j.message);
        if (Array.isArray(j.events)) setEvents(j.events);
        setAssembly(j.assembly ?? null);
        if (j.stale_queued && typeof j.stale_queued_message === "string" && j.stale_queued_message.trim()) {
          setQueueHint(j.stale_queued_message.trim());
        } else {
          setQueueHint(null);
        }
        if (j.status === "failed") {
          setError(formatFailedJobMessage(j));
          clearStoredJobId(topicId);
          terminal = true;
          return;
        }
        if (j.status === "done") {
          setHasSavedAtsCv(true);
          setDownloadUrl(`/api/app/topics/${encodeURIComponent(topicId.trim())}/saved-ats-cv`);
          clearStoredJobId(topicId);
          terminal = true;
          return;
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to check job status.");
          terminal = true;
        }
      } finally {
        if (!cancelled && !terminal) {
          t = setTimeout(poll, 1500);
        }
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (t) clearTimeout(t);
    };
  }, [jobId, status, topicId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const tid = topicId.trim();
    if (!tid) {
      setError("Select a job first.");
      return;
    }

    const replaceExisting = hasSavedAtsCv || (status === "done" && !!downloadUrl);

    setError(null);
    setQueueHint(null);
    setDownloadUrl(null);
    setHasSavedAtsCv(false);
    setJobId(null);
    setStatus("idle");
    clearStoredJobId(topicId);

    setLoading(true);
    try {
      if (replaceExisting) {
        const delPath = `/topics/${encodeURIComponent(tid)}/saved-ats-cv`;
        const delRes = await appFetch(delPath, { method: "DELETE" });
        const delRaw = await delRes.text();
        if (!delRes.ok) {
          throw new Error(`Could not remove previous ATS CV (${delPath}): ${parseApiError(delRaw, delRes.status)}`);
        }
      }

      const jd = jobDescription.trim();
      const createPath = "/cv/optimize/jobs";
      const res = await appFetch(createPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic_id: tid, job_description: jd || undefined }),
      });

      const raw = await res.text();
      if (!res.ok) {
        throw new Error(`Generate request failed (${createPath}): ${parseApiError(raw, res.status)}`);
      }

      let data: JobCreateResponse;
      try {
        data = JSON.parse(raw) as JobCreateResponse;
      } catch {
        throw new Error("Invalid response from server.");
      }

      const nextJobId = (data.job_id || "").trim();
      if (!nextJobId) throw new Error("Server did not return a job id.");
      storeJobId(topicId, nextJobId);
      setJobId(nextJobId);
      const st = (data.status || "queued").trim().toLowerCase();
      if (st === "running") {
        setStatus("running");
        setProgress(5);
        setMessage("Starting…");
      } else {
        setStatus("queued");
        setProgress(0);
        setMessage("Queued — waiting for worker…");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Optimization failed.");
      setStatus("failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        We build the DOCX from your saved CV for this job and the job description. When you have run{" "}
        <span className="font-medium text-foreground">Generate ATS</span> for this job, the optimizer also uses that
        latest ATS result (suggested skills, summary guidance, skills guidance, and bullet guidance) so the output lines
        up with what you see above. Skills are only added when your CV text already supports them. If you already
        generated an ATS CV, use <span className="font-medium text-foreground">Re-create</span> to remove the previous
        file and run a fresh generation.
      </p>
      <form onSubmit={onSubmit} className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="cv-jd-override">Job description (optional)</Label>
          <Textarea
            id="cv-jd-override"
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            placeholder="Uses your saved job description if left empty. Paste or edit here to override."
            rows={5}
            className="min-h-[100px] resize-y"
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {queueHint && !error && (
          <p className="text-sm text-amber-700 dark:text-amber-500">{queueHint}</p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {!busy && (
            <Button type="submit" disabled={!topicId.trim()} className="w-fit">
              {hasSavedAtsCv ? "Re-create ATS CV (.docx)" : "Generate ATS CV (.docx)"}
            </Button>
          )}

          {busy && (
            <div className="grid min-w-[18rem] gap-2">
              <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${progress || 5}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">{statusLine}</p>
            </div>
          )}

          {status === "done" && downloadUrl && (
            <Button variant="secondary" asChild className="w-fit">
              <a href={downloadUrl} download="ats_optimized_cv.docx">
                Download ATS CV (.docx)
              </a>
            </Button>
          )}
        </div>
        {assembly?.sections && (
          <div className="grid gap-3 rounded-xl border border-border bg-secondary/20 p-4">
            <p className="text-sm font-medium text-muted-foreground">Live CV assembly</p>
            <div className="grid gap-2 text-sm">
              {(["summary", "skills", "experience", "education"] as const).map((k) => {
                const sec = assembly.sections?.[k];
                if (!sec) return null;
                return (
                  <div key={k} className="rounded-lg border border-border bg-background/50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{k}</span>
                      <span className="text-xs text-muted-foreground">status: {sec.status || "unknown"}</span>
                    </div>
                    {k !== "experience" && typeof sec.content === "string" && sec.content.trim() && (
                      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-secondary/30 p-2 text-xs">
                        {sec.content}
                      </pre>
                    )}
                    {k === "skills" && Array.isArray(sec.content) && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {sec.content.slice(0, 40).map((s, idx) => (
                          <span key={`${k}-skill-${idx}`} className="rounded-md bg-secondary px-2 py-0.5 text-xs">
                            {String(s)}
                          </span>
                        ))}
                      </div>
                    )}
                    {k === "experience" && Array.isArray(sec.items) && (
                      <div className="mt-2 grid gap-2">
                        {sec.items.slice(0, 12).map((it) => (
                          <div key={it.id} className="rounded-md border border-border bg-background/40 p-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-xs font-medium">
                                {it.raw?.role || "Experience"} {it.raw?.company ? `@ ${it.raw.company}` : ""}
                              </span>
                              <span className="text-[11px] text-muted-foreground">status: {it.status || "unknown"}</span>
                            </div>
                            <ul className="mt-1 list-inside list-disc space-y-1 text-xs">
                              {(it.optimized?.bullets || it.raw?.bullets || []).slice(0, 4).map((b, idx) => (
                                <li key={`${it.id}-b-${idx}`}>{b}</li>
                              ))}
                            </ul>
                            {it.error && <p className="mt-1 text-xs text-destructive">{it.error}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                    {sec.error && <p className="mt-2 text-xs text-destructive">{sec.error}</p>}
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              This view updates live as sections/nodes complete. When everything needed is ready, the server renders a new
              DOCX.
            </p>
          </div>
        )}
      </form>
    </div>
  );
}
