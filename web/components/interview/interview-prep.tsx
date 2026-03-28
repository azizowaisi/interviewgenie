"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { appFetch } from "@/lib/api-fetch";

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
        const body = await tRes.text();
        if (tRes.status === 401 || tRes.status === 403) {
          throw new Error(
            "Not authorized to save. Log out and log in again. If this persists: AUTH0_AUDIENCE on web must match api-service and your Auth0 API; api-service needs AUTH0_CLIENT_ID from the same Auth0 app; use a current web deploy (BFF forwards session tokens)."
          );
        }
        throw new Error(body || `Save failed (${tRes.status})`);
      }
      const topicJson = (await tRes.json()) as { id: string };

      const fd = new FormData();
      fd.append("file", file);
      const cvRes = await appFetch(`/topics/${topicJson.id}/cv`, {
        method: "POST",
        body: fd,
      });
      if (!cvRes.ok) {
        const body = await cvRes.text();
        if (cvRes.status === 401 || cvRes.status === 403) {
          throw new Error(
            "Not authorized to upload CV. Log out and log in again after AUTH0_AUDIENCE is configured."
          );
        }
        throw new Error(body || `Upload failed (${cvRes.status})`);
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
