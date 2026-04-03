"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { appFetch } from "@/lib/api-fetch";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const STATUS_PRESETS = [
  "Applied",
  "HR Interview",
  "Technical Interview",
  "Final Interview",
  "Offer",
  "Accepted",
  "Rejected",
];

type JobEvent = {
  id: string;
  event_type: string;
  status?: string | null;
  note?: string | null;
  occurred_at: string;
  created_at: string;
};

type CandidateJob = {
  id: string;
  job_title: string;
  company_name?: string | null;
  topic_id?: string | null;
  status: string;
  notes?: string | null;
  applied_at: string;
  created_at: string;
  updated_at: string;
  events: JobEvent[];
};

type Attempt = {
  id: string;
  attempt_number: number;
  score: number | null;
  start_time: string;
};

type JobRow = CandidateJob & {
  attempts: number;
  lastAttemptId: string | null;
  lastAttemptAt: string | null;
};

export function HistoryTable() {
  const [rows, setRows] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusDraft, setStatusDraft] = useState<Record<string, { status: string; note: string; occurred_at: string }>>({});
  const [savingIds, setSavingIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const jobs = await loadRows();
        if (!cancelled) setRows(jobs);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load jobs");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function nowForInput() {
    const d = new Date();
    d.setSeconds(0, 0);
    const offset = d.getTimezoneOffset();
    const local = new Date(d.getTime() - offset * 60000);
    return local.toISOString().slice(0, 16);
  }

  async function loadRows() {
    const tr = await appFetch("/candidate/jobs");
    if (!tr.ok) throw new Error(await tr.text());
    const jobs = (await tr.json()) as CandidateJob[];
    const withAttempts = await Promise.all(
      jobs.map(async (job) => {
        if (!job.topic_id) {
          return {
            ...job,
            attempts: 0,
            lastAttemptId: null,
            lastAttemptAt: null,
          };
        }
        const ar = await appFetch(`/topics/${job.topic_id}/attempts`);
        const attempts: Attempt[] =
          ar.ok ? await ar.json() : ar.status === 401 || ar.status === 403 || ar.status === 404 ? [] : [];
        const last =
          attempts.length > 0
            ? attempts.reduce((a, b) => (a.start_time > b.start_time ? a : b))
            : null;
        return {
          ...job,
          attempts: attempts.length,
          lastAttemptId: last?.id ?? null,
          lastAttemptAt: last?.start_time ?? null,
        };
      })
    );
    return withAttempts;
  }

  async function updateStatus(job: JobRow) {
    const draft = statusDraft[job.id] || {
      status: "",
      note: "",
      occurred_at: nowForInput(),
    };
    if (!draft.status.trim()) {
      setError("Status is required");
      return;
    }
    setSavingIds((s) => ({ ...s, [job.id]: true }));
    setError(null);
    try {
      const res = await appFetch(`/candidate/jobs/${job.id}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_type: "status_update",
          status: draft.status,
          note: draft.note,
          occurred_at: draft.occurred_at,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const refreshed = await loadRows();
      setRows(refreshed);
      setStatusDraft((prev) => ({
        ...prev,
        [job.id]: { status: "", note: "", occurred_at: nowForInput() },
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update status");
    } finally {
      setSavingIds((s) => ({ ...s, [job.id]: false }));
    }
  }

  function latestStatusTime(job: JobRow) {
    const statusEvent = (job.events || []).find((e) => e.status);
    return statusEvent?.occurred_at || job.updated_at;
  }

  if (loading) {
    return <p className="text-muted-foreground">Loading jobs…</p>;
  }
  if (error) {
    return (
      <Card className="shadow-md">
        <CardContent className="p-6 text-sm text-red-400">{error}</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {!rows.length ? (
        <Card className="shadow-md">
          <CardContent className="p-8 text-center text-muted-foreground">
            No jobs tracked yet. Add a job from the Start page first.
          </CardContent>
        </Card>
      ) : null}

      {rows.map((job) => (
        <Card key={job.id} className="shadow-md">
          <CardContent className="space-y-4 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold">{job.job_title}</h3>
                <Badge variant="secondary">{job.status}</Badge>
              </div>
              <div className="flex gap-2">
                {job.lastAttemptId ? (
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`/result?attempt=${job.lastAttemptId}`}>View Result</Link>
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" disabled>
                    No Result Yet
                  </Button>
                )}
                <Button size="sm" asChild>
                  <Link href="/mock">Retake</Link>
                </Button>
              </div>
            </div>

            <div className="grid gap-2 text-sm text-muted-foreground md:grid-cols-3">
              <p>
                Company: <span className="text-foreground">{job.company_name || "-"}</span>
              </p>
              <p>
                Interviews: <span className="text-foreground">{job.attempts}</span>
              </p>
              <p>
                Latest status time: <span className="text-foreground">{new Date(latestStatusTime(job)).toLocaleString()}</span>
              </p>
            </div>

            <div className="rounded-md border p-3">
              <p className="mb-2 text-sm font-medium">Update status with date and time</p>
              <div className="mb-2 flex flex-wrap gap-2">
                {STATUS_PRESETS.map((status) => (
                  <Button
                    key={status}
                    type="button"
                    size="sm"
                    variant={statusDraft[job.id]?.status === status ? "default" : "outline"}
                    onClick={() =>
                      setStatusDraft((prev) => ({
                        ...prev,
                        [job.id]: {
                          status,
                          note: prev[job.id]?.note || "",
                          occurred_at: prev[job.id]?.occurred_at || nowForInput(),
                        },
                      }))
                    }
                  >
                    {status}
                  </Button>
                ))}
              </div>
              <div className="grid gap-2 md:grid-cols-4">
                <Input
                  placeholder="New status (First interview, Rejected...)"
                  value={statusDraft[job.id]?.status || ""}
                  onChange={(e) =>
                    setStatusDraft((prev) => ({
                      ...prev,
                      [job.id]: {
                        status: e.target.value,
                        note: prev[job.id]?.note || "",
                        occurred_at: prev[job.id]?.occurred_at || nowForInput(),
                      },
                    }))
                  }
                />
                <Input
                  type="datetime-local"
                  value={statusDraft[job.id]?.occurred_at || nowForInput()}
                  onChange={(e) =>
                    setStatusDraft((prev) => ({
                      ...prev,
                      [job.id]: {
                        status: prev[job.id]?.status || "",
                        note: prev[job.id]?.note || "",
                        occurred_at: e.target.value,
                      },
                    }))
                  }
                />
                <Button onClick={() => updateStatus(job)} disabled={!!savingIds[job.id]}>
                  Add Status
                </Button>
                <Textarea
                  className="md:col-span-4"
                  rows={2}
                  placeholder="Status note"
                  value={statusDraft[job.id]?.note || ""}
                  onChange={(e) =>
                    setStatusDraft((prev) => ({
                      ...prev,
                      [job.id]: {
                        status: prev[job.id]?.status || "",
                        note: e.target.value,
                        occurred_at: prev[job.id]?.occurred_at || nowForInput(),
                      },
                    }))
                  }
                />
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium">Timeline (latest first)</p>
              <div className="space-y-2">
                {(job.events || []).map((event) => (
                  <div key={event.id} className="rounded-md border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{event.event_type === "status_update" ? "Status update" : event.event_type}</Badge>
                      {event.status ? <Badge variant="secondary">{event.status}</Badge> : null}
                      <span className="text-muted-foreground">{new Date(event.occurred_at).toLocaleString()}</span>
                    </div>
                    {event.note ? <p className="mt-1 text-muted-foreground">{event.note}</p> : null}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
