"""
API Service: Auth0 (optional), CV upload/parsing, MongoDB (users, CVs, Q&A history, sessions).
"""
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, Request, UploadFile, File, Header
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from db import (
    get_users_collection,
    get_cvs_collection,
    get_qa_history_collection,
    get_sessions_collection,
    get_topics_collection,
    get_ats_analysis_collection,
    get_interview_attempts_collection,
    get_interview_questions_collection,
)
from cv_parser import parse_cv
from ats_analyzer import compute_ats

# When exposed behind a reverse proxy under a prefix (e.g. /api/svc), set PUBLIC_API_PATH_PREFIX=/api/svc
# so OpenAPI/Swagger and JSON root links use the public URL. Leave unset for local http://localhost:8001.
_PUBLIC_PREFIX = os.getenv("PUBLIC_API_PATH_PREFIX", "").rstrip("/")

app = FastAPI(
    title="Interview Genie API",
    version="0.1.0",
    root_path=_PUBLIC_PREFIX,
)


def _public_path(path: str) -> str:
    path = path if path.startswith("/") else f"/{path}"
    return f"{_PUBLIC_PREFIX}{path}" if _PUBLIC_PREFIX else path

STATIC_DIR = Path(__file__).resolve().parent / "static"
DIST_DIR = STATIC_DIR / "dist"
DIST_ASSETS_DIR = DIST_DIR / "assets"
# Vite build (Vue SPA) emits /assets/* — mount before /static so hashed chunks resolve.
if DIST_ASSETS_DIR.is_dir():
    app.mount("/assets", StaticFiles(directory=str(DIST_ASSETS_DIR)), name="vite_assets")
if STATIC_DIR.is_dir():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# Auth: if AUTH0_DOMAIN not set, use X-User-Id header for local dev
AUTH0_DOMAIN = os.getenv("AUTH0_DOMAIN", "").rstrip("/")
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "/tmp/uploads")


class UserMe(BaseModel):
    id: str
    auth0_id: Optional[str] = None
    email: Optional[str] = None
    name: Optional[str] = None


class CVItem(BaseModel):
    id: str
    filename: str
    parsed_text: str
    uploaded_at: str
    user_id: str


class SessionCreate(BaseModel):
    session_name: Optional[str] = None


class SessionItem(BaseModel):
    id: str
    user_id: str
    session_name: str
    start_time: str


class HistoryItem(BaseModel):
    question: str
    answer: str
    session_id: Optional[str] = None
    cv_id: Optional[str] = None
    topic_id: Optional[str] = None
    source: Optional[str] = None  # "live" | "mock"; default "live" when missing
    feedback: Optional[str] = None  # optional analysis/suggestions (e.g. from mock "Get feedback")


class HistoryEntry(BaseModel):
    question: str
    answer: str
    timestamp: str
    session_id: Optional[str] = None
    cv_id: Optional[str] = None
    topic_id: Optional[str] = None
    source: Optional[str] = None
    feedback: Optional[str] = None


class HistoryFeedbackUpdate(BaseModel):
    feedback: str


class TopicCreate(BaseModel):
    topic: str
    company_name: Optional[str] = None
    job_description: Optional[str] = None
    interview_type: Optional[str] = None  # "technical" | "hr"; default "technical"
    duration_minutes: Optional[int] = None  # default 30


class TopicUpdate(BaseModel):
    interview_type: Optional[str] = None  # "technical" | "hr"
    duration_minutes: Optional[int] = None  # 5-120


class AttemptCreate(BaseModel):
    pass  # same topic, type, duration from topic


class AttemptComplete(BaseModel):
    score: float
    evaluation_summary: Optional[str] = None


class AttemptQuestionAdd(BaseModel):
    question: str
    answer: Optional[str] = None
    order_index: Optional[int] = None


class AttemptQuestionUpdate(BaseModel):
    answer: Optional[str] = None
    ai_suggestion: Optional[str] = None
    improved_answer: Optional[str] = None


