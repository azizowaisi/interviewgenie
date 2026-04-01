"""
Audio Service: receives WebSocket audio stream, runs pipeline
STT -> Question -> LLM (streaming) -> Formatter and returns STAR answer over WebSocket.
Supports live transcript updates and streaming answer tokens.
"""
import asyncio
import io
import json
import os
import time
from fastapi import FastAPI, File, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import httpx

STT_URL = os.getenv("STT_SERVICE_URL", "http://stt-service:8000")
QUESTION_URL = os.getenv("QUESTION_SERVICE_URL", "http://question-service:8000")
LLM_URL = os.getenv("LLM_SERVICE_URL", "http://llm-service:8000")
FORMATTER_URL = os.getenv("FORMATTER_SERVICE_URL", "http://formatter-service:8000")
API_SERVICE_URL = os.getenv("API_SERVICE_URL", "").rstrip("/")

# Min buffer size (bytes) before running partial STT for live transcript (~0.5s at 16kHz 16bit mono)
LIVE_TRANSCRIPT_CHUNK_BYTES = int(os.getenv("LIVE_TRANSCRIPT_CHUNK_BYTES", "16000"))
# Min interval (seconds) between live transcript requests to avoid overwhelming STT
LIVE_TRANSCRIPT_MIN_INTERVAL = float(os.getenv("LIVE_TRANSCRIPT_MIN_INTERVAL", "0.5"))

app = FastAPI(title="Audio Service", version="0.1.0")


@app.on_event("startup")
async def startup_warmup_llm() -> None:
    """Keep Ollama model loaded by triggering a minimal generate at startup."""
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            await client.get(f"{LLM_URL.rstrip('/')}/warmup")
    except Exception:
        pass


@app.get("/health")
async def health() -> JSONResponse:
    return JSONResponse({"status": "ok"})


class MockAnalyzeRequest(BaseModel):
    question: str = ""
    answer: str = ""


@app.post("/mock/analyze")
async def mock_analyze(body: MockAnalyzeRequest) -> JSONResponse:
    """Get LLM feedback and suggestions on a mock interview answer."""
    if not (body.question.strip() and body.answer.strip()):
        return JSONResponse({"error": "question and answer are required"}, status_code=400)
    prompt = f"""You are an interview coach. Review this interview Q&A and produce improvements.

Question: {body.question.strip()}

Candidate's answer: {body.answer.strip()}

Return ONLY valid JSON with these fields:
{{
  "feedback": "2-3 sentences on clarity/relevance/impact",
  "suggestions": [
    "STAR: Situation: ...",
    "STAR: Task: ...",
    "STAR: Action: ...",
    "STAR: Result: ..."
  ],
  "improved_answer": "A rewritten improved answer in STAR format (max 140 words) in first person, with explicit labels Situation/Task/Action/Result"
}}

Rules:
- Keep it realistic and based on the user's answer (don't invent achievements).
- If the answer lacks metrics, use placeholders like \"reduced latency by X%\" or \"saved ~X hours/week\" (do not fabricate).
- The suggestions MUST be STAR items (Situation/Task/Action/Result). If something is unknown, write a placeholder the user can fill.
- No markdown, no extra keys, no prose outside JSON."""
    try:
        async with httpx.AsyncClient(timeout=LLM_TIMEOUT) as client:
            r = await client.post(
                f"{LLM_URL.rstrip('/')}/generate",
                json={"prompt": prompt},
            )
            r.raise_for_status()
            raw = (r.json().get("raw_answer") or "").strip()
            # Best-effort parse; fallback to a minimal structure.
            try:
                j = json.loads(raw)
                feedback = (j.get("feedback") or "").strip()
                suggestions = j.get("suggestions") or []
                if not isinstance(suggestions, list):
                    suggestions = []
                suggestions = [str(s).strip() for s in suggestions if str(s).strip()][:5]
                improved = (j.get("improved_answer") or "").strip()
                return JSONResponse({"feedback": feedback, "suggestions": suggestions, "improved_answer": improved})
            except Exception:
                return JSONResponse({"feedback": raw, "suggestions": [], "improved_answer": ""})
    except Exception as e:
        return JSONResponse({"error": (str(e) or "LLM unavailable")[:200]}, status_code=500)


