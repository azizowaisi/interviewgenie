"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { appFetch } from "@/lib/api-fetch";

const STATUS_PRESETS = [
  "Applied",
  "HR Interview",
  "Technical Interview",
  "Final Interview",
  "Offer",
  "Accepted",
  "Rejected",
];

type Topic = {
  id: string;
  topic: string;
  company_name?: string | null;
  cv_id?: string | null;
  cv_filename?: string | null;
  created_at?: string;
};

type AtsResult = {
  id?: string;
  created_at?: string;
  overall_score?: number;
  skill_match?: number;
  keyword_match?: number;
  experience_match?: number;
  tech_match?: number;
};

function messageFromFailedApiResponse(raw: string, status: number, fallback: string): string {
  const t = raw.trim();
  if (t.startsWith("<!") || /<html[\s>]/i.test(t)) {
    return `Server error (${status}). The response was HTML, not JSON — usually a Next.js or gateway failure. Check web and api-service pod logs; confirm API_URL in the web deployment reaches api-service inside the cluster.`;
  }
  let msg = t || fallback;
  try {
    const j = JSON.parse(raw) as { detail?: string; error?: string; message?: string };
    if (typeof j.detail === "string") msg = j.detail;
    else if (typeof j.message === "string") msg = j.message;
    else if (typeof j.error === "string" && j.error.startsWith("bff_")) {
      const d = typeof j.detail === "string" ? j.detail : "";
      msg = d ? `${j.error}: ${d}` : j.error;
    }
  } catch {
    /* keep msg */
  }
  return msg;
}