class AtsAnalyzeRequest(BaseModel):
    topic_id: Optional[str] = None  # use topic's job_description and topic's cv_id
    cv_id: Optional[str] = None  # optional override; if topic_id has cv_id, use that
    job_description: Optional[str] = None  # raw JD if no topic_id


async def get_user_id(
    request: Request,
    x_user_id: Optional[str] = Header(None, alias="X-User-Id"),
) -> Optional[str]:
    """Resolve user_id: from JWT (Auth0) or from X-User-Id header (dev)."""
    if AUTH0_DOMAIN:
        from auth import verify_token
        from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
        bearer = HTTPBearer(auto_error=False)
        creds = await bearer(request)
        if not creds:
            raise HTTPException(401, "Missing authorization")
        payload = await verify_token(creds)
        auth0_id = payload.get("sub") or payload.get("auth0_id")
        users = get_users_collection()
        user = users.find_one({"auth0_id": auth0_id})
        if not user:
            user = {
                "auth0_id": auth0_id,
                "email": payload.get("email"),
                "name": payload.get("name"),
                "created_at": datetime.now(timezone.utc),
            }
            users.insert_one(user)
        return str(user["_id"])
    if x_user_id:
        users = get_users_collection()
        user = users.find_one({"_id": x_user_id}) or users.find_one({"auth0_id": x_user_id})
        if user:
            return str(user["_id"])
        users.insert_one({
            "_id": x_user_id,
            "auth0_id": x_user_id,
            "created_at": datetime.now(timezone.utc),
        })
        return x_user_id
    return None


@app.get("/")
async def root():
    """Vue SPA landing (Vite build in static/dist) or legacy landing.html."""
    vite_index = DIST_DIR / "index.html"
    if vite_index.is_file():
        return FileResponse(vite_index)
    landing = STATIC_DIR / "landing.html"
    if landing.is_file():
        return FileResponse(landing)
    return JSONResponse(
        {
            "service": "Interview Genie API",
            "health": _public_path("/health"),
            "docs": _public_path("/docs"),
            "web_app": _public_path("/app"),
            "note": "Public URLs use prefix from PUBLIC_API_PATH_PREFIX when set (e.g. /api/svc).",
        }
    )


@app.get("/app")
async def web_app():
    """Vue SPA workspace route (same entry as / — Vue Router shows /app). Legacy app.html if no build."""
    vite_index = DIST_DIR / "index.html"
    if vite_index.is_file():
        return FileResponse(vite_index)
    app_html = STATIC_DIR / "app.html"
    if not app_html.is_file():
        raise HTTPException(503, "Web app bundle missing")
    return FileResponse(app_html)


@app.get("/health")
async def health():
    return JSONResponse({"status": "ok"})


@app.get("/users/me", response_model=UserMe)
async def users_me(user_id: Optional[str] = Depends(get_user_id)):
    if not user_id:
        raise HTTPException(401, "Not authenticated")
    users = get_users_collection()
    from bson import ObjectId
    doc = users.find_one({"_id": user_id})
    if not doc:
        try:
            doc = users.find_one({"_id": ObjectId(user_id)})
        except Exception:
            doc = users.find_one({"auth0_id": user_id})
    if not doc:
        raise HTTPException(404, "User not found")
    return UserMe(
        id=str(doc["_id"]),
        auth0_id=doc.get("auth0_id"),
        email=doc.get("email"),
        name=doc.get("name"),
    )


