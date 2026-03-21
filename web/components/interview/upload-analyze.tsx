"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { appFetch } from "@/lib/api-fetch";
import { ScoreBars } from "@/components/charts/score-bars";

type AtsResult = {
  overall_score?: number;
  skill_match?: number;
  missing_skills?: string[];
  keyword_match?: number;
  experience_match?: number;
  tech_match?: number;
};

export function UploadAnalyze() {
  const [file, setFile] = useState<File | null>(null);
  const [jd, setJd] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AtsResult | null>(null);

  async function onAnalyze() {
    setError(null);
    setResult(null);
    if (!file) {
      setError("Choose a CV file.");
      return;
    }
    if (!jd.trim()) {
      setError("Paste a job description.");
      return;
    }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const up = await appFetch("/cv/upload", { method: "POST", body: fd });
      if (!up.ok) throw new Error(await up.text());
      const { id: cv_id } = (await up.json()) as { id: string };

      const ar = await appFetch("/ats/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cv_id, job_description: jd.trim() }),
      });
      if (!ar.ok) throw new Error(await ar.text());
      setResult((await ar.json()) as AtsResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }

  const overall = result?.overall_score ?? 0;
  const skill = result?.skill_match ?? 0;

  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <Card className="shadow-md">
        <CardHeader>
          <CardTitle>CV &amp; job description</CardTitle>
          <CardDescription>Upload a CV and paste the JD to compute ATS-style match scores.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="cv">CV (PDF / DOCX)</Label>
            <Input id="cv" type="file" accept=".pdf,.doc,.docx,.txt,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="jd">Job description</Label>
            <Textarea id="jd" className="min-h-[160px]" value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Paste the full job description…" />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button onClick={onAnalyze} disabled={loading} className="w-fit">
            {loading ? "Analyzing…" : "Analyze"}
          </Button>
        </CardContent>
      </Card>

      {result && (
        <Card className="shadow-md">
          <CardHeader>
            <CardTitle>Results</CardTitle>
            <CardDescription>ATS score, skill match, and gaps vs. the job description.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-2">
            <div className="space-y-4">
              <div className="rounded-xl bg-secondary/40 p-4 shadow-md">
                <p className="text-sm text-muted-foreground">ATS score (overall)</p>
                <p className="text-3xl font-bold text-primary">{overall.toFixed(1)}</p>
              </div>
              <div className="rounded-xl bg-secondary/40 p-4 shadow-md">
                <p className="text-sm text-muted-foreground">Skill match %</p>
                <p className="text-3xl font-bold">{skill.toFixed(1)}</p>
              </div>
            </div>
            <div className="space-y-4">
              <ScoreBars
                items={[
                  { label: "Keyword match", value: result.keyword_match ?? 0, max: 100 },
                  { label: "Experience match", value: result.experience_match ?? 0, max: 100 },
                  { label: "Tech match", value: result.tech_match ?? 0, max: 100 },
                ]}
              />
            </div>
            <div className="md:col-span-2">
              <p className="mb-2 text-sm font-medium text-muted-foreground">Missing skills</p>
              <ul className="list-inside list-disc rounded-xl border border-border bg-secondary/20 p-4 text-sm">
                {(result.missing_skills?.length ? result.missing_skills : ["None flagged"]).map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