class GenerateQuestionsRequest(BaseModel):
    job_description: str = ""
    cv_text: str = ""
    previous_questions: list[str] = []
    interview_type: str = "technical"
    num_questions: int = 5


@app.post("/mock/generate-questions")
async def mock_generate_questions(body: GenerateQuestionsRequest) -> JSONResponse:
    """Generate new interview questions (for retake) that do not repeat previous_questions."""
    jd = (body.job_description or "").strip()[:3000]
    cv = (body.cv_text or "").strip()[:3000]
    prev = body.previous_questions or []
    prev_block = "\n".join(f"- {q}" for q in prev[:50]) if prev else "(none)"
    num = max(1, min(15, body.num_questions))
    itype = (body.interview_type or "technical").strip().lower()
    if itype not in ("technical", "hr"):
        itype = "technical"
    prompt = f"""Generate exactly {num} interview questions for a {itype} job interview.

Job description:
{jd or "(not provided)"}

Candidate CV (optional context):
{cv or "(not provided)"}

Previous questions already asked (do NOT repeat these):
{prev_block}

Rules:
- Return ONLY the questions, one per line, numbered 1. to {num}.
- Do not repeat or rephrase the previous questions. Generate new questions testing similar skills.
- Keep each question to one line."""
    try:
        async with httpx.AsyncClient(timeout=LLM_TIMEOUT) as client:
            r = await client.post(
                f"{LLM_URL.rstrip('/')}/generate",
                json={"prompt": prompt},
            )
            r.raise_for_status()
            raw = (r.json().get("raw_answer") or "").strip()
            lines = [s.strip() for s in raw.split("\n") if s.strip()]
            questions = []
            for line in lines:
                if line and not line.startswith("#"):
                    q = line.lstrip("0123456789.-) ")
                    if q and len(questions) < num:
                        questions.append(q)
            if not questions:
                questions = [raw[:200] if raw else "Tell me about your experience."]
            return JSONResponse({"questions": questions[:num]})
    except Exception as e:
        return JSONResponse({"error": (str(e) or "LLM unavailable")[:200]}, status_code=500)


class QAPair(BaseModel):
    question: str = ""
    answer: str = ""


class EvaluateAttemptRequest(BaseModel):
    questions_and_answers: list[QAPair] = []


@app.post("/mock/evaluate-attempt")
async def mock_evaluate_attempt(body: EvaluateAttemptRequest) -> JSONResponse:
    """Score an attempt (0-10) and produce evaluation summary."""
    qa_list = body.questions_and_answers or []
    if not qa_list:
        return JSONResponse({"error": "questions_and_answers required"}, status_code=400)
    block = "\n\n".join(
        f"Q: {p.question.strip()}\nA: {p.answer.strip() or '(no answer)'}"
        for p in qa_list[:30]
    )
    prompt = f"""You are an interview evaluator. Score this interview (0-10) and give a short evaluation.

Interview Q&A:
{block[:6000]}

Respond in exactly this format:
SCORE: [number 0-10, one decimal allowed, e.g. 7.5]
SUMMARY: [2-4 sentences: strengths, areas for improvement, overall fit]"""
    try:
        async with httpx.AsyncClient(timeout=LLM_TIMEOUT) as client:
            r = await client.post(
                f"{LLM_URL.rstrip('/')}/generate",
                json={"prompt": prompt},
            )
            r.raise_for_status()
            raw = (r.json().get("raw_answer") or "").strip()
            score = 0.0
            summary = raw
            for line in raw.split("\n"):
                line = line.strip()
                if line.upper().startswith("SCORE:"):
                    try:
                        score = float(line.split(":", 1)[1].strip().split()[0].replace(",", "."))
                        score = max(0, min(10, score))
                    except Exception:
                        pass
                elif line.upper().startswith("SUMMARY:"):
                    summary = line.split(":", 1)[1].strip()
            return JSONResponse({"score": round(score, 1), "evaluation_summary": summary or raw[:500]})
    except Exception as e:
        return JSONResponse({"error": (str(e) or "LLM unavailable")[:200]}, status_code=500)


class AttemptForCompare(BaseModel):
    score: float | None = None
    evaluation_summary: str = ""
    questions_and_answers: list[QAPair] = []


class CompareAttemptsRequest(BaseModel):
    attempt_1: AttemptForCompare
    attempt_2: AttemptForCompare


class LiveAnswerRequest(BaseModel):
    question: str = ""
    cv_context: str | None = None
    job_description: str | None = None


