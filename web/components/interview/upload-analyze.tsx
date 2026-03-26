"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { appFetch } from "@/lib/api-fetch";
import { ScoreBars } from "@/components/charts/score-bars";

type Topic = {
  id: string;
  topic: string;
  company_name?: string | null;
};

type AtsResult = {
  id?: string;
  topic_id?: string | null;
  created_at?: string;
  overall_score?: number;
  skill_match?: number;
  missing_skills?: string[];
  keyword_match?: number;
  experience_match?: number;
  tech_match?: number;
};

export function UploadAnalyze() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicId, setTopicId] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingTopics, setLoadingTopics] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<AtsResult[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const tr = await appFetch("/topics");
        if (!tr.ok) throw new Error(await tr.text());
        const list = (await tr.json()) as Topic[];
        setTopics(list);
        if (list.length) {
          setTopicId(list[0].id);
          const ar = await appFetch(`/ats?topic_id=${encodeURIComponent(list[0].id)}&limit=10`);
          if (ar.ok) setResults((await ar.json()) as AtsResult[]);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load jobs.");
      } finally {
        setLoadingTopics(false);
      }
    })();
  }, []);

  async function loadResultsForTopic(nextTopicId: string) {
    if (!nextTopicId) return;
    const r = await appFetch(`/ats?topic_id=${encodeURIComponent(nextTopicId)}&limit=10`);
    if (!r.ok) throw new Error(await r.text());
    setResults((await r.json()) as AtsResult[]);
  }

  async function onAnalyze() {
    setError(null);
    if (!topicId) {
      setError("Select a job title first.");
      return;
    }
    setLoading(true);
    try {
      const ar = await appFetch("/ats/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic_id: topicId }),
      });
      if (!ar.ok) throw new Error(await ar.text());
      await loadResultsForTopic(topicId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }

  const result = results[0] ?? null;
  const overall = result?.overall_score ?? 0;
  const skill = result?.skill_match ?? 0;

  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <Card className="shadow-md">
        <CardHeader>
          <CardTitle>ATS by job title</CardTitle>
          <CardDescription>Select a saved job and generate ATS result using the CV from Start page.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="topic">Job title</Label>
            <select
              id="topic"
              value={topicId}
              disabled={loadingTopics || !topics.length}
              onChange={async (e) => {
                const next = e.target.value;
                setTopicId(next);
                setError(null);
                try {
                  await loadResultsForTopic(next);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Failed to load ATS results.");
                }
              }}
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
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button onClick={onAnalyze} disabled={loading} className="w-fit">
            {loading ? "Analyzing..." : "Generate ATS"}
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

      {!!results.length && (
        <Card className="shadow-md">
          <CardHeader>
            <CardTitle>Previous ATS results</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {results.map((r) => (
              <div key={r.id || `${r.created_at}-${r.overall_score}`} className="rounded-lg border border-border px-3 py-2">
                <span className="font-medium">Score:</span> {(r.overall_score ?? 0).toFixed(1)}{" "}
                <span className="text-muted-foreground">({r.created_at ? new Date(r.created_at).toLocaleString() : "no date"})</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
