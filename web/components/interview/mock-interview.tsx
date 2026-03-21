"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { appFetch, audioFetch } from "@/lib/api-fetch";
import { loadInterviewSession, saveResultSession, type InterviewSession } from "@/lib/session";

type TopicResponse = {
  id: string;
  topic: string;
  job_description?: string | null;
  cv_id?: string | null;
  interview_type?: string;
  duration_minutes?: number;
};

type CvResponse = {
  parsed_text: string;
};

type QAPair = { question: string; answer: string };

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

export function MockInterview() {
  const router = useRouter();
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [topic, setTopic] = useState<TopicResponse | null>(null);
  const [questions, setQuestions] = useState<string[]>([]);
  const [idx, setIdx] = useState(0);
  const [draft, setDraft] = useState("");
  const [transcript, setTranscript] = useState("");
  const [pairs, setPairs] = useState<QAPair[]>([]);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);

  const currentQuestion = questions[idx] ?? "";
  const isLastQuestion = questions.length > 0 && idx === questions.length - 1;

  const persistLocal = useCallback(
    (nextPairs: QAPair[], nextIdx: number, nextDraft: string, tx: string) => {
      if (!session) return;
      const key = `ig_mock_${session.attemptId}`;
      localStorage.setItem(
        key,
        JSON.stringify({ pairs: nextPairs, idx: nextIdx, draft: nextDraft, transcript: tx, questions })
      );
    },
    [session, questions]
  );

  useEffect(() => {
    const s = loadInterviewSession();
    if (!s) {
      setLoading(false);
      setError("No active session. Start from the interview dashboard.");
      return;
    }
    setSession(s);
    setSecondsLeft(s.durationMinutes * 60);
  }, []);

  useEffect(() => {
    if (!session) return;
    const key = `ig_mock_${session.attemptId}`;
    const raw = localStorage.getItem(key);
    if (raw) {
      try {
        const saved = JSON.parse(raw) as {
          pairs?: QAPair[];
          idx?: number;
          draft?: string;
          transcript?: string;
          questions?: string[];
        };
        if (saved.pairs?.length) setPairs(saved.pairs);
        if (typeof saved.idx === "number") setIdx(saved.idx);
        if (saved.draft) setDraft(saved.draft);
        if (saved.transcript) setTranscript(saved.transcript);
        if (saved.questions?.length) setQuestions(saved.questions);
      } catch {
        /* ignore */
      }
    }
  }, [session]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    (async () => {
      try {
        const tr = await appFetch(`/topics/${session.topicId}`);
        if (!tr.ok) throw new Error(await tr.text());
        const tj = (await tr.json()) as TopicResponse;
        if (cancelled) return;

        let cv = "";
        if (tj.cv_id) {
          const cr = await appFetch(`/cv/${tj.cv_id}`);
          if (cr.ok) {
            const cj = (await cr.json()) as CvResponse;
            cv = (cj.parsed_text || "").trim();
          }
        }

        if (cancelled) return;
        setTopic(tj);

        const gr = await audioFetch("/mock/generate-questions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            job_description: (tj.job_description || "").slice(0, 3000),
            cv_text: cv.slice(0, 3000),
            interview_type: session.interviewType,
            num_questions: 5,
            previous_questions: [],
          }),
        });
        if (!gr.ok) throw new Error(await gr.text());
        const gj = (await gr.json()) as { questions?: string[] };
        if (cancelled) return;
        const qs =
          gj.questions?.length ? gj.questions : ["Tell me about your relevant experience for this role."];
        setQuestions((prev) => (prev.length ? prev : qs));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load interview");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (!session || secondsLeft <= 0) return;
    const t = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [session, secondsLeft]);

  const fmt = useMemo(() => {
    const m = Math.floor(secondsLeft / 60);
    const s = secondsLeft % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }, [secondsLeft]);

  async function savePairToApi(question: string, answer: string, orderIndex: number) {
    if (!session) return;
    await appFetch(`/attempts/${session.attemptId}/questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, answer, order_index: orderIndex }),
    });
  }

  async function goNext() {
    if (!currentQuestion) return;
    const answer = draft.trim();
    const nextPairs = [...pairs, { question: currentQuestion, answer }];
    const nextIdx = idx + 1;
    setPairs(nextPairs);
    await savePairToApi(currentQuestion, answer, pairs.length);
    setTranscript((t) => (t ? `${t}\n\nQ: ${currentQuestion}\nA: ${answer}` : `Q: ${currentQuestion}\nA: ${answer}`));
    setDraft("");

    if (nextIdx >= questions.length) {
      await finishInterview(nextPairs);
      return;
    }

    setIdx(nextIdx);
    persistLocal(nextPairs, nextIdx, "", transcript);
  }

  async function finishInterview(finalPairs?: QAPair[]) {
    const qa = finalPairs ?? pairs;
    if (!session || qa.length === 0) {
      setError("Answer at least one question before finishing.");
      return;
    }
    setFinishing(true);
    setError(null);
    try {
      const ev = await audioFetch("/mock/evaluate-attempt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questions_and_answers: qa }),
      });
      if (!ev.ok) throw new Error(await ev.text());
      const ej = (await ev.json()) as { score?: number; evaluation_summary?: string };
      const score = typeof ej.score === "number" ? ej.score : 0;
      const summary = ej.evaluation_summary || "";
      const { strengths, weaknesses } = splitFeedback(summary);
      const scores = subscores(score);

      await appFetch(`/attempts/${session.attemptId}/complete`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score, evaluation_summary: summary }),
      });

      saveResultSession({
        ...scores,
        strengths,
        weaknesses,
        feedback: summary,
        topicId: session.topicId,
        attemptId: session.attemptId,
      });
      localStorage.removeItem(`ig_mock_${session.attemptId}`);
      router.push("/result");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Evaluation failed");
    } finally {
      setFinishing(false);
    }
  }

  useEffect(() => {
    if (!session || !currentQuestion) return;
    const t = setTimeout(() => {
      persistLocal(pairs, idx, draft, transcript);
    }, 1200);
    return () => clearTimeout(t);
  }, [draft, pairs, idx, currentQuestion, session, persistLocal, transcript]);

  if (loading) {
    return (
      <Card className="mx-auto max-w-2xl shadow-md">
        <CardContent className="p-8 text-center text-muted-foreground">Preparing your interview…</CardContent>
      </Card>
    );
  }

  if (!session) {
    return (
      <Card className="mx-auto max-w-2xl shadow-md">
        <CardHeader>
          <CardTitle>Mock interview</CardTitle>
          <CardDescription>{error || "No session"}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/interview">Go to dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Mock interview</h1>
          <p className="text-sm text-muted-foreground">{topic?.topic}</p>
        </div>
        <Badge variant={secondsLeft < 120 ? "warning" : "secondary"} className="text-base tabular-nums">
          {fmt}
        </Badge>
      </div>

      <Card className="shadow-md">
        <CardHeader>
          <CardTitle>
            Question {questions.length ? idx + 1 : 0} / {questions.length || "—"}
          </CardTitle>
          <CardDescription>Answer in text. Voice input can be added later.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {error && <p className="text-sm text-red-400">{error}</p>}
          <p className="rounded-xl bg-secondary/40 p-4 text-sm leading-relaxed">{currentQuestion || "Loading question…"}</p>
          <div className="grid gap-2">
            <Label htmlFor="answer">Your answer</Label>
            <Textarea
              id="answer"
              className="min-h-[120px]"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type your response…"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="live">Live transcription (draft)</Label>
            <Textarea
              id="live"
              className="min-h-[80px] font-mono text-xs"
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="Session notes — auto-saved locally with your answers"
            />
          </div>
          <div className="flex flex-wrap gap-4">
            <Button onClick={() => goNext()} disabled={finishing || !currentQuestion}>
              {finishing ? "Evaluating…" : isLastQuestion ? "Finish & evaluate" : "Save & next question"}
            </Button>
            <Button variant="secondary" onClick={() => finishInterview()} disabled={finishing}>
              End early & evaluate
            </Button>
            <Button variant="outline" asChild>
              <Link href="/interview">Exit</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
