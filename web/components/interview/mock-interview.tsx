"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { appFetch, audioFetch } from "@/lib/api-fetch";
import { loadInterviewSession, saveInterviewSession, saveResultSession, type InterviewSession } from "@/lib/session";

type TopicResponse = {
  id: string;
  topic: string;
  company_name?: string | null;
  job_description?: string | null;
  cv_id?: string | null;
  interview_type?: string;
  duration_minutes?: number;
};

type CvResponse = {
  parsed_text: string;
};

type QAPair = { question: string; answer: string };
const DURATION_OPTIONS = [5, 10, 15, 20, 30, 45, 60];

type BrowserSpeechRecognitionResult = {
  isFinal: boolean;
  0: { transcript: string };
};

type BrowserSpeechRecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<BrowserSpeechRecognitionResult>;
};

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

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
  const [topics, setTopics] = useState<TopicResponse[]>([]);
  const [selectedTopicId, setSelectedTopicId] = useState("");
  const [interviewType, setInterviewType] = useState<"technical" | "hr">("technical");
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [starting, setStarting] = useState(false);
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
  const [improving, setImproving] = useState(false);
  const [improveProgress, setImproveProgress] = useState(0);
  const [questionIdsByOrder, setQuestionIdsByOrder] = useState<Record<number, string>>({});
  const [speechSupported, setSpeechSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const listeningWantedRef = useRef(false);
  const [ttsSupported, setTtsSupported] = useState(false);
  const [ttsVoices, setTtsVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [ttsVoiceUri, setTtsVoiceUri] = useState<string>("");

  const currentQuestion = questions[idx] ?? "";
  const isLastQuestion = questions.length > 0 && idx === questions.length - 1;
  let nextButtonLabel = "Save & next question";
  if (finishing) nextButtonLabel = "Evaluating…";
  else if (isLastQuestion) nextButtonLabel = "Finish & evaluate";

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
    if (s) {
      // Do not auto-start when opening /mock.
      // Prefill setup options and wait for explicit "Start interview" click.
      setSelectedTopicId(s.topicId);
      setInterviewType((s.interviewType || "technical") === "hr" ? "hr" : "technical");
      setDurationMinutes(Math.max(5, Math.min(120, Number(s.durationMinutes || 30))));
    }
    (async () => {
      try {
        const r = await appFetch("/topics");
        if (!r.ok) throw new Error(await r.text());
        const list = (await r.json()) as TopicResponse[];
        setTopics(list);
        if (list.length) setSelectedTopicId(list[0].id);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load jobs.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (typeof globalThis === "undefined" || !("window" in globalThis)) return;
    const w = globalThis.window as unknown as Record<string, unknown>;
    const Ctor = (w.SpeechRecognition || w.webkitSpeechRecognition) as
      | BrowserSpeechRecognitionConstructor
      | undefined;
    if (!Ctor) return;
    const instance = new Ctor();
    // Keep capturing until user stops (we also auto-restart on `onend` for browsers that end segments).
    instance.continuous = true;
    instance.interimResults = true;
    instance.lang = "en-US";
    recognitionRef.current = instance;
    setSpeechSupported(true);
  }, []);

  function scoreVoice(v: SpeechSynthesisVoice): number {
    // Prefer female-sounding premium voices commonly available on macOS/Chrome.
    // (Voice availability is OS/browser-specific; this is best-effort.)
    const name = (v.name || "").toLowerCase();
    const uri = (v.voiceURI || "").toLowerCase();
    const lang = (v.lang || "").toLowerCase();
    let s = 0;
    if (lang.startsWith("en")) s += 10;
    if (lang === "en-us") s += 6;
    if (v.localService) s += 2;
    const hay = `${name} ${uri}`;
    if (/\b(samantha|ava|allison|victoria|karen|moira|tessa|serena|zoe)\b/.test(hay)) s += 40;
    if (/\b(google us english|google uk english female|microsoft aria|microsoft jenny)\b/.test(hay)) s += 35;
    if (/\b(female|woman|wavenet)\b/.test(hay)) s += 12;
    if (/\b(whisper|robot|compact|bad|default)\b/.test(hay)) s -= 10;
    return s;
  }

  function pickDefaultVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
    if (!voices.length) return null;
    const ranked = [...voices].sort((a, b) => scoreVoice(b) - scoreVoice(a));
    return ranked[0] ?? null;
  }

  useEffect(() => {
    if (typeof globalThis === "undefined" || !("window" in globalThis)) return;
    const win = globalThis.window as Window;
    if (!win.speechSynthesis) return;
    setTtsSupported(true);

    const load = () => {
      const voices = win.speechSynthesis.getVoices() || [];
      setTtsVoices(voices);
      const best = pickDefaultVoice(voices);
      if (best && !ttsVoiceUri) setTtsVoiceUri(best.voiceURI);
    };

    // Some browsers populate voices async.
    load();
    win.speechSynthesis.onvoiceschanged = load;
    return () => {
      // best-effort cleanup
      try {
        if (win.speechSynthesis.onvoiceschanged === load) win.speechSynthesis.onvoiceschanged = null;
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const speak = useCallback((text: string) => {
    const t = text.trim();
    if (!t) return;
    const win = ("window" in globalThis ? (globalThis.window as Window) : null) as
      | (Window & { speechSynthesis?: SpeechSynthesis })
      | null;
    if (!win?.speechSynthesis) return;
    try {
      win.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(t);
      // Slightly slower than default improves clarity.
      u.rate = 0.95;
      u.pitch = 1;
      u.lang = "en-US";
      const voice = ttsVoices.find((v) => v.voiceURI === ttsVoiceUri);
      if (voice) u.voice = voice;
      win.speechSynthesis.speak(u);
    } catch {
      // ignore
    }
  }, [ttsVoiceUri, ttsVoices]);

  useEffect(() => {
    if (!autoSpeak) return;
    if (!session) return;
    if (!currentQuestion) return;
    const t = setTimeout(() => speak(currentQuestion), 250);
    return () => clearTimeout(t);
  }, [autoSpeak, currentQuestion, session, speak]);

  useEffect(() => {
    if (!selectedTopicId) return;
    const selected = topics.find((t) => t.id === selectedTopicId);
    if (!selected) return;
    const nextType = (selected.interview_type || "technical").toLowerCase();
    setInterviewType(nextType === "hr" ? "hr" : "technical");
    const nextDuration = Number(selected.duration_minutes || 30);
    setDurationMinutes(Math.max(5, Math.min(120, Number.isFinite(nextDuration) ? nextDuration : 30)));
  }, [selectedTopicId, topics]);

  function normalizeInterviewType(raw: string | undefined): "technical" | "hr" {
    const v = (raw || "").toLowerCase();
    return v === "hr" ? "hr" : "technical";
  }

  async function loadCvText(topicData: TopicResponse): Promise<string> {
    if (!topicData.cv_id) return "";
    const cr = await appFetch(`/cv/${topicData.cv_id}`);
    if (!cr.ok) return "";
    const cj = (await cr.json()) as CvResponse;
    return (cj.parsed_text || "").trim();
  }

  async function generateQuestions(topicData: TopicResponse, cvText: string): Promise<string[]> {
    const fallback = [
      "Tell me about your relevant experience for this role.",
      "Describe a challenging problem you solved and how you approached it.",
      "How do you prioritize tasks when multiple deadlines overlap?",
      "Give an example of a time you worked effectively with a team.",
      "What steps do you take to learn new tools or technologies?",
    ];
    try {
      const gr = await audioFetch("/mock/generate-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_description: (topicData.job_description || "").slice(0, 3000),
          cv_text: cvText.slice(0, 3000),
          interview_type: normalizeInterviewType(topicData.interview_type || interviewType),
          num_questions: 5,
          previous_questions: [],
        }),
      });
      if (!gr.ok) {
        console.error("Mock question generation failed:", await gr.text());
        return fallback;
      }
      const gj = (await gr.json()) as { questions?: string[] };
      return gj.questions?.length ? gj.questions : fallback;
    } catch (e) {
      console.error("Mock question generation failed:", e);
      return fallback;
    }
  }

  async function createAttempt(topicId: string): Promise<string> {
    const aRes = await appFetch(`/topics/${topicId}/attempts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!aRes.ok) throw new Error(await aRes.text());
    const attemptJson = (await aRes.json()) as { id: string };
    return attemptJson.id;
  }

  async function startFromJob() {
    setStarting(true);
    setError(null);
    try {
      const topicId = selectedTopicId;
      if (!topicId) {
        setError("Select a job title first.");
        return;
      }
      // Gate the interview UI behind analysis + first question readiness.
      setLoading(true);
      setSession(null);
      setTopic(null);
      setQuestions([]);
      setIdx(0);
      setDraft("");
      setTranscript("");
      setPairs([]);
      const updateTopicRes = await appFetch(`/topics/${topicId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interview_type: interviewType,
          duration_minutes: durationMinutes,
        }),
      });
      if (!updateTopicRes.ok) throw new Error(await updateTopicRes.text());

      const tRes = await appFetch(`/topics/${topicId}`);
      if (!tRes.ok) throw new Error(await tRes.text());
      const topicData = (await tRes.json()) as TopicResponse;

      // Analysis step (ATS) — ensures CV+JD are parsed and provides signals.
      const atsRes = await appFetch("/ats/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic_id: topicId }),
      });
      if (!atsRes.ok) throw new Error(await atsRes.text());

      const cv = await loadCvText(topicData);
      if (!cv) throw new Error("CV not found for this job. Upload a CV on the Start page first.");

      const qs = await generateQuestions(topicData, cv);
      const attemptId = await createAttempt(topicId);

      const next: InterviewSession = {
        topicId,
        attemptId,
        interviewType: normalizeInterviewType(topicData.interview_type || interviewType),
        durationMinutes: Math.max(5, Math.min(120, Number(topicData.duration_minutes || durationMinutes || 30))),
      };
      saveInterviewSession(next);
      setTopic(topicData);
      setQuestions(qs);
      setSession(next);
      setSecondsLeft(next.durationMinutes * 60);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start mock interview");
    } finally {
      setStarting(false);
      setLoading(false);
    }
  }

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
    const key = `ig_mock_qids_${session.attemptId}`;
    const raw = localStorage.getItem(key);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      const out: Record<number, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        const n = Number(k);
        if (Number.isFinite(n) && v) out[n] = v;
      }
      setQuestionIdsByOrder(out);
    } catch {
      /* ignore */
    }
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

  async function startListening() {
    const rec = recognitionRef.current;
    if (!rec) return;
    setError(null);
    setListening(true);
    listeningWantedRef.current = true;
    let interim = "";
    rec.onresult = (event) => {
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const text = (res?.[0]?.transcript || "").trim();
        if (!text) continue;
        if (res.isFinal) finalText += (finalText ? " " : "") + text;
        else interim = text;
      }
      if (finalText) {
        setDraft((d) => [d.trim(), finalText.trim()].filter(Boolean).join(" "));
        setTranscript((t) => (t ? `${t}\n${finalText}` : finalText));
      } else if (interim) {
        setDraft((d) => d.trim() || interim);
      }
    };
    rec.onerror = (e) => {
      setError(e?.error ? `Voice input error: ${e.error}` : "Voice input error");
    };
    rec.onend = () => {
      if (!listeningWantedRef.current) {
        setListening(false);
        return;
      }
      // Some browsers auto-stop after pauses even with continuous=true.
      // Restart quickly to keep a “push-to-stop” experience.
      try {
        rec.start();
      } catch {
        setListening(false);
        listeningWantedRef.current = false;
      }
    };
    try {
      rec.start();
    } catch {
      setListening(false);
      listeningWantedRef.current = false;
      setError("Voice input could not start (check microphone permissions).");
    }
  }

  function stopListening() {
    const rec = recognitionRef.current;
    if (!rec) return;
    listeningWantedRef.current = false;
    try {
      rec.stop();
    } catch {
      // ignore
    } finally {
      setListening(false);
    }
  }

  async function savePairToApi(question: string, answer: string, orderIndex: number) {
    if (!session) return;
    const r = await appFetch(`/attempts/${session.attemptId}/questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, answer, order_index: orderIndex }),
    });
    if (!r.ok) return;
    try {
      const j = (await r.json()) as { id?: string; order_index?: number };
      const id = (j.id || "").trim();
      const oi = typeof j.order_index === "number" ? j.order_index : orderIndex;
      if (!id) return;
      setQuestionIdsByOrder((prev) => {
        const next = { ...prev, [oi]: id };
        if (session) {
          localStorage.setItem(`ig_mock_qids_${session.attemptId}`, JSON.stringify(next));
        }
        return next;
      });
    } catch {
      /* ignore */
    }
  }

  async function ensureQuestionIds(): Promise<Record<number, string>> {
    if (!session) return {};
    const current = questionIdsByOrder;
    // If we have ids for every answered question, we're done.
    if (Object.keys(current).length >= pairs.length) return current;
    const r = await appFetch(`/attempts/${session.attemptId}`);
    if (!r.ok) return current;
    const j = (await r.json()) as { questions?: Array<{ id: string; order_index: number }> };
    const out = { ...current };
    for (const q of j.questions || []) {
      if (q?.id && typeof q.order_index === "number") out[q.order_index] = q.id;
    }
    setQuestionIdsByOrder(out);
    localStorage.setItem(`ig_mock_qids_${session.attemptId}`, JSON.stringify(out));
    return out;
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
    if (!session) return;
    let qa = finalPairs ?? pairs;

    // If user ends early (or finishes) without clicking "Save & next",
    // persist the currently visible draft as the last answer.
    const pendingAnswer = draft.trim();
    if (currentQuestion && pendingAnswer) {
      const alreadySaved =
        qa.length > 0 &&
        qa[qa.length - 1]?.question === currentQuestion &&
        qa[qa.length - 1]?.answer?.trim() === pendingAnswer;
      if (!alreadySaved) {
        const orderIndex = qa.length;
        const appended = [...qa, { question: currentQuestion, answer: pendingAnswer }];
        setPairs(appended);
        qa = appended;
        await savePairToApi(currentQuestion, pendingAnswer, orderIndex);
        setTranscript((t) =>
          t ? `${t}\n\nQ: ${currentQuestion}\nA: ${pendingAnswer}` : `Q: ${currentQuestion}\nA: ${pendingAnswer}`
        );
        setDraft("");
      }
    }

    if (qa.length === 0) {
      setError("Answer at least one question before finishing.");
      return;
    }
    setFinishing(true);
    setError(null);
    try {
      setImproving(true);
      setImproveProgress(0);

      // Generate per-question improvements (saved to DB + shown on Result).
      const idMap = await ensureQuestionIds();
      const qaReview: NonNullable<import("@/lib/session").ResultSession["qaReview"]> = [];
      for (let i = 0; i < qa.length; i++) {
        setImproveProgress(i);
        const { question, answer } = qa[i];
        const rr = await audioFetch("/mock/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, answer }),
        });
        if (!rr.ok) continue;
        const rj = (await rr.json()) as {
          suggestions?: string[];
          improved_answer?: string;
          feedback?: string;
        };
        const suggestion = (rj.suggestions || []).filter(Boolean).join("\n").trim() || (rj.feedback || "").trim();
        const improvedAnswer = (rj.improved_answer || "").trim();
        qaReview.push({
          orderIndex: i,
          question,
          answer,
          aiSuggestion: suggestion || "—",
          improvedAnswer: improvedAnswer || undefined,
        });
        const qid = idMap[i];
        if (qid) {
          await appFetch(`/attempts/${session.attemptId}/questions/${qid}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ai_suggestion: suggestion,
              improved_answer: improvedAnswer,
            }),
          });
        }
      }
      setImproveProgress(qa.length);

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
        qaReview,
        topicId: session.topicId,
        attemptId: session.attemptId,
      });
      localStorage.removeItem(`ig_mock_${session.attemptId}`);
      localStorage.removeItem(`ig_mock_qids_${session.attemptId}`);
      router.push("/result");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Evaluation failed");
    } finally {
      setFinishing(false);
      setImproving(false);
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
        <CardContent className="p-8 text-center text-muted-foreground">
          {improving ? `Preparing your report… (${improveProgress}/${pairs.length})` : "Preparing your interview…"}
        </CardContent>
      </Card>
    );
  }

  if (!session) {
    return (
      <Card className="mx-auto max-w-2xl shadow-md">
        <CardHeader>
          <CardTitle>Mock interview</CardTitle>
          <CardDescription>Select analyzed job title, interview type, and time, then start interview.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="grid gap-2">
            <Label htmlFor="mock-topic">Job title</Label>
            <select
              id="mock-topic"
              value={selectedTopicId}
              onChange={(e) => setSelectedTopicId(e.target.value)}
              disabled={!topics.length}
              className="flex h-10 w-full rounded-xl border border-input bg-secondary/50 px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">Select job title</option>
              {topics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.topic}
                  {t.company_name ? ` - ${t.company_name}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="mock-type">Interview type</Label>
            <select
              id="mock-type"
              value={interviewType}
              onChange={(e) => setInterviewType(e.target.value === "hr" ? "hr" : "technical")}
              className="flex h-10 w-full rounded-xl border border-input bg-secondary/50 px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="technical">Technical</option>
              <option value="hr">HR</option>
            </select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="mock-duration">Interview time</Label>
            <select
              id="mock-duration"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Math.max(5, Math.min(120, Number(e.target.value) || 30)))}
              className="flex h-10 w-full rounded-xl border border-input bg-secondary/50 px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {DURATION_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes} minutes
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-3">
            <Button onClick={startFromJob} disabled={starting || !selectedTopicId}>
              {starting ? "Preparing..." : "Start interview"}
            </Button>
            <Button variant="outline" asChild>
              <Link href="/interview">Go to Start page</Link>
            </Button>
          </div>
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
          <CardDescription>Answer with your voice (or type). The question can be read aloud.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="grid gap-3">
            <p className="rounded-xl bg-secondary/40 p-4 text-sm leading-relaxed">
              {currentQuestion || "Loading question…"}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => speak(currentQuestion)}
                disabled={!currentQuestion}
              >
                Read question aloud
              </Button>
              {ttsSupported && ttsVoices.length > 0 && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="whitespace-nowrap">Voice</span>
                  <select
                    value={ttsVoiceUri}
                    onChange={(e) => setTtsVoiceUri(e.target.value)}
                    className="h-9 rounded-xl border border-input bg-secondary/50 px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {ttsVoices
                      .filter((v) => (v.lang || "").toLowerCase().startsWith("en"))
                      .sort((a, b) => scoreVoice(b) - scoreVoice(a))
                      .slice(0, 12)
                      .map((v) => (
                        <option key={v.voiceURI} value={v.voiceURI}>
                          {v.name} ({v.lang})
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={autoSpeak}
                  onChange={(e) => setAutoSpeak(e.target.checked)}
                />
                Auto-read new questions
              </label>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="answer">Your answer</Label>
            <Textarea
              id="answer"
              className="min-h-[120px]"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type your response…"
            />
            <div className="flex flex-wrap items-center gap-3">
              {(() => {
                const label = !speechSupported
                  ? "Voice input unavailable"
                  : listening
                    ? "Stop voice input"
                    : "Start voice input";
                const variant = listening ? "destructive" : "secondary";
                return (
                  <Button
                    type="button"
                    variant={variant}
                    size="sm"
                    onClick={() => (listening ? stopListening() : startListening())}
                    disabled={!speechSupported || finishing}
                  >
                    {label}
                  </Button>
                );
              })()}
              {speechSupported && (
                <span className="text-xs text-muted-foreground">
                  {listening ? "Listening…" : "Uses your browser microphone"}
                </span>
              )}
            </div>
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
              {nextButtonLabel}
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