@app.post("/live/answer")
async def live_answer(body: LiveAnswerRequest) -> JSONResponse:
    """Generate a STAR-style answer for a live interview question."""
    question = (body.question or "").strip()
    if not question:
        return JSONResponse({"error": "question is required"}, status_code=400)
    try:
        result = await run_pipeline_from_text(
            question,
            cv_context=(body.cv_context or None),
            job_description=(body.job_description or None),
        )
        if not result:
            return JSONResponse({"error": "pipeline_returned_nothing"}, status_code=500)
        if "error" in result:
            return JSONResponse(result, status_code=500)
        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({"error": f"live_answer_failed: {str(e)[:120]}"}, status_code=500)


@app.post("/live/transcribe")
async def live_transcribe(file: UploadFile = File(...)) -> JSONResponse:
    """Transcribe a short WAV clip (e.g. from browser tab/system audio capture)."""
    data = await file.read()
    if not data:
        return JSONResponse({"error": "empty audio"}, status_code=400)
    try:
        tr = await run_transcribe_only(data)
        if tr.get("error"):
            return JSONResponse({"text": (tr.get("text") or "").strip(), "error": tr["error"]})
        return JSONResponse({"text": (tr.get("text") or "").strip()})
    except Exception as e:
        return JSONResponse({"error": f"live_transcribe_failed: {str(e)[:120]}"}, status_code=500)


def _parse_metric(line: str, prefix: str) -> float | None:
    """Parse a line like 'TECHNICAL_KNOWLEDGE_1: 6' or 'OVERALL_2: 7.8'."""
    if not line.upper().startswith(prefix.upper() + ":"):
        return None
    try:
        val = line.split(":", 1)[1].strip().split()[0].replace(",", ".")
        return max(0.0, min(10.0, float(val)))
    except Exception:
        return None


@app.post("/mock/compare-attempts")
async def mock_compare_attempts(body: CompareAttemptsRequest) -> JSONResponse:
    """Compare two attempts: return metrics (technical, communication, confidence, job_fit, overall) and improvement summary."""
    a1 = body.attempt_1 or AttemptForCompare()
    a2 = body.attempt_2 or AttemptForCompare()
    qa1 = "\n\n".join(
        f"Q: {p.question.strip()}\nA: {p.answer.strip() or '(no answer)'}"
        for p in (a1.questions_and_answers or [])[:20]
    )
    qa2 = "\n\n".join(
        f"Q: {p.question.strip()}\nA: {p.answer.strip() or '(no answer)'}"
        for p in (a2.questions_and_answers or [])[:20]
    )
    s1 = (a1.evaluation_summary or "").strip()[:800]
    s2 = (a2.evaluation_summary or "").strip()[:800]
    prompt = f"""You are an interview coach. Compare two interview attempts and score each on 0-10 for: technical knowledge, communication, confidence, job fit, and overall.

Attempt 1 (score: {a1.score or '?'}):
Summary: {s1 or 'N/A'}
Q&A sample:
{qa1[:2500] or 'N/A'}

Attempt 2 (score: {a2.score or '?'}):
Summary: {s2 or 'N/A'}
Q&A sample:
{qa2[:2500] or 'N/A'}

Respond in exactly this format (one line each, numbers 0-10):
TECHNICAL_KNOWLEDGE_1: [0-10]
TECHNICAL_KNOWLEDGE_2: [0-10]
COMMUNICATION_1: [0-10]
COMMUNICATION_2: [0-10]
CONFIDENCE_1: [0-10]
CONFIDENCE_2: [0-10]
JOB_FIT_1: [0-10]
JOB_FIT_2: [0-10]
OVERALL_1: [0-10]
OVERALL_2: [0-10]
IMPROVEMENT_SUMMARY: [2-4 sentences: strengths improved, areas still to work on]"""
    try:
        async with httpx.AsyncClient(timeout=LLM_TIMEOUT) as client:
            r = await client.post(
                f"{LLM_URL.rstrip('/')}/generate",
                json={"prompt": prompt},
            )
            r.raise_for_status()
            raw = (r.json().get("raw_answer") or "").strip()
    except Exception as e:
        return JSONResponse({"error": (str(e) or "LLM unavailable")[:200]}, status_code=500)

    metrics_1: dict[str, float] = {}
    metrics_2: dict[str, float] = {}
    improvement_summary = ""
    for line in raw.split("\n"):
        line = line.strip()
        if not line:
            continue
        if line.upper().startswith("IMPROVEMENT_SUMMARY:"):
            improvement_summary = line.split(":", 1)[1].strip()[:1000]
            continue
        for prefix in ("TECHNICAL_KNOWLEDGE_1", "COMMUNICATION_1", "CONFIDENCE_1", "JOB_FIT_1", "OVERALL_1"):
            v = _parse_metric(line, prefix)
            if v is not None:
                key = prefix.replace("_1", "").lower()
                metrics_1[key] = v
                break
        for prefix in ("TECHNICAL_KNOWLEDGE_2", "COMMUNICATION_2", "CONFIDENCE_2", "JOB_FIT_2", "OVERALL_2"):
            v = _parse_metric(line, prefix)
            if v is not None:
                key = prefix.replace("_2", "").lower()
                metrics_2[key] = v
                break

    # Ensure we have at least overall from attempt scores if parsing missed
    if "overall" not in metrics_1 and a1.score is not None:
        metrics_1["overall"] = max(0, min(10, float(a1.score)))
    if "overall" not in metrics_2 and a2.score is not None:
        metrics_2["overall"] = max(0, min(10, float(a2.score)))
    defaults = {"technical_knowledge": 0, "communication": 0, "confidence": 0, "job_fit": 0, "overall": 0}
    for k in defaults:
        metrics_1.setdefault(k, metrics_1.get("overall", 0) if k == "overall" else 0)
        metrics_2.setdefault(k, metrics_2.get("overall", 0) if k == "overall" else 0)

    return JSONResponse({
        "metrics": {"attempt_1": metrics_1, "attempt_2": metrics_2},
        "improvement_summary": improvement_summary or raw[:500],
    })


