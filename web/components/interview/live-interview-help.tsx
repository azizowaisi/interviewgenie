"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { appFetch, audioFetch } from "@/lib/api-fetch";
import { startMeetingAudioCapture, type MeetingCaptureSession } from "@/lib/meeting-audio-capture";

type Topic = {
  id: string;
  topic: string;
  company_name?: string | null;
  job_description?: string | null;
  cv_id?: string | null;
};

type LiveAnswerResponse = {
  situation?: string;
  task?: string;
  action?: string;
  result?: string;
  raw_answer?: string;
  suggestions?: string[];
  error?: string;
};

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

const STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "and",
  "been",
  "build",
  "built",
  "from",
  "have",
  "into",
  "just",
  "more",
  "that",
  "their",
  "there",
  "they",
  "this",
  "under",
  "using",
  "with",
  "your",
]);

function renderAnswerText(data: LiveAnswerResponse) {
  if (data.situation || data.task || data.action || data.result) {
    return [
      data.situation ? `Situation: ${data.situation}` : "",
      data.task ? `Task: ${data.task}` : "",
      data.action ? `Action: ${data.action}` : "",
      data.result ? `Result: ${data.result}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  return (data.raw_answer || "").trim();
}

function extractCvSignals(cvText: string) {
  const words = cvText
    .toLowerCase()
    .match(/[a-z][a-z0-9+#.-]{2,}/g);
  if (!words) return [];
  const freq = new Map<string, number>();
  for (const w of words) {
    if (STOP_WORDS.has(w)) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 12)
    .map(([w]) => w);
}

function buildSuggestions(answerText: string, matchedSignals: string[]) {
  const suggestions: string[] = [];
  const t = answerText.toLowerCase();
  if (!/result:\s|%|percent|reduced|increased|improved|faster|saved/.test(t)) {
    suggestions.push("Add one measurable Result (%, time saved, latency reduction, revenue, or quality impact).");
  }
  if (!/situation:\s|task:\s|action:\s|result:\s/.test(t)) {
    suggestions.push("Use a clear STAR structure: Situation, Task, Action, Result.");
  }
  if (!matchedSignals.length) {
    suggestions.push("Mention one concrete CV detail (project, stack, or domain) so the answer feels personal.");
  } else if (matchedSignals.length < 2) {
    suggestions.push("Add one more CV-backed detail to strengthen credibility.");
  }
  return suggestions;
}

export function LiveInterviewHelp() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicId, setTopicId] = useState("");
  const [cvText, setCvText] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingTopics, setLoadingTopics] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cvSignals, setCvSignals] = useState<string[]>([]);
  const [matchedSignals, setMatchedSignals] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [listening, setListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [recognition, setRecognition] = useState<BrowserSpeechRecognition | null>(null);
  const [meetingCaptureSupported, setMeetingCaptureSupported] = useState(false);
  const [meetingCapturing, setMeetingCapturing] = useState(false);
  const [meetingTranscribing, setMeetingTranscribing] = useState(false);
  const meetingSessionRef = useRef<MeetingCaptureSession | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const w = window as Window & {
      webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
      SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    const instance = new Ctor();
    instance.continuous = false;
    instance.interimResults = true;
    instance.lang = "en-US";
    setSpeechSupported(true);
    setRecognition(instance);
  }, []);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) return;
    const md = navigator.mediaDevices as MediaDevices & { getDisplayMedia?: unknown };
    setMeetingCaptureSupported(typeof md.getDisplayMedia === "function");
  }, []);

  useEffect(() => {
    return () => {
      meetingSessionRef.current?.dispose();
      meetingSessionRef.current = null;
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const tr = await appFetch("/topics");
        if (!tr.ok) throw new Error(await tr.text());
        const list = (await tr.json()) as Topic[];
        setTopics(list);
        if (list.length) {
          setTopicId(list[0].id);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load jobs.");
      } finally {
        setLoadingTopics(false);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      if (!topicId) {
        setCvText("");
        return;
      }
      const selected = topics.find((t) => t.id === topicId);
      if (!selected?.cv_id) {
        setCvText("");
        return;
      }
      try {
        const cr = await appFetch(`/cv/${selected.cv_id}`);
        if (!cr.ok) throw new Error(await cr.text());
        const cj = (await cr.json()) as { parsed_text?: string };
        const parsed = (cj.parsed_text || "").slice(0, 4000);
        setCvText(parsed);
        setCvSignals(extractCvSignals(parsed));
      } catch {
        setCvText("");
        setCvSignals([]);
      }
    })();
  }, [topicId, topics]);

  async function onGenerate() {
    setError(null);
    if (!topicId) {
      setError("Select a job title first.");
      return;
    }
    const q = question.trim();
    if (!q) {
      setError("Enter the interviewer question first.");
      return;
    }
    setLoading(true);
    try {
      const selected = topics.find((t) => t.id === topicId);
      const res = await audioFetch("/live/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          cv_context: cvText || undefined,
          job_description: selected?.job_description || undefined,
        }),
      });
      const json = (await res.json()) as LiveAnswerResponse;
      if (!res.ok || json.error) {
        throw new Error(json.error || "Could not generate live interview help.");
      }
      const answerText = renderAnswerText(json);
      setAnswer(answerText);
      const lowered = answerText.toLowerCase();
      const matched = cvSignals.filter((s) => lowered.includes(s)).slice(0, 6);
      setMatchedSignals(matched);
      const builtSuggestions = [
        ...(json.suggestions ?? []),
        ...buildSuggestions(answerText, matched),
      ];
      setSuggestions([...new Set(builtSuggestions)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate answer.");
      setMatchedSignals([]);
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }

  function onStartVoiceInput() {
    if (!recognition) {
      setError("Voice-to-text is not supported in this browser.");
      return;
    }
    setError(null);
    let finalText = "";
    recognition.onresult = (event) => {
      let current = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const r = event.results[i];
        const chunk = r[0]?.transcript || "";
        if (r.isFinal) finalText += `${chunk} `;
        else current += chunk;
      }
      const merged = `${finalText}${current}`.trim();
      setQuestion(merged);
    };
    recognition.onerror = (event) => {
      setListening(false);
      setError(event.error ? `Voice input failed: ${event.error}` : "Voice input failed.");
    };
    recognition.onend = () => {
      setListening(false);
    };
    setListening(true);
    recognition.start();
  }

  function onStopVoiceInput() {
    recognition?.stop();
    setListening(false);
  }

  async function onStartMeetingCapture() {
    setError(null);
    try {
      meetingSessionRef.current?.dispose();
      meetingSessionRef.current = null;
      const session = await startMeetingAudioCapture();
      meetingSessionRef.current = session;
      setMeetingCapturing(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start meeting audio capture.");
    }
  }

  async function onStopMeetingCapture() {
    const session = meetingSessionRef.current;
    meetingSessionRef.current = null;
    if (!session) {
      setMeetingCapturing(false);
      return;
    }
    setMeetingTranscribing(true);
    setError(null);
    try {
      const wav = await session.stopAndTranscribe();
      const blob = new Blob([wav], { type: "audio/wav" });
      const form = new FormData();
      form.append("file", blob, "meeting-capture.wav");
      const res = await audioFetch("/live/transcribe", {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as { text?: string; error?: string };
      if (!res.ok || json.error) {
        throw new Error(json.error || "Transcription failed.");
      }
      const text = (json.text || "").trim();
      if (!text) {
        setError(
          "No speech detected in the recording. Check that “Share tab audio” was enabled, the call was playing, and Whisper/STT services are running."
        );
      } else {
        setQuestion((q) => (q.trim() ? `${q.trim()} ${text}` : text));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Meeting audio transcription failed.");
    } finally {
      setMeetingCapturing(false);
      setMeetingTranscribing(false);
    }
  }

  return (
    <Card className="mx-auto max-w-3xl shadow-md">
      <CardHeader>
        <CardTitle>Live interview help</CardTitle>
        <CardDescription>
          Select a job title, capture the interviewer’s question from your meeting (Meet, Teams, etc. — tab/speaker
          audio), then generate a STAR-style answer grounded in your CV.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="live-topic">Job title</Label>
          <select
            id="live-topic"
            value={topicId}
            disabled={loadingTopics || !topics.length}
            onChange={(e) => setTopicId(e.target.value)}
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
          <Label htmlFor="live-question">Interviewer question</Label>
          <Textarea
            id="live-question"
            className="min-h-[120px]"
            placeholder="e.g. Tell me about a time you handled a production incident under pressure."
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
        </div>
        <div className="grid gap-2 rounded-lg border border-border bg-secondary/20 p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Meeting audio (recommended)</p>
          <p>
            Click below and choose the browser tab where Google Meet / Microsoft Teams / Zoom is open. In Chrome,
            enable <span className="text-foreground">Share tab audio</span> so we hear the interviewer (not your
            microphone).
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {meetingCaptureSupported && !meetingCapturing ? (
            <Button type="button" variant="outline" onClick={onStartMeetingCapture} disabled={meetingTranscribing}>
              Capture meeting audio
            </Button>
          ) : null}
          {meetingCaptureSupported && meetingCapturing ? (
            <Button type="button" variant="outline" onClick={onStopMeetingCapture} disabled={meetingTranscribing}>
              {meetingTranscribing ? "Transcribing…" : "Stop & transcribe"}
            </Button>
          ) : null}
          {speechSupported && !listening ? (
            <Button type="button" variant="ghost" size="sm" onClick={onStartVoiceInput}>
              Microphone fallback
            </Button>
          ) : null}
          {speechSupported && listening ? (
            <Button type="button" variant="ghost" size="sm" onClick={onStopVoiceInput}>
              Stop microphone
            </Button>
          ) : null}
          <Button onClick={onGenerate} disabled={loading}>
            {loading ? "Generating..." : "Generate live answer"}
          </Button>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        {!error && !!answer && (
          <div className="rounded-lg border border-border bg-secondary/20 p-3 text-xs text-muted-foreground">
            {cvText ? (
              <>
                <p className="font-medium text-foreground">Personalized from your CV</p>
                <p>
                  {matchedSignals.length
                    ? `Detected CV-aligned terms in answer: ${matchedSignals.join(", ")}`
                    : "CV is loaded, but this answer can reference more of your actual CV details."}
                </p>
              </>
            ) : (
              <p>No CV context loaded for this job yet. Add CV in Start page to personalize answers.</p>
            )}
          </div>
        )}
        <div className="grid gap-2">
          <Label htmlFor="live-answer">Suggested answer</Label>
          <Textarea
            id="live-answer"
            className="min-h-[220px] whitespace-pre-wrap"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Your AI-assisted answer appears here."
          />
        </div>
        {!!suggestions.length && (
          <div className="grid gap-2">
            <Label>Instant suggestions</Label>
            <ul className="list-inside list-disc rounded-lg border border-border bg-secondary/20 p-3 text-sm">
              {suggestions.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
