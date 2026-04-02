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
