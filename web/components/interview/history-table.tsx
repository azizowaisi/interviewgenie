"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { appFetch } from "@/lib/api-fetch";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Topic = { id: string; topic: string; company_name?: string | null; created_at: string };
type Attempt = {
  id: string;
  attempt_number: number;
  score: number | null;
  start_time: string;
};

export function HistoryTable() {
  const [rows, setRows] = useState<
    {
      topic: Topic;
      attempts: number;
      bestScore: number | null;
      lastDate: string;
      lastAttemptId: string | null;
    }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const tr = await appFetch("/topics");
        if (!tr.ok) throw new Error(await tr.text());
        const topics = (await tr.json()) as Topic[];
        const enriched = await Promise.all(
          topics.map(async (topic) => {
            const ar = await appFetch(`/topics/${topic.id}/attempts`);
            const attempts: Attempt[] = ar.ok ? await ar.json() : [];
            const scores = attempts.map((a) => a.score).filter((s): s is number => typeof s === "number");
            const bestScore = scores.length ? Math.max(...scores) : null;
            const last =
              attempts.length > 0
                ? attempts.reduce((a, b) => (a.start_time > b.start_time ? a : b))
                : null;
            const lastDate = last?.start_time ?? topic.created_at;
            return {
              topic,
              attempts: attempts.length,
              bestScore,
              lastDate,
              lastAttemptId: last?.id ?? null,
            };
          })
        );
        if (!cancelled) setRows(enriched);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load history");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <p className="text-muted-foreground">Loading history…</p>;
  }
  if (error) {
    return (
      <Card className="shadow-md">
        <CardContent className="p-6 text-sm text-red-400">{error}</CardContent>
      </Card>
    );
  }
  if (!rows.length) {
    return (
      <Card className="shadow-md">
        <CardContent className="p-8 text-center text-muted-foreground">
          No interviews yet.{" "}
          <Link href="/interview" className="text-primary underline">
            Start one
          </Link>
          .
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-md">
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job title</TableHead>
              <TableHead>Attempts</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.topic.id}>
                <TableCell className="font-medium">
                  {r.topic.topic}
                  {r.topic.company_name ? (
                    <p className="text-xs font-normal text-muted-foreground">{r.topic.company_name}</p>
                  ) : null}
                </TableCell>
                <TableCell>{r.attempts}</TableCell>
                <TableCell>
                  {r.bestScore != null ? (
                    <Badge variant="secondary">{(r.bestScore * 10).toFixed(0)}</Badge>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(r.lastDate).toLocaleString()}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="outline" asChild>
                      <Link href={r.lastAttemptId ? `/result?attempt=${r.lastAttemptId}` : "/result"}>
                        View Report
                      </Link>
                    </Button>
                    <Button size="sm" asChild>
                      <Link href="/mock">Retake</Link>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
