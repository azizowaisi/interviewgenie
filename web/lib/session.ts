export type InterviewSession = {
  topicId: string;
  attemptId: string;
  interviewType: string;
  durationMinutes: number;
};

const KEY = "ig_interview_session";

export function saveInterviewSession(s: InterviewSession) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(KEY, JSON.stringify(s));
}

export function loadInterviewSession(): InterviewSession | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as InterviewSession;
  } catch {
    return null;
  }
}

export function clearInterviewSession() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(KEY);
}

export type ResultSession = {
  overall: number;
  technical: number;
  communication: number;
  confidence: number;
  strengths: string[];
  weaknesses: string[];
  feedback: string;
  qaReview?: Array<{
    orderIndex: number;
    question: string;
    answer: string;
    aiSuggestion: string;
    improvedAnswer?: string;
  }>;
  topicId: string;
  attemptId: string;
};

const RESULT_KEY = "ig_interview_result";

export function saveResultSession(r: ResultSession) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(RESULT_KEY, JSON.stringify(r));
}

export function loadResultSession(): ResultSession | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(RESULT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ResultSession;
  } catch {
    return null;
  }
}
