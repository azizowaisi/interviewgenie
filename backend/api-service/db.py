"""
MongoDB connection and collection access.
"""
import os
from typing import Optional

from pymongo import ASCENDING, MongoClient
from pymongo.database import Database

MONGO_URI = os.getenv("MONGODB_URI", "mongodb://mongo:27017")
DB_NAME = os.getenv("MONGODB_DB", "interviewgenie")

_client: Optional[MongoClient] = None
_users_indexes_ready = False


def get_db() -> Database:
    global _client
    if _client is None:
        _client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    return _client[DB_NAME]


def get_users_collection():
    global _users_indexes_ready
    users = get_db().users
    if not _users_indexes_ready:
        # Enforce one user per email across different Auth0 providers.
        # sparse avoids conflicts for legacy docs missing these fields.
        users.create_index(
            [("email", ASCENDING)],
            name="email_unique_sparse",
            unique=True,
            sparse=True,
        )
        users.create_index(
            [("auth0_id", ASCENDING)],
            name="auth0_id_unique_sparse",
            unique=True,
            sparse=True,
        )
        _users_indexes_ready = True
    return users


def get_cvs_collection():
    return get_db().cvs


def get_qa_history_collection():
    return get_db().qa_history


def get_sessions_collection():
    return get_db().sessions


def get_topics_collection():
    return get_db().topics


def get_ats_analysis_collection():
    return get_db().ats_analysis


def get_interview_attempts_collection():
    return get_db().interview_attempts


def get_interview_questions_collection():
    return get_db().interview_questions


# ── Recruiter / ATS collections ──────────────────────────────────────────────

_companies_indexes_ready = False
_jobs_indexes_ready = False
_candidates_indexes_ready = False
_candidate_jobs_indexes_ready = False


def get_companies_collection():
    global _companies_indexes_ready
    col = get_db().companies
    if not _companies_indexes_ready:
        col.create_index([("owner_id", ASCENDING)], name="company_owner")
        _companies_indexes_ready = True
    return col


def get_company_users_collection():
    return get_db().company_users


def get_jobs_collection():
    global _jobs_indexes_ready
    col = get_db().jobs
    if not _jobs_indexes_ready:
        col.create_index([("company_id", ASCENDING)], name="job_company")
        col.create_index([("company_id", ASCENDING), ("created_at", ASCENDING)], name="job_company_date")
        _jobs_indexes_ready = True
    return col


def get_candidates_collection():
    global _candidates_indexes_ready
    col = get_db().candidates
    if not _candidates_indexes_ready:
        col.create_index([("job_id", ASCENDING)], name="candidate_job")
        col.create_index([("job_id", ASCENDING), ("score", ASCENDING)], name="candidate_job_score")
        _candidates_indexes_ready = True
    return col


def get_candidate_jobs_collection():
    global _candidate_jobs_indexes_ready
    col = get_db().candidate_jobs
    if not _candidate_jobs_indexes_ready:
        col.create_index([("user_id", ASCENDING), ("created_at", ASCENDING)], name="candidate_jobs_user_date")
        col.create_index([("user_id", ASCENDING), ("status", ASCENDING)], name="candidate_jobs_user_status")
        _candidate_jobs_indexes_ready = True
    return col


def get_cv_optimize_jobs_collection():
    return get_db().cv_optimize_jobs


def get_generated_downloads_collection():
    return get_db().generated_downloads
