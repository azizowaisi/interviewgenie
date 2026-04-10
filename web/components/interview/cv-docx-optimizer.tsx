"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { appFetch } from "@/lib/api-fetch";

type JobCreateResponse = {
  job_id: string;
  status: string;
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

export function CvDocxOptimizer({ topicId, initialJobDescription }: Props) {
  const [jobDescription, setJobDescription] = useState(initialJobDescription || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "queued" | "running" | "done" | "failed">("idle");
  const [progress, setProgress] = useState<number>(0);
  const [message, setMessage] = useState<string>("");
  const [events, setEvents] = useState<{ ts?: string | null; stage?: string | null; progress?: number | null; message?: string | null }[]>([]);
  const busy = loading || status === "queued" || status === "running";
  const statusLabel = message || (status === "queued" ? "Queued…" : status === "running" ? "Running…" : "");
  const statusLine = `${Math.max(0, Math.min(100, progress))}% — ${statusLabel || "Starting…"}`;

  useEffect(() => {
    setJobDescription(initialJobDescription || "");
    setError(null);
    setDownloadUrl(null);
    setStatus("idle");
    setProgress(0);
    setMessage("");
    setEvents([]);

    // Resume existing job after refresh (per job/topic).
    const stored = loadStoredJobId(topicId);
    if (stored) {
      setJobId(stored);
      setStatus("queued");
      setProgress(0);
      setMessage("Resuming — checking status…");
    } else {
      setJobId(null);
    }
  }, [initialJobDescription, topicId]);

  useEffect(() => {
    if (!jobId) return;
    if (status === "done" || status === "failed") return;

    const jid = jobId;
    let cancelled = false;
    let t: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
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
        if (j.status === "failed") {
          setError((j.error || "Generation failed.").toString());
          clearStoredJobId(topicId);
          return;
        }
        if (j.status === "done") {
          const du = (j.download_url || "").trim();
          if (du.startsWith("/")) setDownloadUrl(`/api/app${du}`);
          else if (du) setDownloadUrl(du);
          clearStoredJobId(topicId);
          return;
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to check job status.");
      } finally {
        if (!cancelled && status !== "done" && status !== "failed") {
          t = setTimeout(poll, 1500);
        }
      }
    }

    poll();
    return () => {
      cancelled = true;
      if (t) clearTimeout(t);
    };
  }, [jobId, status]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setDownloadUrl(null);
    setJobId(null);
    setStatus("idle");
    clearStoredJobId(topicId);

    if (!topicId.trim()) {
      setError("Select a job first.");
      return;
    }

    setLoading(true);
    try {
      const jd = jobDescription.trim();
      const createPath = "/cv/optimize/jobs";
      const res = await appFetch(createPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic_id: topicId.trim(), job_description: jd || undefined }),
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
      setStatus("queued");
      setProgress(0);
      setMessage("Queued — sending request to worker…");
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
        Download ATS CV: here we generate a DOCX file with an ATS-updated version of the CV you already uploaded for
        this job. No need to choose a file again.
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
        <div className="flex flex-wrap items-center gap-3">
          {!busy && (
            <Button type="submit" disabled={!topicId.trim()} className="w-fit">
              Generate ATS CV (.docx)
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
        {/* Intentionally hide event log spam; statusLine updates live above. */}
      </form>
    </div>
  );
}
