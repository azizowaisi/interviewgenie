"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { audioFetch } from "@/lib/api-fetch";
import {
  getJob,
  listCandidates,
  uploadCandidateCV,
  updateCandidateStatus,
  deleteCandidate,
  startAiInterview,
  evaluateAiInterview,
  type Job,
  type Candidate,
  type AiInterviewResult,
  type InterviewEvaluateResult,
} from "@/lib/recruiter-api";

type QAPair = { question: string; answer: string };

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

  type UploadItem = { name: string; status: "pending" | "uploading" | "done" | "error"; error?: string };

  const [job, setJob] = useState<Job | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<UploadItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [aiResult, setAiResult] = useState<AiInterviewResult | null>(null);
  const [aiLoading, setAiLoading] = useState<string | null>(null); // candidate id
  const [interviewType, setInterviewType] = useState<"technical" | "personality" | "hr">("technical");
  const [interviewDuration, setInterviewDuration] = useState<number>(30);
  const [setupCandidate, setSetupCandidate] = useState<Candidate | null>(null);
  const [activeCandidate, setActiveCandidate] = useState<Candidate | null>(null);
  const [interviewHistory, setInterviewHistory] = useState<QAPair[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [currentAnswer, setCurrentAnswer] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [askingNext, setAskingNext] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [evalResult, setEvalResult] = useState<InterviewEvaluateResult | null>(null);
  const [listening, setListening] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const transcribeQueueRef = useRef<Blob[]>([]);
  const transcribingRef = useRef(false);
  const autoFinishedRef = useRef(false);

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

  const timerLabel = `${Math.floor(secondsLeft / 60)}:${(secondsLeft % 60).toString().padStart(2, "0")}`;

  useEffect(() => { load(); }, [load]);

  async function handleCVUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;

    const MAX_FILES = 20;
    const MAX_BYTES = 3 * 1024 * 1024; // 3 MB

    const selected = files.slice(0, MAX_FILES);
    if (files.length > MAX_FILES) {
      setError(`Maximum ${MAX_FILES} files allowed. Only the first ${MAX_FILES} were queued.`);
    } else {
      setError(null);
    }

    const queue: UploadItem[] = selected.map((f) => {
      if (f.size > MAX_BYTES) {
        return { name: f.name, status: "error", error: `Exceeds 3 MB (${(f.size / 1024 / 1024).toFixed(1)} MB)` };
      }
      return { name: f.name, status: "pending" };
    });
    setUploadQueue(queue);
    setUploading(true);

    for (let i = 0; i < selected.length; i++) {
      if (queue[i].status === "error") continue; // already flagged oversized
      setUploadQueue((prev) => prev.map((item, idx) => idx === i ? { ...item, status: "uploading" } : item));
      try {
        const cand = await uploadCandidateCV(jobId, selected[i]);
        setCandidates((prev) => [cand, ...prev]);
        setUploadQueue((prev) => prev.map((item, idx) => idx === i ? { ...item, status: "done" } : item));
      } catch (err) {
        setUploadQueue((prev) =>
          prev.map((item, idx) =>
            idx === i ? { ...item, status: "error", error: err instanceof Error ? err.message : "Upload failed" } : item
          )
        );
      }
    }

    setUploading(false);
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

  async function handleDeleteCandidate(candidateId: string, name: string) {
    if (!window.confirm(`Delete ${name || "this candidate"}? This cannot be undone.`)) return;
    try {
      await deleteCandidate(candidateId);
      setCandidates((prev) => prev.filter((c) => c.id !== candidateId));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function handleStartAiInterview(candidate: Candidate) {
    setSetupCandidate(null);
    setAiLoading(candidate.id);
    setAiResult(null);
    try {
      const result = await startAiInterview(jobId, candidate.id, interviewType, 1, []);
      setAiResult(result);
      setActiveCandidate(candidate);
      const parsed = parseQuestions(result.questions);
      setInterviewHistory([]);
      setCurrentQuestion(parsed[0] || "Tell me about your experience relevant to this role.");
      setCurrentAnswer("");
      setSecondsLeft(interviewDuration * 60);
      autoFinishedRef.current = false;
      setEvalResult(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "AI interview failed");
    } finally {
      setAiLoading(null);
    }
  }

  function parseQuestions(raw: string): string[] {
    const lines = (raw || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => l.replace(/^\d+[.)-]?\s*/, "").trim())
      .filter(Boolean);
    const uniq = Array.from(new Set(lines));
    return uniq.slice(0, 10);
  }

  async function drainTranscribeQueue() {
    if (transcribingRef.current) return;
    transcribingRef.current = true;
    try {
      while (transcribeQueueRef.current.length > 0) {
        const blob = transcribeQueueRef.current.shift();
        if (!blob || blob.size === 0) continue;
        const form = new FormData();
        form.append("file", blob, "interview-audio.webm");
        const tr = await audioFetch("/live/transcribe", {
          method: "POST",
          body: form,
        });
        if (!tr.ok) throw new Error(await tr.text());
        const tj = (await tr.json()) as { text?: string };
        const text = (tj.text || "").trim();
        if (text) {
          setCurrentAnswer((prev) => [prev.trim(), text].filter(Boolean).join(" "));
        }
      }
      setTranscribeError(null);
    } catch (e) {
      setTranscribeError(e instanceof Error ? e.message : "Computer audio transcription failed");
    } finally {
      transcribingRef.current = false;
      if (transcribeQueueRef.current.length > 0) {
        void drainTranscribeQueue();
      }
    }
  }

  function stopListening() {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        // ignore
      }
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    transcribeQueueRef.current = [];
    setListening(false);
  }

  async function startListening() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      alert("Your browser does not support computer audio capture.");
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      alert("This browser does not support MediaRecorder for computer audio capture.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      const audioTracks = stream.getAudioTracks();
      if (!audioTracks.length) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("No computer audio track was shared. Enable system/tab audio when sharing.");
      }

      const audioOnlyStream = new MediaStream(audioTracks);

      type RecorderConfig = { source: MediaStream; mime: string };
      const candidates: RecorderConfig[] = [
        { source: audioOnlyStream, mime: "audio/webm;codecs=opus" },
        { source: audioOnlyStream, mime: "audio/webm" },
        { source: audioOnlyStream, mime: "" },
        { source: stream, mime: "video/webm;codecs=vp8,opus" },
        { source: stream, mime: "video/webm" },
        { source: stream, mime: "" },
      ];

      let recorder: MediaRecorder | null = null;
      for (const candidate of candidates) {
        if (
          candidate.mime &&
          typeof MediaRecorder.isTypeSupported === "function" &&
          !MediaRecorder.isTypeSupported(candidate.mime)
        ) {
          continue;
        }
        try {
          const created = candidate.mime
            ? new MediaRecorder(candidate.source, { mimeType: candidate.mime })
            : new MediaRecorder(candidate.source);
          created.start(4000);
          recorder = created;
          break;
        } catch {
          // Try next candidate stream/mime pair.
        }
      }

      if (!recorder) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("Could not start computer audio recording. Use Chrome/Edge and enable tab/system audio.");
      }

      recorder.ondataavailable = (event) => {
        if (event.data?.size) {
          transcribeQueueRef.current.push(event.data);
          void drainTranscribeQueue();
        }
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        setListening(false);
      };
      audioTracks[0].onended = () => stopListening();

      streamRef.current = stream;
      recorderRef.current = recorder;
      setTranscribeError(null);
      setListening(true);
    } catch (e) {
      stopListening();
      alert(e instanceof Error ? e.message : "Computer audio capture could not start.");
    }
  }

  async function handleSubmitAnswerAndNext() {
    if (!activeCandidate || !currentQuestion || askingNext || evaluating) return;
    if (secondsLeft <= 0) {
      await handleEvaluateInterview();
      return;
    }
    const answer = currentAnswer.trim();
    if (!answer) {
      alert("Please enter or speak an answer before continuing.");
      return;
    }

    const nextHistory = [...interviewHistory, { question: currentQuestion, answer }];
    setInterviewHistory(nextHistory);
    setCurrentAnswer("");
    setTranscribeError(null);
    setAskingNext(true);
    try {
      if (secondsLeft <= 0) {
        await handleEvaluateInterview();
        return;
      }
      const prevQuestions = nextHistory.map((x) => x.question);
      const next = await startAiInterview(jobId, activeCandidate.id, interviewType, 1, prevQuestions);
      const parsed = parseQuestions(next.questions);
      setCurrentQuestion(parsed[0] || "Could you expand on your previous answer with a concrete example?");
      setAiResult(next);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not generate next question");
    } finally {
      setAskingNext(false);
    }
  }

  async function handleEvaluateInterview() {
    if (!activeCandidate) return;
    stopListening();
    const pending = currentAnswer.trim();
    const qa = [...interviewHistory];
    if (currentQuestion && pending) qa.push({ question: currentQuestion, answer: pending });
    if (!qa.some((x) => x.answer)) {
      alert("Add at least one answer before evaluation.");
      return;
    }
    setEvaluating(true);
    try {
      const result = await evaluateAiInterview(jobId, activeCandidate.id, interviewType, qa);
      setEvalResult(result);
      await load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Interview evaluation failed");
    } finally {
      setEvaluating(false);
    }
  }

  useEffect(() => {
    if (!aiResult || evalResult) return;
    if (secondsLeft <= 0) return;
    const t = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [aiResult, evalResult, secondsLeft]);

  useEffect(() => {
    if (!aiResult || evalResult) return;
    if (secondsLeft > 0) return;
    if (evaluating || autoFinishedRef.current) return;
    autoFinishedRef.current = true;
    void handleEvaluateInterview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiResult, evalResult, secondsLeft, evaluating]);

  useEffect(() => {
    if (aiResult) return;
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        // ignore
      }
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    transcribeQueueRef.current = [];
    setListening(false);
    setSecondsLeft(0);
    autoFinishedRef.current = false;
  }, [aiResult]);

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
      <div className="mb-6 p-4 rounded-lg border bg-card space-y-3">
        <div className="flex items-center gap-4">
          <label className={`cursor-pointer ${uploading ? "pointer-events-none opacity-60" : ""}`}>
            <span className="bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-medium hover:bg-primary/90 inline-block">
              {uploading ? "Uploading…" : "Upload CVs (PDF/DOCX)"}
            </span>
            <input
              type="file"
              accept=".pdf,.docx,.txt"
              multiple
              onChange={handleCVUpload}
              disabled={uploading}
              className="sr-only"
            />
          </label>
          <span className="text-xs text-muted-foreground">Max 20 files · 3 MB each</span>
          <span className="text-sm text-muted-foreground ml-auto">
            {candidates.length} candidate{candidates.length !== 1 ? "s" : ""}
          </span>
        </div>

        {uploadQueue.length > 0 && (
          <ul className="space-y-1 max-h-40 overflow-y-auto">
            {uploadQueue.map((item, i) => (
              <li key={i} className="flex items-center gap-2 text-xs">
                <span
                  className={`inline-block w-2 h-2 rounded-full shrink-0 ${
                    item.status === "done"
                      ? "bg-emerald-500"
                      : item.status === "uploading"
                      ? "bg-yellow-400 animate-pulse"
                      : item.status === "error"
                      ? "bg-red-500"
                      : "bg-muted-foreground/40"
                  }`}
                />
                <span className="truncate max-w-[280px] text-muted-foreground">{item.name}</span>
                {item.status === "uploading" && <span className="text-yellow-400">Uploading…</span>}
                {item.status === "done" && <span className="text-emerald-500">Done</span>}
                {item.status === "error" && <span className="text-red-500">{item.error ?? "Error"}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="text-destructive text-sm mb-4">{error}</p>}

      {/* Filter */}
      {candidates.length > 0 && (
        <div className="flex gap-2 mb-4 flex-wrap items-center">

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
                <th className="text-left px-4 py-3 font-medium">Interview</th>
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
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {typeof cand.interview_score === "number" ? `${cand.interview_score.toFixed(1)}/10` : "—"}
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
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setSetupCandidate(cand)}
                        disabled={aiLoading === cand.id}
                        className="text-xs border px-2 py-1 rounded hover:bg-secondary disabled:opacity-50"
                      >
                        {aiLoading === cand.id ? "Generating…" : "Start Interview"}
                      </button>
                      <button
                        onClick={() => handleDeleteCandidate(cand.id, cand.name)}
                        title="Delete candidate"
                        className="text-xs border border-destructive/40 text-destructive px-2 py-1 rounded hover:bg-destructive/10"
                      >
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Setup modal — duration + type before calling AI */}
      {setupCandidate && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card border rounded-lg w-full max-w-md p-6 space-y-6">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-semibold text-lg">Interview Setup</h2>
                <p className="text-sm text-muted-foreground mt-0.5">{setupCandidate.name || "Candidate"}</p>
              </div>
              <button
                onClick={() => setSetupCandidate(null)}
                className="text-muted-foreground hover:text-foreground p-1"
              >
                ✕
              </button>
            </div>

            {/* Step 1: Duration */}
            <div>
              <label className="block text-sm font-medium mb-2">Interview duration</label>
              <div className="grid grid-cols-4 gap-2">
                {[15, 30, 45, 60].map((min) => (
                  <button
                    key={min}
                    onClick={() => setInterviewDuration(min)}
                    className={`py-2 rounded-md border text-sm font-medium transition-colors ${
                      interviewDuration === min
                        ? "bg-primary text-primary-foreground border-primary"
                        : "hover:bg-secondary"
                    }`}
                  >
                    {min} min
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Questions are generated one-by-one until the selected time ends.
              </p>
            </div>

            {/* Step 2: Interview type */}
            <div>
              <label className="block text-sm font-medium mb-2">Interview type</label>
              <div className="grid grid-cols-3 gap-2">
                {(["technical", "personality", "hr"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setInterviewType(t)}
                    className={`py-2 rounded-md border text-sm font-medium capitalize transition-colors ${
                      interviewType === t
                        ? "bg-primary text-primary-foreground border-primary"
                        : "hover:bg-secondary"
                    }`}
                  >
                    {t === "hr" ? "HR" : t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Create */}
            <button
              onClick={() => handleStartAiInterview(setupCandidate)}
              disabled={aiLoading === setupCandidate.id}
              className="w-full py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
            >
              {aiLoading === setupCandidate.id ? "Generating questions…" : "Create Interview"}
            </button>
          </div>
        </div>
      )}

      {/* AI Interview result modal */}
      {aiResult && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card border rounded-lg max-w-2xl w-full max-h-[80vh] overflow-y-auto p-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="font-semibold text-lg">Recruiter Interview</h2>
                <p className="text-sm text-muted-foreground">
                  {aiResult.candidate_name} · {aiResult.job_title} · {interviewType.toUpperCase()}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className={`rounded-full px-3 py-1 text-sm font-medium tabular-nums ${secondsLeft < 120 ? "bg-yellow-500/10 text-yellow-300" : "bg-secondary text-secondary-foreground"}`}>
                  {timerLabel}
                </div>
                <button
                  onClick={() => {
                    setAiResult(null);
                    setEvalResult(null);
                    setInterviewHistory([]);
                    setCurrentQuestion("");
                    setCurrentAnswer("");
                    setTranscribeError(null);
                  }}
                  className="text-muted-foreground hover:text-foreground p-1"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-md border p-3 bg-muted/20">
                <p className="text-sm font-medium mb-2">
                  Q{interviewHistory.length + 1}. {currentQuestion || "Loading question…"}
                </p>
                {transcribeError && <p className="mb-2 text-xs text-red-400">{transcribeError}</p>}
                <textarea
                  value={currentAnswer}
                  onChange={(e) => setCurrentAnswer(e.target.value)}
                  placeholder="Type answer or start computer audio once for the whole interview"
                  className="w-full min-h-[90px] rounded-md border bg-background p-2 text-sm"
                />
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={() => (listening ? stopListening() : startListening())}
                    disabled={evaluating || askingNext}
                    className="text-xs border px-2 py-1 rounded hover:bg-secondary disabled:opacity-50"
                  >
                    {listening ? "Stop computer audio" : "Start computer audio"}
                  </button>
                  <span className="text-xs text-muted-foreground">
                    Capture the interviewee from system/tab audio, not your microphone.
                  </span>
                </div>
              </div>

              {interviewHistory.length > 0 && (
                <div className="rounded-md border p-3 bg-background">
                  <p className="text-xs font-semibold text-muted-foreground mb-2">Submitted answers</p>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {interviewHistory.map((qa, i) => (
                      <div key={`${qa.question}-${i}`} className="text-xs">
                        <p className="font-medium">Q{i + 1}. {qa.question}</p>
                        <p className="text-muted-foreground line-clamp-2">A: {qa.answer}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {evalResult && (
              <div className="mt-4 rounded-md border bg-secondary/20 p-3 text-sm">
                <p className="font-semibold mb-1">Interview Result: {evalResult.score.toFixed(1)}/10</p>
                <p className="text-muted-foreground mb-2">{evalResult.summary}</p>
                {evalResult.cv_suggestions?.length ? (
                  <ul className="list-disc list-inside text-xs text-muted-foreground space-y-1">
                    {evalResult.cv_suggestions.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <button
                onClick={handleSubmitAnswerAndNext}
                disabled={!currentQuestion || askingNext || evaluating || secondsLeft <= 0}
                className="text-sm px-3 py-2 rounded-md border hover:bg-secondary disabled:opacity-50"
              >
                {askingNext ? "Generating next question…" : "Submit answer & next question"}
              </button>
              <button
                onClick={handleEvaluateInterview}
                disabled={evaluating || (!interviewHistory.length && !currentAnswer.trim())}
                className="text-sm px-3 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {evaluating ? "Evaluating…" : "End Interview & Evaluate"}
              </button>
              <button
                onClick={() => setAiResult(null)}
                className="text-sm px-3 py-2 rounded-md border hover:bg-secondary"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