# Per-step timeouts (LLM can be slow on first load or with large models)
STT_TIMEOUT = 30.0
QUESTION_TIMEOUT = 10.0
LLM_TIMEOUT = httpx.Timeout(60.0, connect=10.0, read=60.0, write=10.0)  # 1 min for llm-service request
FORMATTER_TIMEOUT = 10.0
API_TIMEOUT = 10.0


async def _fetch_cv_context(user_id: str, cv_id: str) -> str | None:
    """Fetch parsed CV text from API service for LLM context."""
    if not API_SERVICE_URL or not user_id or not cv_id:
        return None
    try:
        async with httpx.AsyncClient(timeout=API_TIMEOUT) as client:
            r = await client.get(
                f"{API_SERVICE_URL}/cv/{cv_id}",
                headers={"X-User-Id": user_id},
            )
            r.raise_for_status()
            return (r.json().get("parsed_text") or "").strip() or None
    except Exception:
        return None


async def _fetch_topic_job_description(user_id: str, topic_id: str) -> str | None:
    """Fetch topic job_description from API for live interview context."""
    if not API_SERVICE_URL or not user_id or not topic_id:
        return None
    try:
        async with httpx.AsyncClient(timeout=API_TIMEOUT) as client:
            r = await client.get(
                f"{API_SERVICE_URL}/topics/{topic_id}",
                headers={"X-User-Id": user_id},
            )
            r.raise_for_status()
            data = r.json()
            return (data.get("job_description") or "").strip() or None
    except Exception:
        return None


async def _save_history(
    user_id: str,
    question: str,
    answer: str,
    session_id: str | None = None,
    cv_id: str | None = None,
    topic_id: str | None = None,
    source: str = "live",
) -> None:
    """Append Q&A to API service history. source is 'live' or 'mock'."""
    if not API_SERVICE_URL or not user_id:
        return
    payload = {
        "question": question,
        "answer": answer,
        "session_id": session_id,
        "cv_id": cv_id,
        "topic_id": topic_id,
        "source": source if source in ("live", "mock") else "live",
    }
    try:
        async with httpx.AsyncClient(timeout=API_TIMEOUT) as client:
            await client.post(
                f"{API_SERVICE_URL}/history",
                json=payload,
                headers={"X-User-Id": user_id},
            )
    except Exception:
        pass