@app.post("/cv/upload")
async def cv_upload(
    file: UploadFile = File(...),
    user_id: Optional[str] = Depends(get_user_id),
):
    if not user_id:
        raise HTTPException(401, "Not authenticated")
    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty file")
    filename = file.filename or "upload"
    parsed = parse_cv(data, filename)
    if not parsed:
        raise HTTPException(400, "Could not parse file (supported: PDF, DOCX, TXT)")
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    path = os.path.join(UPLOAD_DIR, f"{user_id}_{uuid.uuid4().hex}_{filename}")
    with open(path, "wb") as f:
        f.write(data)
    cvs = get_cvs_collection()
    doc = {
        "user_id": user_id,
        "filename": filename,
        "parsed_text": parsed,
        "uploaded_at": datetime.now(timezone.utc),
        "original_file_path": path,
    }
    result = cvs.insert_one(doc)
    return JSONResponse({
        "id": str(result.inserted_id),
        "filename": filename,
        "uploaded_at": doc["uploaded_at"].isoformat(),
    })


@app.get("/cv")
async def cv_list(user_id: Optional[str] = Depends(get_user_id)):
    if not user_id:
        raise HTTPException(401, "Not authenticated")
    cvs = get_cvs_collection()
    cursor = cvs.find({"user_id": user_id}).sort("uploaded_at", -1)
    out = []
    for d in cursor:
        out.append({
            "id": str(d["_id"]),
            "filename": d["filename"],
            "uploaded_at": d["uploaded_at"].isoformat(),
        })
    return JSONResponse(out)


@app.get("/cv/{cv_id}")
async def cv_get(cv_id: str, user_id: Optional[str] = Depends(get_user_id)):
    if not user_id:
        raise HTTPException(401, "Not authenticated")
    from bson import ObjectId
    cvs = get_cvs_collection()
    try:
        doc = cvs.find_one({"_id": ObjectId(cv_id), "user_id": user_id})
    except Exception:
        doc = None
    if not doc:
        raise HTTPException(404, "CV not found")
    return JSONResponse({
        "id": str(doc["_id"]),
        "filename": doc["filename"],
        "parsed_text": doc["parsed_text"],
        "uploaded_at": doc["uploaded_at"].isoformat(),
    })


@app.post("/sessions")
async def session_create(
    body: SessionCreate,
    user_id: Optional[str] = Depends(get_user_id),
):
    if not user_id:
        raise HTTPException(401, "Not authenticated")
    sessions = get_sessions_collection()
    name = (body.session_name or "").strip() or f"Session {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}"
    doc = {
        "user_id": user_id,
        "session_name": name,
        "start_time": datetime.now(timezone.utc),
    }
    result = sessions.insert_one(doc)
    return JSONResponse({
        "id": str(result.inserted_id),
        "session_name": name,
        "start_time": doc["start_time"].isoformat(),
    })


@app.get("/sessions")
async def sessions_list(user_id: Optional[str] = Depends(get_user_id)):
    if not user_id:
        raise HTTPException(401, "Not authenticated")
    sessions = get_sessions_collection()
    cursor = sessions.find({"user_id": user_id}).sort("start_time", -1).limit(50)
    out = []
    for d in cursor:
        out.append({
            "id": str(d["_id"]),
            "session_name": d.get("session_name", ""),
            "start_time": d["start_time"].isoformat(),
        })
    return JSONResponse(out)


@app.post("/history")
async def history_append(
    body: HistoryItem,
    user_id: Optional[str] = Depends(get_user_id),
):
    if not user_id:
        raise HTTPException(401, "Not authenticated")
    history = get_qa_history_collection()
    from bson import ObjectId
    source = (body.source or "live").strip().lower() if body.source else "live"
    if source not in ("live", "mock"):
        source = "live"
    doc = {
        "user_id": user_id,
        "question": body.question,
        "answer": body.answer,
        "timestamp": datetime.now(timezone.utc),
        "session_id": body.session_id,
        "cv_id": body.cv_id,
        "topic_id": body.topic_id,
        "source": source,
    }
    if doc["topic_id"]:
        try:
            doc["topic_id"] = ObjectId(doc["topic_id"])
        except Exception:
            doc["topic_id"] = None
    if body.feedback is not None:
        doc["feedback"] = body.feedback
    result = history.insert_one(doc)
    return JSONResponse({"id": str(result.inserted_id), "ok": True})


