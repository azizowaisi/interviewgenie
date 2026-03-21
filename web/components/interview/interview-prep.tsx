"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { appFetch } from "@/lib/api-fetch";
import { saveInterviewSession } from "@/lib/session";

export function InterviewPrep() {
  const [topic, setTopic] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [interviewType, setInterviewType] = useState<"technical" | "hr">("technical");
  const [duration, setDuration] = useState<15 | 30 | 60>(30);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onStart() {
    setError(null);
    if (!topic.trim()) {
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
          topic: topic.trim(),
          job_description: jobDescription.trim() || undefined,
          interview_type: interviewType,
          duration_minutes: duration,
        }),
      });
      if (!tRes.ok) throw new Error(await tRes.text());
      const topicJson = (await tRes.json()) as { id: string };

      const fd = new FormData();
      fd.append("file", file);
      const cvRes = await appFetch(`/topics/${topicJson.id}/cv`, {
        method: "POST",
        body: fd,
      });
      if (!cvRes.ok) throw new Error(await cvRes.text());

      const aRes = await appFetch(`/topics/${topicJson.id}/attempts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!aRes.ok) throw new Error(await aRes.text());
      const attemptJson = (await aRes.json()) as { id: string };

      saveInterviewSession({
        topicId: topicJson.id,
        attemptId: attemptJson.id,
        interviewType,
        durationMinutes: duration,
      });
      window.location.href = "/mock";
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start interview");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="mx-auto max-w-2xl shadow-md">
      <CardHeader>
        <CardTitle>Interview dashboard</CardTitle>
        <CardDescription>Upload your CV, paste the job description, then start a timed mock interview.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="topic">Job title / topic</Label>
          <Input
            id="topic"
            placeholder="e.g. Senior Backend Engineer"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="type">Interview type</Label>
            <select
              id="type"
              value={interviewType}
              onChange={(e) => setInterviewType(e.target.value as "technical" | "hr")}
              className="flex h-10 w-full rounded-xl border border-input bg-secondary/50 px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="technical">Technical</option>
              <option value="hr">HR</option>
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="dur">Duration</Label>
            <select
              id="dur"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value) as 15 | 30 | 60)}
              className="flex h-10 w-full rounded-xl border border-input bg-secondary/50 px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value={15}>15 min</option>
              <option value={30}>30 min</option>
              <option value={60}>60 min</option>
            </select>
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="cv">CV (PDF / DOCX)</Label>
          <Input id="cv" type="file" accept=".pdf,.doc,.docx,.txt,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex flex-wrap gap-4 pt-2">
          <Button onClick={onStart} disabled={loading}>
            {loading ? "Starting…" : "Start Interview"}
          </Button>
          <Button variant="secondary" asChild>
            <Link href="/upload">Upload &amp; ATS only</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/history">View History</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
