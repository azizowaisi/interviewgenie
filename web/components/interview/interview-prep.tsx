"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { appFetch } from "@/lib/api-fetch";

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
  const [jobDescription, setJobDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

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
      setSuccess("Job and CV saved. Continue to ATS, Mock, or Live pages.");
      setJobTitle("");
      setCompanyName("");
      setJobDescription("");
      setFile(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start interview");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="mx-auto max-w-2xl shadow-md">
      <CardHeader>
        <CardTitle>Start</CardTitle>
        <CardDescription>Create a job once with title, company, description, and CV.</CardDescription>
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
  );
}