async def run_pipeline(audio_bytes: bytes, send_status=None) -> dict:
    """Transcribe -> process question -> LLM -> format. Returns STAR dict or error.
    send_status(msg) can be called to push status updates over WebSocket."""
    async def status(msg: str) -> None:
        if send_status:
            await send_status(msg)

    await status("Transcribing…")
    async with httpx.AsyncClient(timeout=STT_TIMEOUT) as client:
        # 1. Transcribe
        files = {"file": ("audio.wav", io.BytesIO(audio_bytes), "audio/wav")}
        try:
            r = await client.post(f"{STT_URL.rstrip('/')}/transcribe", files=files)
            r.raise_for_status()
            text = r.json().get("text", "").strip()
        except Exception as e:
            return {"error": f"transcription_failed: {str(e)[:100]}"}
        if not text:
            return {"error": "No speech detected. Voice runs locally with Whisper — ensure the backend (whisper-service and stt-service) is running."}

        await status("Preparing question…")
        async with httpx.AsyncClient(timeout=QUESTION_TIMEOUT) as client2:
            try:
                r = await client2.post(
                    f"{QUESTION_URL.rstrip('/')}/process",
                    json={"text": text},
                )
                r.raise_for_status()
                prompt = r.json().get("prompt", "")
            except Exception as e:
                return {"error": f"question_processing_failed: {str(e)[:100]}"}

        await status("Generating answer…")
        async with httpx.AsyncClient(timeout=LLM_TIMEOUT) as client3:
            try:
                r = await client3.post(
                    f"{LLM_URL.rstrip('/')}/generate",
                    json={"prompt": prompt},
                )
                r.raise_for_status()
                raw_answer = r.json().get("raw_answer", "")
            except Exception as e:
                msg = str(e).strip() or getattr(e, "message", "") or type(e).__name__
                return {"error": f"llm_failed: {msg[:120]}"}

        await status("Formatting…")
        async with httpx.AsyncClient(timeout=FORMATTER_TIMEOUT) as client4:
            try:
                r = await client4.post(
                    f"{FORMATTER_URL.rstrip('/')}/format",
                    json={"raw_answer": raw_answer},
                )
                r.raise_for_status()
                return r.json()
            except Exception as e:
                return {"error": f"format_failed: {str(e)[:100]}", "raw_answer": raw_answer}


async def run_transcribe_only(audio_bytes: bytes) -> dict:
    """Transcribe audio only (no LLM). Returns {text: ...} or {error: ...}."""
    async with httpx.AsyncClient(timeout=STT_TIMEOUT) as client:
        files = {"file": ("audio.wav", io.BytesIO(audio_bytes), "audio/wav")}
        try:
            r = await client.post(f"{STT_URL.rstrip('/')}/transcribe", files=files)
            r.raise_for_status()
            text = (r.json().get("text") or "").strip()
            return {"text": text}
        except Exception as e:
            return {"error": f"transcription_failed: {str(e)[:100]}"}


async def run_pipeline_streaming(
    audio_bytes: bytes,
    send_status=None,
    send_transcript=None,
    send_answer_chunk=None,
    cv_context: str | None = None,
    job_description: str | None = None,
) -> dict | None:
    """Run STT -> question -> stream LLM (forward tokens) -> format. Returns STAR dict + question or error."""
    async def status(msg: str) -> None:
        if send_status:
            await send_status(msg)

    await status("Transcribing…")
    async with httpx.AsyncClient(timeout=STT_TIMEOUT) as client:
        files = {"file": ("audio.wav", io.BytesIO(audio_bytes), "audio/wav")}
        try:
            r = await client.post(f"{STT_URL.rstrip('/')}/transcribe", files=files)
            r.raise_for_status()
            text = r.json().get("text", "").strip()
        except Exception as e:
            return {"error": f"transcription_failed: {str(e)[:100]}"}
        if not text:
            return {"error": "No speech detected. Voice runs locally with Whisper — ensure the backend (whisper-service and stt-service) is running."}

        if send_transcript:
            await send_transcript(text)

        await status("Preparing question…")
        async with httpx.AsyncClient(timeout=QUESTION_TIMEOUT) as client2:
            try:
                r = await client2.post(
                    f"{QUESTION_URL.rstrip('/')}/process",
                    json={"text": text, "cv_context": cv_context, "job_description": job_description},
                )
                r.raise_for_status()
                prompt = r.json().get("prompt", "")
            except Exception as e:
                return {"error": f"question_processing_failed: {str(e)[:100]}"}

        await status("Generating answer…")
        raw_parts = []
        async with httpx.AsyncClient(timeout=LLM_TIMEOUT) as client3:
            try:
                async with client3.stream(
                    "POST",
                    f"{LLM_URL.rstrip('/')}/generate/stream",
                    json={"prompt": prompt},
                ) as resp:
                    resp.raise_for_status()
                    async for line in resp.aiter_lines():
                        if not line:
                            continue
                        try:
                            data = json.loads(line)
                            token = data.get("token", "")
                            if token and send_answer_chunk:
                                raw_parts.append(token)
                                await send_answer_chunk(token)
                        except json.JSONDecodeError:
                            pass
                raw_answer = "".join(raw_parts)
            except Exception as e:
                msg = str(e).strip() or getattr(e, "message", "") or type(e).__name__
                return {"error": f"llm_failed: {msg[:120]}"}

        await status("Formatting…")
        async with httpx.AsyncClient(timeout=FORMATTER_TIMEOUT) as client4:
            try:
                r = await client4.post(
                    f"{FORMATTER_URL.rstrip('/')}/format",
                    json={"raw_answer": raw_answer},
                )
                r.raise_for_status()
                out = r.json()
                out["question"] = text
                return out
            except Exception as e:
                return {"error": f"format_failed: {str(e)[:100]}", "raw_answer": raw_answer}