@app.patch("/history/{entry_id}")
async def history_update_feedback(
    entry_id: str,
    body: HistoryFeedbackUpdate,
    user_id: Optional[str] = Depends(get_user_id),
):
    if not user_id:
        raise HTTPException(401, "Not authenticated")
    history = get_qa_history_collection()
    from bson import ObjectId
    try:
        oid = ObjectId(entry_id)
    except Exception:
        raise HTTPException(400, "Invalid entry id")
    result = history.update_one(
        {"_id": oid, "user_id": user_id},
        {"$set": {"feedback": body.feedback}},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Entry not found")
    return JSONResponse({"ok": True})


@app.get("/history")
async def history_list(
    session_id: Optional[str] = None,
    cv_id: Optional[str] = None,
    topic_id: Optional[str] = None,
    limit: int = 100,
    user_id: Optional[str] = Depends(get_user_id),
):
    if not user_id:
        raise HTTPException(401, "Not authenticated")
    from bson import ObjectId
    history = get_qa_history_collection()
    q = {"user_id": user_id}
    if session_id:
        q["session_id"] = session_id
    if cv_id:
        q["cv_id"] = cv_id
    if topic_id:
        try:
            q["topic_id"] = ObjectId(topic_id)
        except Exception:
            pass
    cursor = history.find(q).sort("timestamp", -1).limit(limit)
    out = []
    for d in cursor:
        out.append({
            "id": str(d["_id"]),
            "question": d["question"],
            "answer": d["answer"],
            "timestamp": d["timestamp"].isoformat(),
            "session_id": d.get("session_id"),
            "cv_id": str(d["cv_id"]) if d.get("cv_id") else None,
            "topic_id": str(d["topic_id"]) if d.get("topic_id") else None,
            "source": d.get("source") or "live",
            "feedback": d.get("feedback"),
        })
    return JSONResponse(out)


# --- Topics (interview topic + job description) ---
@app.post("/topics")
async def topic_create(
    body: TopicCreate,
    user_id: Optional[str] = Depends(get_user_id),
):
    if not user_id:
        raise HTTPException(401, "Not authenticated")
    topic_name = (body.topic or "").strip()
    if not topic_name:
        raise HTTPException(400, "topic is required")
    topics = get_topics_collection()
    interview_type = (body.interview_type or "technical").strip().lower() if body.interview_type else "technical"
    if interview_type not in ("technical", "hr"):
        interview_type = "technical"
    duration = body.duration_minutes if body.duration_minutes is not None else 30
    duration = max(5, min(120, duration))
    doc = {
        "user_id": user_id,
        "topic": topic_name,
        "company_name": (body.company_name or "").strip() or None,
        "job_description": (body.job_description or "").strip() or None,
        "cv_id": None,
        "interview_type": interview_type,
        "duration_minutes": duration,
        "created_at": datetime.now(timezone.utc),
    }
    result = topics.insert_one(doc)
    return JSONResponse({
        "id": str(result.inserted_id),
        "topic": doc["topic"],
        "company_name": doc.get("company_name"),
        "job_description": doc["job_description"],
        "cv_id": None,
        "cv_filename": None,
        "interview_type": doc["interview_type"],
        "duration_minutes": doc["duration_minutes"],
        "created_at": doc["created_at"].isoformat(),
    })


def _topic_to_response(d: dict, cvs_collection) -> dict:
    out = {
        "id": str(d["_id"]),
        "topic": d.get("topic", ""),
        "company_name": d.get("company_name"),
        "job_description": d.get("job_description"),
        "created_at": d["created_at"].isoformat(),
        "cv_id": None,
        "cv_filename": None,
        "interview_type": d.get("interview_type") or "technical",
        "duration_minutes": d.get("duration_minutes", 30),
    }
    cv_id = d.get("cv_id")
    if cv_id:
        out["cv_id"] = str(cv_id)
        try:
            cv_doc = cvs_collection.find_one({"_id": cv_id})
            if cv_doc:
                out["cv_filename"] = cv_doc.get("filename")
        except Exception:
            pass
    return out


@app.get("/topics")
async def topics_list(user_id: Optional[str] = Depends(get_user_id)):
    if not user_id:
        raise HTTPException(401, "Not authenticated")
    topics = get_topics_collection()
    cvs = get_cvs_collection()
    cursor = topics.find({"user_id": user_id}).sort("created_at", -1).limit(100)
    out = [_topic_to_response(d, cvs) for d in cursor]
    return JSONResponse(out)


@app.get("/topics/{topic_id}")
async def topic_get(topic_id: str, user_id: Optional[str] = Depends(get_user_id)):
    if not user_id:
        raise HTTPException(401, "Not authenticated")
    from bson import ObjectId
    topics = get_topics_collection()
    cvs = get_cvs_collection()
    try:
        doc = topics.find_one({"_id": ObjectId(topic_id), "user_id": user_id})
    except Exception:
        doc = None
    if not doc:
        raise HTTPException(404, "Topic not found")
    return JSONResponse(_topic_to_response(doc, cvs))


@app.patch("/topics/{topic_id}")
async def topic_update(
    topic_id: str,
    body: TopicUpdate,
    user_id: Optional[str] = Depends(get_user_id),
):
    if not user_id:
        raise HTTPException(401, "Not authenticated")
    from bson import ObjectId
    topics = get_topics_collection()
    try:
        doc = topics.find_one({"_id": ObjectId(topic_id), "user_id": user_id})
    except Exception:
        doc = None
    if not doc:
        raise HTTPException(404, "Topic not found")
    updates = {}
    if body.interview_type is not None:
        it = (body.interview_type or "technical").strip().lower()
        updates["interview_type"] = it if it in ("technical", "hr") else "technical"
    if body.duration_minutes is not None:
        dur = max(5, min(120, int(body.duration_minutes)))
        updates["duration_minutes"] = dur
    if updates:
        topics.update_one(
            {"_id": ObjectId(topic_id), "user_id": user_id},
            {"$set": updates},
        )
    doc = topics.find_one({"_id": ObjectId(topic_id), "user_id": user_id})
    cvs = get_cvs_collection()
    return JSONResponse(_topic_to_response(doc, cvs))


# --- Interview attempts (retake / multiple attempts per topic) ---
@app.post("/topics/{topic_id}/attempts")
async def attempt_create(
    topic_id: str,
    body: AttemptCreate,
    user_id: Optional[str] = Depends(get_user_id),
):
    if not user_id:
        raise HTTPException(401, "Not authenticated")
    from bson import ObjectId
    topics = get_topics_collection()
    attempts_coll = get_interview_attempts_collection()
    try:
        topic_doc = topics.find_one({"_id": ObjectId(topic_id), "user_id": user_id})
    except Exception:
        topic_doc = None
    if not topic_doc:
        raise HTTPException(404, "Topic not found")
    count = attempts_coll.count_documents({"topic_id": ObjectId(topic_id), "user_id": user_id})
    attempt_number = count + 1
    now = datetime.now(timezone.utc)
    doc = {
        "user_id": user_id,
        "topic_id": ObjectId(topic_id),
        "attempt_number": attempt_number,
        "interview_type": topic_doc.get("interview_type") or "technical",
        "duration_minutes": topic_doc.get("duration_minutes", 30),
        "start_time": now,
        "end_time": None,
        "score": None,
        "evaluation_summary": None,
        "created_at": now,
    }
    result = attempts_coll.insert_one(doc)
    return JSONResponse({
        "id": str(result.inserted_id),
        "topic_id": topic_id,
        "attempt_number": attempt_number,
        "interview_type": doc["interview_type"],
        "duration_minutes": doc["duration_minutes"],
        "start_time": doc["start_time"].isoformat(),
    })


@app.get("/topics/{topic_id}/attempts")
async def attempts_list(
    topic_id: str,
    user_id: Optional[str] = Depends(get_user_id),
):
    if not user_id:
        raise HTTPException(401, "Not authenticated")
    from bson import ObjectId
    topics = get_topics_collection()
    attempts_coll = get_interview_attempts_collection()
    try:
        topic_doc = topics.find_one({"_id": ObjectId(topic_id), "user_id": user_id})
    except Exception:
        topic_doc = None
    if not topic_doc:
        raise HTTPException(404, "Topic not found")
    cursor = attempts_coll.find({"topic_id": ObjectId(topic_id), "user_id": user_id}).sort("attempt_number", 1)
    out = []
    for d in cursor:
        out.append({
            "id": str(d["_id"]),
            "topic_id": str(d["topic_id"]),
            "attempt_number": d.get("attempt_number", 0),
            "interview_type": d.get("interview_type") or "technical",
            "duration_minutes": d.get("duration_minutes", 30),
            "start_time": d["start_time"].isoformat(),
            "end_time": d["end_time"].isoformat() if d.get("end_time") else None,
            "score": d.get("score"),
            "evaluation_summary": d.get("evaluation_summary"),
            "created_at": d["created_at"].isoformat(),
        })
    return JSONResponse(out)


@app.get("/attempts/{attempt_id}")
async def attempt_get(
    attempt_id: str,
    user_id: Optional[str] = Depends(get_user_id),
):
    if not user_id:
        raise HTTPException(401, "Not authenticated")
    from bson import ObjectId
    attempts_coll = get_interview_attempts_collection()
    questions_coll = get_interview_questions_collection()
    try:
        attempt_doc = attempts_coll.find_one({"_id": ObjectId(attempt_id), "user_id": user_id})
    except Exception:
        attempt_doc = None
    if not attempt_doc:
        raise HTTPException(404, "Attempt not found")
    q_cursor = questions_coll.find({"attempt_id": ObjectId(attempt_id)}).sort("order_index", 1).sort("timestamp", 1)
    questions = []
    for q in q_cursor:
        questions.append({
            "id": str(q["_id"]),
            "question": q.get("question", ""),
            "answer": q.get("answer"),
            "order_index": q.get("order_index", 0),
            "timestamp": q["timestamp"].isoformat(),
            "ai_suggestion": q.get("ai_suggestion"),
            "improved_answer": q.get("improved_answer"),
        })
    return JSONResponse({
        "id": str(attempt_doc["_id"]),
        "topic_id": str(attempt_doc["topic_id"]),
        "attempt_number": attempt_doc.get("attempt_number", 0),
        "interview_type": attempt_doc.get("interview_type") or "technical",
        "duration_minutes": attempt_doc.get("duration_minutes", 30),
        "start_time": attempt_doc["start_time"].isoformat(),
        "end_time": attempt_doc["end_time"].isoformat() if attempt_doc.get("end_time") else None,
        "score": attempt_doc.get("score"),
        "evaluation_summary": attempt_doc.get("evaluation_summary"),
        "created_at": attempt_doc["created_at"].isoformat(),
        "questions": questions,
    })


@app.post("/attempts/{attempt_id}/questions")
async def attempt_question_add(
    attempt_id: str,
    body: AttemptQuestionAdd,
    user_id: Optional[str] = Depends(get_user_id),
):
    if not user_id:
        raise HTTPException(401, "Not authenticated")
    from bson import ObjectId
    attempts_coll = get_interview_attempts_collection()
    questions_coll = get_interview_questions_collection()
    try:
        attempt_doc = attempts_coll.find_one({"_id": ObjectId(attempt_id), "user_id": user_id})
    except Exception:
        attempt_doc = None
    if not attempt_doc or attempt_doc.get("end_time"):
        raise HTTPException(404, "Attempt not found or already completed")
    count = questions_coll.count_documents({"attempt_id": ObjectId(attempt_id)})
    order_index = body.order_index if body.order_index is not None else count
    now = datetime.now(timezone.utc)
    doc = {
        "attempt_id": ObjectId(attempt_id),
        "question": (body.question or "").strip(),
        "answer": (body.answer or "").strip() or None,
        "order_index": order_index,
        "timestamp": now,
        "ai_suggestion": None,
        "improved_answer": None,
    }
    result = questions_coll.insert_one(doc)
    return JSONResponse({
        "id": str(result.inserted_id),
        "question": doc["question"],
        "answer": doc["answer"],
        "order_index": doc["order_index"],
        "timestamp": doc["timestamp"].isoformat(),
    })


@app.patch("/attempts/{attempt_id}/questions/{question_id}")
async def attempt_question_update_answer(
    attempt_id: str,
    question_id: str,
    body: AttemptQuestionUpdate,
    user_id: Optional[str] = Depends(get_user_id),
):
    if not user_id:
        raise HTTPException(401, "Not authenticated")
    from bson import ObjectId
    attempts_coll = get_interview_attempts_collection()
    questions_coll = get_interview_questions_collection()
    try:
        attempt_doc = attempts_coll.find_one({"_id": ObjectId(attempt_id), "user_id": user_id})
    except Exception:
        attempt_doc = None
    if not attempt_doc or attempt_doc.get("end_time"):
        raise HTTPException(404, "Attempt not found or already completed")
    patch: dict = {}
    if body.answer is not None:
        patch["answer"] = (body.answer or "").strip() or None
    if body.ai_suggestion is not None:
        patch["ai_suggestion"] = (body.ai_suggestion or "").strip() or None
    if body.improved_answer is not None:
        patch["improved_answer"] = (body.improved_answer or "").strip() or None
    if not patch:
        return JSONResponse({"ok": True})
    updated = questions_coll.update_one(
        {"_id": ObjectId(question_id), "attempt_id": ObjectId(attempt_id)},
        {"$set": patch},
    )
    if updated.matched_count == 0:
        raise HTTPException(404, "Question not found")
    return JSONResponse({"ok": True})


@app.patch("/attempts/{attempt_id}/complete")
async def attempt_complete(
    attempt_id: str,
    body: AttemptComplete,
    user_id: Optional[str] = Depends(get_user_id),
):
    if not user_id:
        raise HTTPException(401, "Not authenticated")
    from bson import ObjectId
    attempts_coll = get_interview_attempts_collection()
    now = datetime.now(timezone.utc)
    result = attempts_coll.update_one(
        {"_id": ObjectId(attempt_id), "user_id": user_id},
        {"$set": {
            "end_time": now,
            "score": body.score,
            "evaluation_summary": body.evaluation_summary or None,
        }},
    )
    if result.matched_count == 0:
        raise HTTPException(404, "Attempt not found")
    return JSONResponse({"ok": True})


@app.post("/topics/{topic_id}/cv")
async def topic_upload_cv(
    topic_id: str,
    file: UploadFile = File(...),
    user_id: Optional[str] = Depends(get_user_id),
):
    """Upload one CV for this job title (replaces any existing). One CV per topic."""
    if not user_id:
        raise HTTPException(401, "Not authenticated")
    from bson import ObjectId
    topics = get_topics_collection()
    try:
        topic_doc = topics.find_one({"_id": ObjectId(topic_id), "user_id": user_id})
    except Exception:
        topic_doc = None
    if not topic_doc:
        raise HTTPException(404, "Topic not found")
    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty file")
    filename = file.filename or "upload"
    parsed = parse_cv(data, filename)
    if not parsed:
        raise HTTPException(400, "Could not parse file (supported: PDF, DOCX, TXT)")
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    path = os.path.join(UPLOAD_DIR, f"{user_id}_{uuid.uuid4().hex}_{filename}")
    with open(path, "wb") as f:
        f.write(data)
    cvs = get_cvs_collection()
    cv_doc = {
        "user_id": user_id,
        "topic_id": ObjectId(topic_id),
        "filename": filename,
        "parsed_text": parsed,
        "uploaded_at": datetime.now(timezone.utc),
        "original_file_path": path,
    }
    cv_result = cvs.insert_one(cv_doc)
    topics.update_one(
        {"_id": ObjectId(topic_id), "user_id": user_id},
        {"$set": {"cv_id": cv_result.inserted_id}},
    )
    return JSONResponse({
        "id": str(cv_result.inserted_id),
        "filename": filename,
        "topic_id": topic_id,
    })


# --- ATS analysis ---
@app.post("/ats/analyze")
async def ats_analyze(
    body: AtsAnalyzeRequest,
    user_id: Optional[str] = Depends(get_user_id),
):
    if not user_id:
        raise HTTPException(401, "Not authenticated")
    from bson import ObjectId
    cvs = get_cvs_collection()
    topics = get_topics_collection()
    jd_text = None
    topic_id_obj = None
    cv_doc = None
    if body.topic_id:
        try:
            topic_doc = topics.find_one({"_id": ObjectId(body.topic_id), "user_id": user_id})
            if topic_doc:
                jd_text = (topic_doc.get("job_description") or "").strip()
                topic_id_obj = topic_doc["_id"]
                if not body.cv_id and topic_doc.get("cv_id"):
                    cv_doc = cvs.find_one({"_id": topic_doc["cv_id"], "user_id": user_id})
        except Exception:
            pass
    if not jd_text and body.job_description:
        jd_text = (body.job_description or "").strip()
    if not jd_text:
        raise HTTPException(400, "Provide topic_id (with job_description) or job_description")
    if not cv_doc and body.cv_id:
        try:
            cv_doc = cvs.find_one({"_id": ObjectId(body.cv_id), "user_id": user_id})
        except Exception:
            cv_doc = None
    if not cv_doc:
        raise HTTPException(404, "CV not found. Upload a CV for this job title in Prepare.")
    cv_text = (cv_doc.get("parsed_text") or "").strip()
    if not cv_text:
        raise HTTPException(400, "CV has no parsed text")
    result = compute_ats(cv_text, jd_text)
    ats_coll = get_ats_analysis_collection()
    doc = {
        "user_id": user_id,
        "topic_id": topic_id_obj,
        "cv_id": cv_doc["_id"],
        "skill_match": result["skill_match"],
        "keyword_match": result["keyword_match"],
        "experience_match": result["experience_match"],
        "tech_match": result["tech_match"],
        "overall_score": result["overall_score"],
        "missing_skills": result["missing_skills"],
        "created_at": datetime.now(timezone.utc),
    }
    res = ats_coll.insert_one(doc)
    return JSONResponse({
        "id": str(res.inserted_id),
        **result,
        "topic_id": str(topic_id_obj) if topic_id_obj else None,
    })


@app.get("/ats")
async def ats_get(
    topic_id: Optional[str] = None,
    limit: int = 5,
    user_id: Optional[str] = Depends(get_user_id),
):
    if not user_id:
        raise HTTPException(401, "Not authenticated")
    from bson import ObjectId
    ats_coll = get_ats_analysis_collection()
    q = {"user_id": user_id}
    if topic_id:
        try:
            q["topic_id"] = ObjectId(topic_id)
        except Exception:
            pass
    cursor = ats_coll.find(q).sort("created_at", -1).limit(limit)
    out = []
    for d in cursor:
        out.append({
            "id": str(d["_id"]),
            "topic_id": str(d["topic_id"]) if d.get("topic_id") else None,
            "cv_id": str(d["cv_id"]) if d.get("cv_id") else None,
            "overall_score": d.get("overall_score"),
            "skill_match": d.get("skill_match"),
            "keyword_match": d.get("keyword_match"),
            "experience_match": d.get("experience_match"),
            "tech_match": d.get("tech_match"),
            "missing_skills": d.get("missing_skills", []),
            "created_at": d["created_at"].isoformat(),
        })
    return JSONResponse(out)
