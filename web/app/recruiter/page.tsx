"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listJobs, deleteJob, type Job } from "@/lib/recruiter-api";

export default function RecruiterDashboardPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setJobs(await listJobs());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleDelete(id: string) {
    if (!confirm("Delete this job and all its candidates?")) return;
    try {
      await deleteJob(id);
      setJobs((prev) => prev.filter((j) => j.id !== id));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Recruiter Dashboard</h1>
        <Link
          href="/recruiter/jobs/new"
          className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:bg-primary/90"
        >
          + New Job
        </Link>
      </div>

      {loading && <p className="text-muted-foreground">Loading jobs…</p>}
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-destructive text-sm mb-4">
          {error}
          {error.includes("Recruiter role") && (
            <span>
              {" "}— <Link href="/recruiter/setup" className="underline">Set up recruiter account</Link>
            </span>
          )}
        </div>
      )}

      {!loading && !error && jobs.length === 0 && (
        <div className="rounded-md border border-dashed p-12 text-center text-muted-foreground">
          <p className="mb-4">No jobs yet.</p>
          <Link href="/recruiter/jobs/new" className="underline text-sm">Create your first job posting →</Link>
        </div>
      )}

      {jobs.length > 0 && (
        <div className="space-y-3">
          {jobs.map((job) => (
            <div
              key={job.id}
              className="rounded-lg border bg-card p-5 flex items-start justify-between gap-4"
            >
              <div className="flex-1 min-w-0">
                <Link href={`/recruiter/jobs/${job.id}`} className="font-semibold hover:underline text-lg">
                  {job.title}
                </Link>
                <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{job.description}</p>
                <div className="flex flex-wrap gap-1 mt-2">
                  {job.skills.slice(0, 8).map((s) => (
                    <span key={s} className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex flex-col items-end gap-2 shrink-0">
                <span className="text-sm text-muted-foreground">
                  {job.candidate_count ?? 0} candidate{job.candidate_count !== 1 ? "s" : ""}
                </span>
                <div className="flex gap-2">
                  <Link
                    href={`/recruiter/jobs/${job.id}`}
                    className="text-xs border px-3 py-1 rounded hover:bg-secondary"
                  >
                    View
                  </Link>
                  <button
                    onClick={() => handleDelete(job.id)}
                    className="text-xs border border-destructive/50 text-destructive px-3 py-1 rounded hover:bg-destructive/10"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