async def run_pipeline_from_text(
    text: str,
    send_status=None,
    send_transcript=None,
    send_answer_chunk=None,
    cv_context: str | None = None,
    job_description: str | None = None,
) -> dict | None:
    """Run question -> stream LLM -> format from typed text (no STT). Returns STAR dict + question or error."""
    text = (text or "").strip()
    if not text:
        return {"error": "No question text provided."}
    async def status(msg: str) -> None:
        if send_status:
            await send_status(msg)
    if send_transcript:
        await send_transcript(text)
    await status("Preparing question…")
    async with httpx.AsyncClient(timeout=QUESTION_TIMEOUT) as client2:
        try:
            r = await client2.post(
                f"{QUESTION_URL.rstrip('/')}/process",
                json={"text": text, "cv_context": cv_context, "job_description": job_description},
            )
            r.raise_for_status()
            prompt = r.json().get("prompt", "")
        except Exception as e:
            return {"error": f"question_processing_failed: {str(e)[:100]}"}
    await status("Generating answer…")
    raw_parts = []
    async with httpx.AsyncClient(timeout=LLM_TIMEOUT) as client3:
        try:
            async with client3.stream(
                "POST",
                f"{LLM_URL.rstrip('/')}/generate/stream",
                json={"prompt": prompt},
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                        token = data.get("token", "")
                        if token and send_answer_chunk:
                            raw_parts.append(token)
                            await send_answer_chunk(token)
                    except json.JSONDecodeError:
                        pass
            raw_answer = "".join(raw_parts)
        except Exception as e:
            msg = str(e).strip() or getattr(e, "message", "") or type(e).__name__
            return {"error": f"llm_failed: {msg[:120]}"}
    await status("Formatting…")
    async with httpx.AsyncClient(timeout=FORMATTER_TIMEOUT) as client4:
        try:
            r = await client4.post(
                f"{FORMATTER_URL.rstrip('/')}/format",
                json={"raw_answer": raw_answer},
            )
            r.raise_for_status()
            out = r.json()
            out["question"] = text
            return out
        except Exception as e:
            return {"error": f"format_failed: {str(e)[:100]}", "raw_answer": raw_answer}


def _result_to_answer_text(result: dict) -> str:
    """Build a single answer string from pipeline result (STAR or raw) for API history."""
    if not result:
        return ""
    s, t, a, r = result.get("situation"), result.get("task"), result.get("action"), result.get("result")
    if s is not None or t is not None or a is not None or r is not None:
        parts = []
        if s:
            parts.append(f"Situation: {s}")
        if t:
            parts.append(f"Task: {t}")
        if a:
            parts.append(f"Action: {a}")
        if r:
            parts.append(f"Result: {r}")
        return "\n".join(parts) if parts else (result.get("raw_answer") or "")
    return result.get("raw_answer") or result.get("answer") or ""


async def maybe_send_live_transcript(
    buffer: bytearray,
    last_transcript_len: list,
    last_live_time: list,
    send_transcript,
) -> None:
    """When buffer grew by LIVE_TRANSCRIPT_CHUNK_BYTES and throttle interval passed, run STT for live question display."""
    now = time.monotonic()
    if now - last_live_time[0] < LIVE_TRANSCRIPT_MIN_INTERVAL:
        return
    if len(buffer) < last_transcript_len[0] + LIVE_TRANSCRIPT_CHUNK_BYTES:
        return
    last_live_time[0] = now
    async with httpx.AsyncClient(timeout=STT_TIMEOUT) as client:
        files = {"file": ("audio.wav", io.BytesIO(bytes(buffer)), "audio/wav")}
        try:
            r = await client.post(f"{STT_URL.rstrip('/')}/transcribe", files=files)
            r.raise_for_status()
            text = (r.json().get("text") or "").strip()
            if text and send_transcript:
                await send_transcript(text)
                last_transcript_len[0] = len(buffer)
        except Exception:
            pass


async def _send_json(websocket: WebSocket, obj: dict) -> None:
    try:
        await websocket.send_json(obj)
    except Exception:
        pass


@app.websocket("/ws/audio")
async def audio_stream(websocket: WebSocket) -> None:
    await websocket.accept()
    buffer = bytearray()
    session_ended = False
    last_transcript_len = [0]
    last_live_time = [0.0]
    replace_next_binary = False
    # Session state: user_id, session_id, cv_id, topic_id, cv_context, job_description (for live answers)
    session_user_id: str | None = None
    session_session_id: str | None = None
    session_cv_id: str | None = None
    session_topic_id: str | None = None
    session_cv_context: str | None = None
    session_job_description: str | None = None
    # Mock interview: question set by client; next process will only transcribe and save (question, transcript)
    session_mock_question: str | None = None

    async def send_status(msg: str) -> None:
        await _send_json(websocket, {"status": msg})

    async def send_transcript(text: str) -> None:
        await _send_json(websocket, {"transcript": text})

    async def send_answer_chunk(token: str) -> None:
        await _send_json(websocket, {"answer_chunk": token})

    try:
        while True:
            try:
                # Long timeout so session stays open until client disconnects (e.g. user clicks Stop)
                message = await asyncio.wait_for(websocket.receive(), timeout=3600.0)
            except asyncio.TimeoutError:
                await _send_json(websocket, {"error": "timeout"})
                break
            if "bytes" in message:
                if replace_next_binary:
                    buffer = bytearray(message["bytes"])
                    replace_next_binary = False
                    last_transcript_len[0] = 0
                else:
                    buffer.extend(message["bytes"])
                asyncio.create_task(
                    maybe_send_live_transcript(buffer, last_transcript_len, last_live_time, send_transcript)
                )
                continue
            if "text" in message:
                try:
                    data = json.loads(message["text"])
                    if data.get("done") or data.get("end"):
                        session_ended = True
                        break
                    if data.get("ping"):
                        await _send_json(websocket, {"pong": True})
                        continue
                    if data.get("chunk"):
                        replace_next_binary = True
                        continue
                    # Optional: set user/session/cv/topic for this connection (e.g. first message from client)
                    if "user_id" in data or "session_id" in data or "cv_id" in data or "topic_id" in data:
                        uid = data.get("user_id")
                        if isinstance(uid, str) and uid.strip():
                            session_user_id = uid.strip()
                        if "session_id" in data and isinstance(data["session_id"], str):
                            session_session_id = data["session_id"].strip() or None
                        if "topic_id" in data and isinstance(data["topic_id"], str):
                            tid = data["topic_id"].strip() or None
                            session_topic_id = tid
                            if tid and session_user_id:
                                session_job_description = await _fetch_topic_job_description(session_user_id, tid)
                            else:
                                session_job_description = None
                        cv_id = data.get("cv_id")
                        if isinstance(cv_id, str) and cv_id.strip():
                            session_cv_id = cv_id.strip()
                            if session_user_id:
                                session_cv_context = await _fetch_cv_context(session_user_id, session_cv_id)
                        else:
                            session_cv_id = None
                            session_cv_context = None
                    if isinstance(data.get("mock_question"), str) and data["mock_question"].strip():
                        session_mock_question = data["mock_question"].strip()
                        continue
                    if data.get("process"):
                        if not buffer:
                            await _send_json(websocket, {"error": "no_audio"})
                        elif session_mock_question:
                            await _send_json(websocket, {"status": "processing"})
                            mock_q = session_mock_question
                            session_mock_question = None
                            try:
                                tr = await run_transcribe_only(bytes(buffer))
                                if tr.get("error"):
                                    await _send_json(websocket, {"error": tr["error"]})
                                else:
                                    answer_text = (tr.get("text") or "").strip() or "(no speech detected)"
                                    # Return transcript only; user submits via "Submit written answer" to save
                                    await _send_json(websocket, {
                                        "answer_done": True,
                                        "question": mock_q,
                                        "answer_transcript": answer_text,
                                    })
                            except Exception as e:
                                await _send_json(websocket, {"error": f"mock_answer_failed: {str(e)[:80]}"})
                            buffer = bytearray()
                            last_transcript_len[0] = 0
                            continue
                        else:
                            await _send_json(websocket, {"status": "processing"})
                            try:
                                result = await run_pipeline_streaming(
                                    bytes(buffer),
                                    send_status=send_status,
                                    send_transcript=send_transcript,
                                    send_answer_chunk=send_answer_chunk,
                                    cv_context=session_cv_context,
                                    job_description=session_job_description,
                                )
                                if result and "error" in result:
                                    await _send_json(websocket, result)
                                elif result:
                                    if session_user_id:
                                        _t = asyncio.create_task(_save_history(
                                            session_user_id,
                                            result.get("question") or "",
                                            _result_to_answer_text(result),
                                            session_session_id,
                                            session_cv_id,
                                            session_topic_id,
                                            source="live",
                                        ))
                                        _t.add_done_callback(lambda _: None)  # keep ref
                                    await _send_json(websocket, {"answer_done": True, **result})
                                else:
                                    await _send_json(websocket, {"error": "pipeline_returned_nothing"})
                            except Exception as e:
                                await _send_json(websocket, {"error": f"pipeline_error: {str(e)[:80]}"})
                            buffer = bytearray()
                            last_transcript_len[0] = 0
                        continue
                    text_input = data.get("text")
                    if isinstance(text_input, str):
                        await _send_json(websocket, {"status": "processing"})
                        try:
                            result = await run_pipeline_from_text(
                                text_input,
                                send_status=send_status,
                                send_transcript=send_transcript,
                                send_answer_chunk=send_answer_chunk,
                                cv_context=session_cv_context,
                                job_description=session_job_description,
                            )
                            if result and "error" in result:
                                await _send_json(websocket, result)
                            elif result:
                                if session_user_id:
                                    _t = asyncio.create_task(_save_history(
                                        session_user_id,
                                        result.get("question") or text_input,
                                        _result_to_answer_text(result),
                                        session_session_id,
                                        session_cv_id,
                                        session_topic_id,
                                        source="live",
                                    ))
                                    _t.add_done_callback(lambda _: None)  # keep ref
                                await _send_json(websocket, {"answer_done": True, **result})
                            else:
                                await _send_json(websocket, {"error": "pipeline_returned_nothing"})
                        except Exception as e:
                            await _send_json(websocket, {"error": f"pipeline_error: {str(e)[:80]}"})
                        continue
                except json.JSONDecodeError:
                    pass
                continue

        if session_ended and buffer:
            await _send_json(websocket, {"status": "processing"})
            try:
                result = await run_pipeline_streaming(
                    bytes(buffer),
                    send_status=send_status,
                    send_transcript=send_transcript,
                    send_answer_chunk=send_answer_chunk,
                    cv_context=session_cv_context,
                    job_description=session_job_description,
                )
                if result and "error" in result:
                    await _send_json(websocket, result)
                elif result:
                    if session_user_id:
                        _t = asyncio.create_task(_save_history(
                            session_user_id,
                            result.get("question") or "",
                            _result_to_answer_text(result),
                            session_session_id,
                            session_cv_id,
                            session_topic_id,
                            source="live",
                        ))
                        _t.add_done_callback(lambda _: None)  # keep ref
                    await _send_json(websocket, {"answer_done": True, **result})
                else:
                    await _send_json(websocket, {"error": "pipeline_returned_nothing"})
            except Exception as e:
                await _send_json(websocket, {"error": f"pipeline_error: {str(e)[:80]}"})
    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await _send_json(websocket, {"error": str(e)})
        except Exception:
            pass