export function InterviewPrep() {
  const [jobTitle, setJobTitle] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [initialStatus, setInitialStatus] = useState("Applied");
  const [statusNote, setStatusNote] = useState("");
  const [appliedAt, setAppliedAt] = useState(() => {
    const d = new Date();
    d.setSeconds(0, 0);
    const offset = d.getTimezoneOffset();
    const local = new Date(d.getTime() - offset * 60000);
    return local.toISOString().slice(0, 16);
  });
  const [jobDescription, setJobDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loadingTopics, setLoadingTopics] = useState(true);

  const [replaceTopicId, setReplaceTopicId] = useState("");
  const [replaceFile, setReplaceFile] = useState<File | null>(null);
  const [replaceFileInputKey, setReplaceFileInputKey] = useState(0);
  const [replaceLoading, setReplaceLoading] = useState(false);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const [replaceSuccess, setReplaceSuccess] = useState<string | null>(null);
  const [compare, setCompare] = useState<{ before: AtsResult | null; after: AtsResult | null } | null>(null);

  async function loadTopics() {
    setLoadingTopics(true);
    try {
      const tr = await appFetch("/topics");
      if (!tr.ok) throw new Error(await tr.text());
      const list = (await tr.json()) as Topic[];
      setTopics(list);
      if (list.length && !replaceTopicId) {
        setReplaceTopicId(list[0].id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load saved jobs.");
    } finally {
      setLoadingTopics(false);
    }
  }

  useEffect(() => {
    void loadTopics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSave() {
    setError(null);
    setSuccess(null);
    if (!jobTitle.trim()) {
      setError("Add a job title or interview topic.");
      return;
    }
    if (!file) {
      setError("Upload a CV (PDF, DOCX, or TXT) to start.");
      return;
    }
    setLoading(true);
    try {
      const tRes = await appFetch("/topics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: jobTitle.trim(),
          company_name: companyName.trim() || undefined,
          job_description: jobDescription.trim() || undefined,
        }),
      });
      if (!tRes.ok) {
        const raw = await tRes.text();
        if (tRes.status === 401 || tRes.status === 403) {
          const hint = messageFromFailedApiResponse(raw, tRes.status, "");
          throw new Error(
            hint
              ? `Not authorized (${tRes.status}): ${hint}. If this persists: log out and log in; ensure AUTH0_AUDIENCE matches your Auth0 API identifier on web + api-service; AUTH0_CLIENT_ID matches the same Auth0 app.`
              : "Not authorized to save. Log out and log in again. If this persists: AUTH0_AUDIENCE on web must match api-service and your Auth0 API; api-service needs AUTH0_CLIENT_ID from the same Auth0 app; use a current web deploy (BFF forwards session tokens).",
          );
        }
        const msg = messageFromFailedApiResponse(raw, tRes.status, `Save failed (${tRes.status})`);
        throw new Error(msg);
      }
      const topicJson = (await tRes.json()) as { id: string };

      const fd = new FormData();
      fd.append("file", file);
      const cvRes = await appFetch(`/topics/${topicJson.id}/cv`, {
        method: "POST",
        body: fd,
      });
      if (!cvRes.ok) {
        const raw = await cvRes.text();
        if (cvRes.status === 401 || cvRes.status === 403) {
          const hint = messageFromFailedApiResponse(raw, cvRes.status, "");
          throw new Error(
            hint
              ? `Not authorized (${cvRes.status}): ${hint}. Log out and log in; check AUTH0_AUDIENCE + CLIENT_ID alignment.`
              : "Not authorized to upload CV. Log out and log in again after AUTH0_AUDIENCE is configured.",
          );
        }
        const msg = messageFromFailedApiResponse(raw, cvRes.status, `Upload failed (${cvRes.status})`);
        throw new Error(msg);
      }

      const statusRes = await appFetch("/candidate/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_title: jobTitle.trim(),
          company_name: companyName.trim() || undefined,
          topic_id: topicJson.id,
          status: initialStatus.trim() || "Applied",
          notes: statusNote.trim() || undefined,
          applied_at: appliedAt,
        }),
      });
      if (!statusRes.ok) {
        const raw = await statusRes.text();
        const msg = messageFromFailedApiResponse(raw, statusRes.status, `Status tracking failed (${statusRes.status})`);
        throw new Error(msg);
      }

      setSuccess("Job and CV saved. Continue to ATS, Mock, or Live pages.");
      setJobTitle("");
      setCompanyName("");
      setInitialStatus("Applied");
      setStatusNote("");
      setJobDescription("");
      setAppliedAt(() => {
        const d = new Date();
        d.setSeconds(0, 0);
        const offset = d.getTimezoneOffset();
        const local = new Date(d.getTime() - offset * 60000);
        return local.toISOString().slice(0, 16);
      });
      setFile(null);
      await loadTopics();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start interview");
    } finally {
      setLoading(false);
    }
  }

  async function onReplaceCv() {
    setReplaceError(null);
    setReplaceSuccess(null);
    setCompare(null);

    if (!replaceTopicId) {
      setReplaceError("Select an existing job first.");
      return;
    }
    if (!replaceFile) {
      setReplaceError("Choose the updated CV file first.");
      return;
    }

    setReplaceLoading(true);
    try {
      let before: AtsResult | null = null;
      const beforeRes = await appFetch(`/ats?topic_id=${encodeURIComponent(replaceTopicId)}&limit=1`);
      if (beforeRes.ok) {
        const arr = (await beforeRes.json()) as AtsResult[];
        before = arr[0] ?? null;
      }

      const fd = new FormData();
      fd.append("file", replaceFile);
      const cvRes = await appFetch(`/topics/${replaceTopicId}/cv`, {
        method: "POST",
        body: fd,
      });
      if (!cvRes.ok) {
        const raw = await cvRes.text();
        const msg = messageFromFailedApiResponse(raw, cvRes.status, `CV replace failed (${cvRes.status})`);
        throw new Error(msg);
      }

      const analyzeRes = await appFetch("/ats/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic_id: replaceTopicId }),
      });
      if (!analyzeRes.ok) {
        const raw = await analyzeRes.text();
        const msg = messageFromFailedApiResponse(raw, analyzeRes.status, `ATS analyze failed (${analyzeRes.status})`);
        throw new Error(msg);
      }

      let after: AtsResult | null = null;
      const afterRes = await appFetch(`/ats?topic_id=${encodeURIComponent(replaceTopicId)}&limit=1`);
      if (afterRes.ok) {
        const arr = (await afterRes.json()) as AtsResult[];
        after = arr[0] ?? null;
      }

      setCompare({ before, after });
      setReplaceSuccess("CV replaced and ATS re-analyzed for this job. See score change below.");
      setReplaceFile(null);
      setReplaceFileInputKey((k) => k + 1);
      await loadTopics();
    } catch (e) {
      setReplaceError(e instanceof Error ? e.message : "Could not replace CV");
    } finally {
      setReplaceLoading(false);
    }
  }

  function fmt(n?: number) {
    return (n ?? 0).toFixed(1);
  }

  function delta(after?: number, before?: number) {
    const d = (after ?? 0) - (before ?? 0);
    const sign = d > 0 ? "+" : "";
    return `${sign}${d.toFixed(1)}`;
  }

  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <Card className="shadow-md">
        <CardHeader>
          <CardTitle>Start</CardTitle>
          <CardDescription>Create a new job with title, company, description, and CV.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="job-title">Job title</Label>
          <Input
            id="job-title"
            placeholder="e.g. Senior Backend Engineer"
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="company-name">Company name</Label>
          <Input
            id="company-name"
            placeholder="e.g. Stripe"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
          />
        </div>
        <div className="grid gap-2 md:grid-cols-2 md:gap-4">
          <div className="grid gap-2">
            <Label htmlFor="initial-status">Initial status</Label>
            <div className="flex flex-wrap gap-2">
              {STATUS_PRESETS.map((status) => (
                <Button
                  key={status}
                  type="button"
                  size="sm"
                  variant={initialStatus === status ? "default" : "outline"}
                  onClick={() => setInitialStatus(status)}
                >
                  {status}
                </Button>
              ))}
            </div>
            <Input
              id="initial-status"
              placeholder="e.g. Applied"
              value={initialStatus}
              onChange={(e) => setInitialStatus(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="applied-at">Status date and time</Label>
            <Input
              id="applied-at"
              type="datetime-local"
              value={appliedAt}
              onChange={(e) => setAppliedAt(e.target.value)}
            />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="status-note">Status note</Label>
          <Textarea
            id="status-note"
            placeholder="e.g. Applied through referral"
            value={statusNote}
            onChange={(e) => setStatusNote(e.target.value)}
            className="min-h-[72px]"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="jd">Job description</Label>
          <Textarea
            id="jd"
            placeholder="Paste the job description (helps ATS and question generation)"
            value={jobDescription}
            onChange={(e) => setJobDescription(e.target.value)}
            className="min-h-[120px]"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="cv">CV (PDF / DOCX)</Label>
          <Input id="cv" type="file" accept=".pdf,.doc,.docx,.txt,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          {success && <p className="text-sm text-emerald-400">{success}</p>}
          <Button onClick={onSave} disabled={loading} className="w-fit">
            {loading ? "Saving..." : "Save Job"}
          </Button>
        </CardContent>
      </Card>

      <Card className="shadow-md">
        <CardHeader>
          <CardTitle>Saved jobs</CardTitle>
          <CardDescription>
            Select any old job, replace CV, then re-run ATS to compare old vs new score.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {loadingTopics ? (
            <p className="text-sm text-muted-foreground">Loading jobs...</p>
          ) : topics.length === 0 ? (
            <p className="text-sm text-muted-foreground">No saved jobs yet. Create one above first.</p>
          ) : (
            <div className="rounded-xl border border-border bg-secondary/20">
              {topics.map((t) => (
                <div key={t.id} className="flex flex-col gap-1 border-b border-border px-3 py-2 last:border-b-0 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="font-medium">{t.topic}{t.company_name ? ` - ${t.company_name}` : ""}</p>
                    <p className="text-xs text-muted-foreground">Current CV: {t.cv_filename || "Not uploaded"}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="replace-topic">Job to update</Label>
            <select
              id="replace-topic"
              value={replaceTopicId}
              disabled={loadingTopics || !topics.length}
              onChange={(e) => setReplaceTopicId(e.target.value)}
              className="flex h-10 w-full rounded-xl border border-input bg-secondary/50 px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {topics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.topic}
                  {t.company_name ? ` - ${t.company_name}` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="replace-cv">Updated CV (replace old CV)</Label>
            <Input
              key={replaceFileInputKey}
              id="replace-cv"
              type="file"
              accept=".pdf,.doc,.docx,.txt,application/pdf"
              onChange={(e) => setReplaceFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {replaceError && <p className="text-sm text-red-400">{replaceError}</p>}
          {replaceSuccess && <p className="text-sm text-emerald-400">{replaceSuccess}</p>}

          <Button onClick={onReplaceCv} disabled={replaceLoading || !topics.length} className="w-fit">
            {replaceLoading ? "Replacing & analyzing..." : "Replace CV + Run ATS"}
          </Button>

          {compare?.after && (
            <div className="grid gap-3 rounded-xl border border-border bg-secondary/20 p-4 text-sm">
              <p className="font-medium">ATS change after CV replacement</p>
              <div className="grid gap-2 md:grid-cols-2">
                <p>
                  Overall score: {fmt(compare.before?.overall_score)} {" -> "} {fmt(compare.after?.overall_score)}
                  <span className="ml-2 font-medium text-emerald-400">({delta(compare.after?.overall_score, compare.before?.overall_score)})</span>
                </p>
                <p>
                  Skill match: {fmt(compare.before?.skill_match)} {" -> "} {fmt(compare.after?.skill_match)}
                  <span className="ml-2 font-medium text-emerald-400">({delta(compare.after?.skill_match, compare.before?.skill_match)})</span>
                </p>
                <p>
                  Keyword match: {fmt(compare.before?.keyword_match)} {" -> "} {fmt(compare.after?.keyword_match)}
                  <span className="ml-2 font-medium text-emerald-400">({delta(compare.after?.keyword_match, compare.before?.keyword_match)})</span>
                </p>
                <p>
                  Experience match: {fmt(compare.before?.experience_match)} {" -> "} {fmt(compare.after?.experience_match)}
                  <span className="ml-2 font-medium text-emerald-400">({delta(compare.after?.experience_match, compare.before?.experience_match)})</span>
                </p>
                <p>
                  Tech match: {fmt(compare.before?.tech_match)} {" -> "} {fmt(compare.after?.tech_match)}
                  <span className="ml-2 font-medium text-emerald-400">({delta(compare.after?.tech_match, compare.before?.tech_match)})</span>
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
