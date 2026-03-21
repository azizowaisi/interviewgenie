"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScoreBars } from "@/components/charts/score-bars";
import { loadResultSession, type ResultSession } from "@/lib/session";
import { appFetch } from "@/lib/api-fetch";

function splitFeedback(summary: string) {
  const parts = summary
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const mid = Math.max(1, Math.floor(parts.length / 2));
  return { strengths: parts.slice(0, mid), weaknesses: parts.slice(mid) };
}

function subscores(overall10: number) {
  const base = overall10 * 10;
  return {
    overall: Math.round(Math.min(100, Math.max(0, base))),
    technical: Math.round(Math.min(100, Math.max(0, base + 4))),
    communication: Math.round(Math.min(100, Math.max(0, base - 6))),
    confidence: Math.round(Math.min(100, Math.max(0, base + 2))),
  };
}

export function ResultView() {
  const searchParams = useSearchParams();
  const attemptId = searchParams.get("attempt");
  const [data, setData] = useState<ResultSession | null>(null);
  const [loading, setLoading] = useState(!!attemptId);

  useEffect(() => {
    if (!attemptId) {
      setData(loadResultSession());
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await appFetch(`/attempts/${attemptId}`);
        if (!r.ok) throw new Error(await r.text());
        const j = (await r.json()) as {
          topic_id: string;
          score: number | null;
          evaluation_summary?: string | null;
        };
        if (cancelled) return;
        const score = typeof j.score === "number" ? j.score : 0;
        const summary = (j.evaluation_summary || "").trim();
        const { strengths, weaknesses } = splitFeedback(summary || "No detailed feedback stored.");
        setData({
          ...subscores(score),
          strengths,
          weaknesses,
          feedback: summary || "—",
          topicId: j.topic_id,
          attemptId,
        });
      } catch {
        if (!cancelled) setData(loadResultSession());
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attemptId]);

  if (loading) {
    return (
      <Card className="mx-auto max-w-lg shadow-md">
        <CardContent className="p-8 text-center text-muted-foreground">Loading report…</CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card className="mx-auto max-w-lg shadow-md">
        <CardHeader>
          <CardTitle>No results yet</CardTitle>
          <CardDescription>Complete a mock interview to see your scores and feedback.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/interview">Start Interview</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <Card className="shadow-md">
        <CardHeader>
          <CardTitle>Your results</CardTitle>
          <CardDescription>Scores are derived from the AI evaluation (0–10 scaled to 100 where shown).</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-xl bg-primary/10 p-4 shadow-md">
              <p className="text-sm text-muted-foreground">Overall score</p>
              <p className="text-4xl font-bold text-primary">{data.overall}</p>
            </div>
            <ScoreBars
              className="sm:col-span-1"
              items={[
                { label: "Technical", value: data.technical },
                { label: "Communication", value: data.communication },
                { label: "Confidence", value: data.confidence },
              ]}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-2 text-sm font-medium text-primary">Strengths</p>
              <ul className="list-inside list-disc space-y-1 rounded-xl border border-border bg-secondary/20 p-4 text-sm">
                {data.strengths.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-amber-400">Weaknesses</p>
              <ul className="list-inside list-disc space-y-1 rounded-xl border border-border bg-secondary/20 p-4 text-sm">
                {data.weaknesses.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">AI feedback</p>
            <p className="rounded-xl bg-secondary/30 p-4 text-sm leading-relaxed text-muted-foreground">{data.feedback}</p>
          </div>
          <Button asChild className="w-fit">
            <Link href="/interview">Retake Interview</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
