"""
API Service: Auth0 (optional), CV upload/parsing, MongoDB (users, CVs, Q&A history, sessions).
"""
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException, Request, UploadFile, File, Header
from fastapi.responses import FileResponse, JSONResponse
from pymongo.errors import DuplicateKeyError, PyMongoError
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
    get_companies_collection,
    get_company_users_collection,
    get_jobs_collection,
    get_candidates_collection,
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

logger = logging.getLogger(__name__)


@app.exception_handler(PyMongoError)
async def pymongo_exception_handler(request: Request, exc: PyMongoError):
    """Avoid opaque 500s when Mongo is down, misconfigured, or timing out."""
    logger.exception("MongoDB error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=503,
        content={
            "detail": "Database unavailable. Check MongoDB is reachable and MONGODB_URI / MONGODB_DB match your cluster.",
        },
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
    language: Optional[str] = None
    name: Optional[str] = None
    role: Optional[str] = None
    company_id: Optional[str] = None


# ── Recruiter models ──────────────────────────────────────────────────────────

class RoleSetRequest(BaseModel):
    role: str  # "candidate" | "recruiter"
    company_name: Optional[str] = None  # required when role == "recruiter"


class CompanyOut(BaseModel):
    id: str
    name: str
    owner_id: str


class JobCreate(BaseModel):
    title: str
    description: str
    skills: list[str] = []


class JobUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    skills: Optional[list[str]] = None


class JobOut(BaseModel):
    id: str
    company_id: str
    title: str
    description: str
    skills: list[str]
    created_at: str


class CandidateOut(BaseModel):
    id: str
    job_id: str
    name: str
    email: str
    skills: list[str]
    experience_years: float
    cv_url: str
    score: float
    status: str


class CandidateStatusUpdate(BaseModel):
    status: str  # "new" | "shortlisted" | "interviewed" | "rejected"


class AiInterviewStartRequest(BaseModel):
    job_id: str
    candidate_id: str


class UserProfileUpdate(BaseModel):
    email: Optional[str] = None
    name: Optional[str] = None
    language: Optional[str] = None


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
        from pymongo.errors import DuplicateKeyError

        bearer = HTTPBearer(auto_error=False)
        creds = await bearer(request)
        if not creds:
            raise HTTPException(401, "Missing authorization")
        payload = verify_token(creds)
        auth0_id = payload.get("sub") or payload.get("auth0_id")
        if not auth0_id:
            raise HTTPException(401, "Token missing subject (sub)")

        email_raw = payload.get("email")
        email = email_raw.strip().lower() if isinstance(email_raw, str) and email_raw.strip() else None

        locale_raw = payload.get("locale")
        language = "sv" if isinstance(locale_raw, str) and locale_raw.lower().startswith("sv") else "en"

        users = get_users_collection()
        user = users.find_one({"auth0_id": auth0_id})
        if not user and email:
            # If the same person logs in via a different provider, Auth0 subject may change.
            # Reuse one Mongo user by matching stable email.
            user = users.find_one({"email": email})
        if not user:
            doc = {
                "auth0_id": auth0_id,
                "email": email,
                "language": language,
                "name": payload.get("name"),
                "created_at": datetime.now(timezone.utc),
            }
            try:
                ins = users.insert_one(doc)
                return str(ins.inserted_id)
            except DuplicateKeyError:
                user = users.find_one({"auth0_id": auth0_id})
                if not user and email:
                    user = users.find_one({"email": email})
                if not user:
                    raise HTTPException(503, "Could not create or load user record")
                return str(user["_id"])

        # Keep identity linkage current, but do not overwrite user-edited profile fields.
        updates = {
            "auth0_id": auth0_id,
        }
        if ("email" not in user or not user.get("email")) and email:
            updates["email"] = email
        token_name = payload.get("name")
        if ("name" not in user or not user.get("name")) and isinstance(token_name, str) and token_name.strip():
            updates["name"] = token_name.strip()
        if "language" not in user or not user.get("language"):
            updates["language"] = language
        if updates:
            users.update_one({"_id": user["_id"]}, {"$set": updates})
        return str(user["_id"])
    if x_user_id:
        users = get_users_collection()
        user = users.find_one({"_id": x_user_id}) or users.find_one({"auth0_id": x_user_id})
        if user:
            return str(user["_id"])
        users.insert_one({
            "_id": x_user_id,
            "auth0_id": x_user_id,
            "language": "en",
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
        language=doc.get("language"),
        name=doc.get("name"),
        role=doc.get("role", "candidate"),
        company_id=str(doc["company_id"]) if doc.get("company_id") else None,
    )


@app.put("/users/me", response_model=UserMe)
async def users_me_update(body: UserProfileUpdate, user_id: Optional[str] = Depends(get_user_id)):
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

    updates = {}
    if body.email is not None:
        next_email = body.email.strip().lower()
        if not next_email:
            raise HTTPException(400, "Email cannot be empty")
        updates["email"] = next_email

    if body.name is not None:
        next_name = body.name.strip()
        updates["name"] = next_name

    if body.language is not None:
        next_language = body.language.strip().lower()
        if next_language not in ("en", "sv"):
            raise HTTPException(400, "language must be one of: en, sv")
        updates["language"] = next_language

    if updates:
        try:
            users.update_one({"_id": doc["_id"]}, {"$set": updates})
        except DuplicateKeyError as e:
            raise HTTPException(409, "Email already in use") from e

    fresh = users.find_one({"_id": doc["_id"]})
    if not fresh:
        raise HTTPException(404, "User not found")

    return UserMe(
        id=str(fresh["_id"]),
        auth0_id=fresh.get("auth0_id"),
        email=fresh.get("email"),
        language=fresh.get("language"),
        name=fresh.get("name"),
        role=fresh.get("role", "candidate"),
        company_id=str(fresh["company_id"]) if fresh.get("company_id") else None,
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
    try:
        os.makedirs(UPLOAD_DIR, exist_ok=True)
    except OSError as e:
        logger.exception("UPLOAD_DIR not writable: %s", UPLOAD_DIR)
        raise HTTPException(
            status_code=503,
            detail="Upload storage is not writable. Set UPLOAD_DIR to a mounted volume (see k8s api-service).",
        ) from e
    path = os.path.join(UPLOAD_DIR, f"{user_id}_{uuid.uuid4().hex}_{filename}")
    try:
        with open(path, "wb") as f:
            f.write(data)
    except OSError as e:
        logger.exception("CV file write failed: %s", path)
        raise HTTPException(
            status_code=503,
            detail="Could not store the uploaded file. Ensure UPLOAD_DIR exists and the volume has free space.",
        ) from e
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
    try:
        os.makedirs(UPLOAD_DIR, exist_ok=True)
    except OSError as e:
        logger.exception("UPLOAD_DIR not writable: %s", UPLOAD_DIR)
        raise HTTPException(
            status_code=503,
            detail="Upload storage is not writable. Set UPLOAD_DIR to a mounted volume (see k8s api-service).",
        ) from e
    path = os.path.join(UPLOAD_DIR, f"{user_id}_{uuid.uuid4().hex}_{filename}")
    try:
        with open(path, "wb") as f:
            f.write(data)
    except OSError as e:
        logger.exception("CV file write failed: %s", path)
        raise HTTPException(
            status_code=503,
            detail="Could not store the uploaded file. Ensure UPLOAD_DIR exists and the volume has free space.",
        ) from e
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


# ═══════════════════════════════════════════════════════════════════════════════
# RECRUITER / ATS ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

CV_PARSER_URL = os.getenv("CV_PARSER_URL", "http://cv-parser-service:8000")


def _resolve_user_doc(user_id: str):
    """Return Mongo user doc by string _id (ObjectId or plain string)."""
    from bson import ObjectId
    users = get_users_collection()
    doc = users.find_one({"_id": user_id})
    if not doc:
        try:
            doc = users.find_one({"_id": ObjectId(user_id)})
        except Exception:
            pass
    return doc


def _require_recruiter(user_id: Optional[str]):
    """Raise 403 unless the user has role==recruiter."""
    if not user_id:
        raise HTTPException(401, "Not authenticated")
    doc = _resolve_user_doc(user_id)
    if not doc or doc.get("role") != "recruiter":
        raise HTTPException(403, "Recruiter role required")
    return doc


# ── Role setup ────────────────────────────────────────────────────────────────

@app.post("/users/me/role", response_model=UserMe)
async def set_user_role(
    body: RoleSetRequest,
    user_id: Optional[str] = Depends(get_user_id),
):
    """Set role to 'candidate' or 'recruiter'. On first recruiter signup, creates the company."""
    if not user_id:
        raise HTTPException(401, "Not authenticated")
    if body.role not in ("candidate", "recruiter"):
        raise HTTPException(400, "role must be 'candidate' or 'recruiter'")

    from bson import ObjectId
    users = get_users_collection()
    doc = _resolve_user_doc(user_id)
    if not doc:
        raise HTTPException(404, "User not found")

    updates: dict = {"role": body.role}

    if body.role == "recruiter":
        # If already a recruiter with a company, don't create another one
        if not doc.get("company_id"):
            company_name = (body.company_name or "").strip()
            if not company_name:
                raise HTTPException(400, "company_name is required when setting role to recruiter")
            companies = get_companies_collection()
            comp_doc = {
                "name": company_name,
                "owner_id": user_id,
                "created_at": datetime.now(timezone.utc),
            }
            comp_res = companies.insert_one(comp_doc)
            comp_id = comp_res.inserted_id
            # Add owner as admin member
            get_company_users_collection().insert_one({
                "user_id": user_id,
                "company_id": comp_id,
                "role": "admin",
                "joined_at": datetime.now(timezone.utc),
            })
            updates["company_id"] = comp_id

    users.update_one({"_id": doc["_id"]}, {"$set": updates})
    fresh = users.find_one({"_id": doc["_id"]})
    return UserMe(
        id=str(fresh["_id"]),
        auth0_id=fresh.get("auth0_id"),
        email=fresh.get("email"),
        language=fresh.get("language"),
        name=fresh.get("name"),
        role=fresh.get("role", "candidate"),
        company_id=str(fresh["company_id"]) if fresh.get("company_id") else None,
    )


# ── Company ───────────────────────────────────────────────────────────────────

@app.get("/recruiter/company", response_model=CompanyOut)
async def recruiter_get_company(user_id: Optional[str] = Depends(get_user_id)):
    doc = _require_recruiter(user_id)
    from bson import ObjectId
    companies = get_companies_collection()
    comp = None
    comp_id = doc.get("company_id")
    if comp_id:
        try:
            comp = companies.find_one({"_id": ObjectId(comp_id) if not isinstance(comp_id, ObjectId) else comp_id})
        except Exception:
            pass
    if not comp:
        raise HTTPException(404, "Company not found")
    return CompanyOut(id=str(comp["_id"]), name=comp["name"], owner_id=str(comp["owner_id"]))


# ── Jobs ──────────────────────────────────────────────────────────────────────

@app.post("/recruiter/jobs", response_model=JobOut)
async def recruiter_create_job(
    body: JobCreate,
    user_id: Optional[str] = Depends(get_user_id),
):
    doc = _require_recruiter(user_id)
    if not doc.get("company_id"):
        raise HTTPException(400, "Recruiter has no company")
    jobs = get_jobs_collection()
    job_doc = {
        "company_id": doc["company_id"],
        "title": body.title.strip(),
        "description": body.description.strip(),
        "skills": [s.strip().lower() for s in body.skills if s.strip()],
        "created_at": datetime.now(timezone.utc),
        "created_by": user_id,
    }
    res = jobs.insert_one(job_doc)
    return JobOut(
        id=str(res.inserted_id),
        company_id=str(job_doc["company_id"]),
        title=job_doc["title"],
        description=job_doc["description"],
        skills=job_doc["skills"],
        created_at=job_doc["created_at"].isoformat(),
    )


@app.get("/recruiter/jobs")
async def recruiter_list_jobs(user_id: Optional[str] = Depends(get_user_id)):
    doc = _require_recruiter(user_id)
    if not doc.get("company_id"):
        return JSONResponse([])
    from bson import ObjectId
    jobs = get_jobs_collection()
    comp_id = doc["company_id"]
    cursor = jobs.find({"company_id": comp_id}).sort("created_at", -1)
    out = []
    for d in cursor:
        out.append({
            "id": str(d["_id"]),
            "company_id": str(d["company_id"]),
            "title": d["title"],
            "description": d["description"],
            "skills": d.get("skills", []),
            "created_at": d["created_at"].isoformat(),
            "candidate_count": get_candidates_collection().count_documents({"job_id": str(d["_id"])}),
        })
    return JSONResponse(out)


@app.get("/recruiter/jobs/{job_id}")
async def recruiter_get_job(job_id: str, user_id: Optional[str] = Depends(get_user_id)):
    doc = _require_recruiter(user_id)
    from bson import ObjectId
    jobs = get_jobs_collection()
    try:
        job = jobs.find_one({"_id": ObjectId(job_id), "company_id": doc.get("company_id")})
    except Exception:
        job = None
    if not job:
        raise HTTPException(404, "Job not found")
    return JSONResponse({
        "id": str(job["_id"]),
        "company_id": str(job["company_id"]),
        "title": job["title"],
        "description": job["description"],
        "skills": job.get("skills", []),
        "created_at": job["created_at"].isoformat(),
    })


@app.put("/recruiter/jobs/{job_id}")
async def recruiter_update_job(
    job_id: str,
    body: JobUpdate,
    user_id: Optional[str] = Depends(get_user_id),
):
    doc = _require_recruiter(user_id)
    from bson import ObjectId
    jobs = get_jobs_collection()
    try:
        job = jobs.find_one({"_id": ObjectId(job_id), "company_id": doc.get("company_id")})
    except Exception:
        job = None
    if not job:
        raise HTTPException(404, "Job not found")
    updates = {}
    if body.title is not None:
        updates["title"] = body.title.strip()
    if body.description is not None:
        updates["description"] = body.description.strip()
    if body.skills is not None:
        updates["skills"] = [s.strip().lower() for s in body.skills if s.strip()]
    if updates:
        jobs.update_one({"_id": job["_id"]}, {"$set": updates})
    fresh = jobs.find_one({"_id": job["_id"]})
    return JSONResponse({
        "id": str(fresh["_id"]),
        "company_id": str(fresh["company_id"]),
        "title": fresh["title"],
        "description": fresh["description"],
        "skills": fresh.get("skills", []),
        "created_at": fresh["created_at"].isoformat(),
    })


@app.delete("/recruiter/jobs/{job_id}", status_code=204)
async def recruiter_delete_job(job_id: str, user_id: Optional[str] = Depends(get_user_id)):
    doc = _require_recruiter(user_id)
    from bson import ObjectId
    jobs = get_jobs_collection()
    try:
        result = jobs.delete_one({"_id": ObjectId(job_id), "company_id": doc.get("company_id")})
    except Exception:
        result = None
    if not result or result.deleted_count == 0:
        raise HTTPException(404, "Job not found")


# ── Candidates ────────────────────────────────────────────────────────────────

def _score_candidate(cv_skills: list[str], job_skills: list[str], experience_years: float) -> float:
    """
    Simple scoring: skill_match (0-60) + experience_match (0-30) + keyword bonus (0-10).
    Returns 0–100.
    """
    if not job_skills:
        skill_score = 30.0
    else:
        cv_set = {s.lower() for s in cv_skills}
        job_set = {s.lower() for s in job_skills}
        matched = cv_set & job_set
        skill_score = (len(matched) / len(job_set)) * 60.0

    # experience: 2yr baseline = 20pts, every extra year +5 up to 30
    exp_score = min(30.0, 10.0 + experience_years * 5.0)

    return round(min(100.0, skill_score + exp_score), 1)


@app.post("/recruiter/jobs/{job_id}/candidates")
async def recruiter_upload_candidate_cv(
    job_id: str,
    file: UploadFile = File(...),
    user_id: Optional[str] = Depends(get_user_id),
):
    """Upload a CV PDF/DOCX for a job. Parses via cv-parser-service, scores against job skills."""
    doc = _require_recruiter(user_id)
    from bson import ObjectId
    import httpx as _httpx

    # Validate job belongs to this recruiter's company
    jobs = get_jobs_collection()
    try:
        job = jobs.find_one({"_id": ObjectId(job_id), "company_id": doc.get("company_id")})
    except Exception:
        job = None
    if not job:
        raise HTTPException(404, "Job not found")

    data = await file.read()
    if not data:
        raise HTTPException(400, "Empty file")
    filename = file.filename or "cv.pdf"

    # Parse via cv-parser-service; fall back to built-in parser if unreachable
    parsed_data: dict = {}
    try:
        async with _httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{CV_PARSER_URL}/parse-cv",
                files={"file": (filename, data, file.content_type or "application/octet-stream")},
            )
            resp.raise_for_status()
            parsed_data = resp.json()
    except Exception:
        # Fallback: use built-in cv_parser for text; structured data will be minimal
        from cv_parser import parse_cv as _parse_cv
        raw_text = _parse_cv(data, filename) or ""
        parsed_data = {"name": "", "email": "", "skills": [], "experience_years": 0, "raw_text": raw_text}

    # Store CV file
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    file_path = os.path.join(UPLOAD_DIR, f"cand_{job_id}_{uuid.uuid4().hex}_{filename}")
    with open(file_path, "wb") as fh:
        fh.write(data)

    candidate_skills = parsed_data.get("skills", [])
    experience_years = float(parsed_data.get("experience_years", 0) or 0)
    score = _score_candidate(candidate_skills, job.get("skills", []), experience_years)

    candidates = get_candidates_collection()
    cand_doc = {
        "job_id": str(job["_id"]),
        "company_id": str(doc.get("company_id")),
        "name": (parsed_data.get("name") or "").strip() or filename,
        "email": (parsed_data.get("email") or "").strip().lower(),
        "skills": candidate_skills,
        "experience_years": experience_years,
        "cv_url": file_path,
        "cv_raw_text": parsed_data.get("raw_text", ""),
        "score": score,
        "status": "new",
        "uploaded_at": datetime.now(timezone.utc),
        "uploaded_by": user_id,
    }
    res = candidates.insert_one(cand_doc)
    return JSONResponse({
        "id": str(res.inserted_id),
        "name": cand_doc["name"],
        "email": cand_doc["email"],
        "skills": cand_doc["skills"],
        "experience_years": cand_doc["experience_years"],
        "score": cand_doc["score"],
        "status": cand_doc["status"],
    }, status_code=201)


@app.get("/recruiter/jobs/{job_id}/candidates")
async def recruiter_list_candidates(
    job_id: str,
    status: Optional[str] = None,
    sort_by: str = "score",
    user_id: Optional[str] = Depends(get_user_id),
):
    doc = _require_recruiter(user_id)
    from bson import ObjectId, DESCENDING
    # Validate job belongs to company
    jobs = get_jobs_collection()
    try:
        job = jobs.find_one({"_id": ObjectId(job_id), "company_id": doc.get("company_id")})
    except Exception:
        job = None
    if not job:
        raise HTTPException(404, "Job not found")

    candidates = get_candidates_collection()
    q: dict = {"job_id": str(job["_id"])}
    if status:
        q["status"] = status
    sort_field = "score" if sort_by == "score" else "uploaded_at"
    cursor = candidates.find(q).sort(sort_field, DESCENDING)
    out = []
    for d in cursor:
        out.append({
            "id": str(d["_id"]),
            "job_id": d["job_id"],
            "name": d.get("name", ""),
            "email": d.get("email", ""),
            "skills": d.get("skills", []),
            "experience_years": d.get("experience_years", 0),
            "score": d.get("score", 0),
            "status": d.get("status", "new"),
            "uploaded_at": d["uploaded_at"].isoformat(),
        })
    return JSONResponse(out)


@app.get("/recruiter/candidates/{candidate_id}")
async def recruiter_get_candidate(candidate_id: str, user_id: Optional[str] = Depends(get_user_id)):
    doc = _require_recruiter(user_id)
    from bson import ObjectId
    candidates = get_candidates_collection()
    try:
        cand = candidates.find_one({
            "_id": ObjectId(candidate_id),
            "company_id": str(doc.get("company_id")),
        })
    except Exception:
        cand = None
    if not cand:
        raise HTTPException(404, "Candidate not found")
    return JSONResponse({
        "id": str(cand["_id"]),
        "job_id": cand["job_id"],
        "name": cand.get("name", ""),
        "email": cand.get("email", ""),
        "skills": cand.get("skills", []),
        "experience_years": cand.get("experience_years", 0),
        "cv_raw_text": cand.get("cv_raw_text", ""),
        "score": cand.get("score", 0),
        "status": cand.get("status", "new"),
        "uploaded_at": cand["uploaded_at"].isoformat(),
    })


@app.patch("/recruiter/candidates/{candidate_id}/status")
async def recruiter_update_candidate_status(
    candidate_id: str,
    body: CandidateStatusUpdate,
    user_id: Optional[str] = Depends(get_user_id),
):
    doc = _require_recruiter(user_id)
    valid_statuses = {"new", "shortlisted", "interviewed", "rejected"}
    if body.status not in valid_statuses:
        raise HTTPException(400, f"status must be one of: {', '.join(sorted(valid_statuses))}")
    from bson import ObjectId
    candidates = get_candidates_collection()
    try:
        result = candidates.update_one(
            {"_id": ObjectId(candidate_id), "company_id": str(doc.get("company_id"))},
            {"$set": {"status": body.status}},
        )
    except Exception:
        result = None
    if not result or result.matched_count == 0:
        raise HTTPException(404, "Candidate not found")
    return JSONResponse({"status": body.status})


# ── AI Interview (recruiter-initiated) ────────────────────────────────────────

@app.post("/recruiter/interview/start")
async def recruiter_start_ai_interview(
    body: AiInterviewStartRequest,
    user_id: Optional[str] = Depends(get_user_id),
):
    """
    Generate 3 personalised interview questions for a candidate applying to a specific job.
    Uses the question-service prompt engine + LLM service.
    """
    doc = _require_recruiter(user_id)
    from bson import ObjectId
    import httpx as _httpx

    # Load job
    jobs = get_jobs_collection()
    try:
        job = jobs.find_one({"_id": ObjectId(body.job_id), "company_id": doc.get("company_id")})
    except Exception:
        job = None
    if not job:
        raise HTTPException(404, "Job not found")

    # Load candidate
    candidates = get_candidates_collection()
    try:
        cand = candidates.find_one({
            "_id": ObjectId(body.candidate_id),
            "job_id": str(job["_id"]),
        })
    except Exception:
        cand = None
    if not cand:
        raise HTTPException(404, "Candidate not found for this job")

    QUESTION_SERVICE_URL = os.getenv("QUESTION_SERVICE_URL", "http://question-service:8000")
    LLM_SERVICE_URL = os.getenv("LLM_SERVICE_URL", "http://llm-service:8000")

    jd = f"Job Title: {job['title']}\n\n{job['description']}"
    cv_text = cand.get("cv_raw_text") or f"Skills: {', '.join(cand.get('skills', []))}"

    interviewer_prompt = (
        "You are a technical interviewer conducting a job interview.\n\n"
        f"Job Description:\n{jd[:2000]}\n\n"
        f"Candidate CV Summary:\n{cv_text[:2000]}\n\n"
        "Generate exactly 3 personalised interview questions tailored to this candidate and role. "
        "Format as a numbered list: 1. ... 2. ... 3. ..."
    )

    # Call LLM service directly with the interviewer prompt
    try:
        async with _httpx.AsyncClient(timeout=60) as client:
            llm_resp = await client.post(
                f"{LLM_SERVICE_URL}/generate",
                json={"prompt": interviewer_prompt},
                timeout=60,
            )
            llm_resp.raise_for_status()
            llm_data = llm_resp.json()
            questions_text = llm_data.get("raw_answer") or llm_data.get("text") or llm_data.get("answer") or ""
    except Exception as e:
        logger.exception("LLM call failed during AI interview start: %s", str(e)[:200])
        raise HTTPException(503, "LLM service unavailable — ensure Ollama is running")

    return JSONResponse({
        "job_id": str(job["_id"]),
        "candidate_id": str(cand["_id"]),
        "candidate_name": cand.get("name", ""),
        "job_title": job["title"],
        "questions": questions_text,
    })

