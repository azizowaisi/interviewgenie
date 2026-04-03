"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  getJob,
  listCandidates,
  uploadCandidateCV,
  updateCandidateStatus,
  startAiInterview,
  type Job,
  type Candidate,
  type AiInterviewResult,
} from "@/lib/recruiter-api";

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  shortlisted: "Shortlisted",
  interviewed: "Interviewed",
  rejected: "Rejected",
};

const STATUS_COLORS: Record<string, string> = {
  new: "bg-blue-500/10 text-blue-400",
  shortlisted: "bg-emerald-500/10 text-emerald-400",
  interviewed: "bg-yellow-500/10 text-yellow-400",
  rejected: "bg-red-500/10 text-red-400",
};

function ScoreBar({ score }: { score: number }) {
  const pct = Math.round(Math.min(100, Math.max(0, score)));
  const color = pct >= 70 ? "bg-emerald-500" : pct >= 45 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-2 rounded-full bg-secondary overflow-hidden">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono">{pct}</span>
    </div>
  );
}

export default function JobDetailPage() {
  const params = useParams();
  const jobId = params.jobId as string;

  const [job, setJob] = useState<Job | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [aiResult, setAiResult] = useState<AiInterviewResult | null>(null);
  const [aiLoading, setAiLoading] = useState<string | null>(null); // candidate id

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [j, c] = await Promise.all([getJob(jobId), listCandidates(jobId)]);
      setJob(j);
      setCandidates(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => { load(); }, [load]);

  async function handleCVUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const cand = await uploadCandidateCV(jobId, file);
      setCandidates((prev) => [cand, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function handleStatusChange(candidateId: string, status: string) {
    try {
      await updateCandidateStatus(candidateId, status);
      setCandidates((prev) =>
        prev.map((c) => (c.id === candidateId ? { ...c, status: status as Candidate["status"] } : c))
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : "Status update failed");
    }
  }

  async function handleStartAiInterview(candidate: Candidate) {
    setAiLoading(candidate.id);
    setAiResult(null);
    try {
      const result = await startAiInterview(jobId, candidate.id);
      setAiResult(result);
    } catch (e) {
      alert(e instanceof Error ? e.message : "AI interview failed");
    } finally {
      setAiLoading(null);
    }
  }

  const filtered = statusFilter
    ? candidates.filter((c) => c.status === statusFilter)
    : candidates;

  if (loading) {
    return <div className="max-w-5xl mx-auto px-4 py-8 text-muted-foreground">Loading…</div>;
  }

  if (error && !job) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <p className="text-destructive text-sm">{error}</p>
        <Link href="/recruiter" className="text-sm underline mt-4 inline-block">← Back</Link>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      {/* Breadcrumb */}
      <Link href="/recruiter" className="text-sm text-muted-foreground hover:underline mb-4 inline-block">
        ← Recruiter Dashboard
      </Link>

      {/* Job header */}
      {job && (
        <div className="mb-6">
          <h1 className="text-2xl font-bold">{job.title}</h1>
          <p className="text-muted-foreground text-sm mt-1 max-w-2xl line-clamp-3">{job.description}</p>
          <div className="flex flex-wrap gap-1 mt-2">
            {job.skills.map((s) => (
              <span key={s} className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full">
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Upload bar */}
      <div className="flex items-center gap-4 mb-6 p-4 rounded-lg border bg-card">
        <label className="cursor-pointer">
          <span className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:bg-primary/90 inline-block">
            {uploading ? "Uploading…" : "Upload CV (PDF/DOCX)"}
          </span>
          <input
            type="file"
            accept=".pdf,.docx,.txt"
            onChange={handleCVUpload}
            disabled={uploading}
            className="sr-only"
          />
        </label>
        <span className="text-sm text-muted-foreground">
          {candidates.length} candidate{candidates.length !== 1 ? "s" : ""}
        </span>
      </div>

      {error && <p className="text-destructive text-sm mb-4">{error}</p>}

      {/* Filter */}
      {candidates.length > 0 && (
        <div className="flex gap-2 mb-4 flex-wrap">
          {["", "new", "shortlisted", "interviewed", "rejected"].map((s) => (
            <button
              key={s || "all"}
              onClick={() => setStatusFilter(s)}
              className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                statusFilter === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "hover:bg-secondary"
              }`}
            >
              {s ? STATUS_LABELS[s] : "All"}
            </button>
          ))}
        </div>
      )}

      {/* Candidates table */}
      {filtered.length === 0 ? (
        <div className="rounded-md border border-dashed p-10 text-center text-muted-foreground text-sm">
          {statusFilter ? `No candidates with status "${STATUS_LABELS[statusFilter]}"` : "No candidates yet. Upload a CV above."}
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Candidate</th>
                <th className="text-left px-4 py-3 font-medium">Skills</th>
                <th className="text-left px-4 py-3 font-medium">Exp.</th>
                <th className="text-left px-4 py-3 font-medium">Score</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {filtered.map((cand) => (
                <tr key={cand.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium">{cand.name || "Unknown"}</div>
                    <div className="text-xs text-muted-foreground">{cand.email || "—"}</div>
                  </td>
                  <td className="px-4 py-3 max-w-[200px]">
                    <div className="flex flex-wrap gap-1">
                      {cand.skills.slice(0, 4).map((s) => (
                        <span key={s} className="text-xs bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded">
                          {s}
                        </span>
                      ))}
                      {cand.skills.length > 4 && (
                        <span className="text-xs text-muted-foreground">+{cand.skills.length - 4}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{cand.experience_years}y</td>
                  <td className="px-4 py-3">
                    <ScoreBar score={cand.score} />
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={cand.status}
                      onChange={(e) => handleStatusChange(cand.id, e.target.value)}
                      className={`text-xs px-2 py-1 rounded-full border-0 font-medium ${STATUS_COLORS[cand.status]} bg-transparent cursor-pointer`}
                    >
                      {Object.entries(STATUS_LABELS).map(([val, label]) => (
                        <option key={val} value={val}>{label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleStartAiInterview(cand)}
                      disabled={aiLoading === cand.id}
                      className="text-xs border px-2 py-1 rounded hover:bg-secondary disabled:opacity-50"
                    >
                      {aiLoading === cand.id ? "Generating…" : "AI Questions"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* AI Interview result modal */}
      {aiResult && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card border rounded-lg max-w-2xl w-full max-h-[80vh] overflow-y-auto p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="font-semibold text-lg">AI Interview Questions</h2>
                <p className="text-sm text-muted-foreground">
                  {aiResult.candidate_name} · {aiResult.job_title}
                </p>
              </div>
              <button
                onClick={() => setAiResult(null)}
                className="text-muted-foreground hover:text-foreground p-1"
              >
                ✕
              </button>
            </div>
            <pre className="whitespace-pre-wrap text-sm bg-muted/30 rounded-md p-4 font-sans leading-relaxed">
              {aiResult.questions}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
