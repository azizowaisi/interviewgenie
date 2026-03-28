# Interview Genie – Development Blueprint

## Architecture (integrated)

```
Mobile / Web / Electron Client
  │ Auth0 JWT in Authorization header
  │ WebSocket: /ws/audio (audio + optional user_id, cv_id, session_id)
  │ REST: /api/* (CV upload, history, sessions)
  ▼
┌─────────────────────────────────────────────────────────────────┐
│ API Service (port 8001)                                          │
│ - Auth0 JWT validation                                           │
│ - REST: /users/me, /cv/upload, /cv, /history, /sessions          │
│ - MongoDB: users, cvs, qa_history, sessions                     │
│ - CV parsing: PDF, DOCX, TXT → store parsed_text                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────┴──────────────────────────────────────┐
│ Audio Service (port 8000)                                         │
│ - WebSocket /ws/audio                                             │
│ - Optional: user_id, cv_id, session_id in first JSON message    │
│ - Pipeline: STT → Question (+ CV context from API) → LLM → Format  │
│ - On answer_done: POST to API /history to save Q&A                │
└──────────────────────────┬──────────────────────────────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                 ▼
   Whisper/STT      Question Service    LLM Service
   Formatter        (optional cv_context)
                           │
                           ▼
                    MongoDB (users, cvs, qa_history, sessions)
```

## File structure (new/updated)

```
backend/
  api-service/           # NEW
    main.py              # FastAPI: auth, CV upload, history, sessions
    auth.py              # Auth0 JWT validation (optional)
    db.py                # MongoDB connection and collections
    cv_parser.py         # PDF/DOCX/TXT parsing
    requirements.txt
    Dockerfile
  question-service/
    main.py              # UPDATE: accept optional cv_context in /process
  audio-service/
    main.py              # UPDATE: call API for CV context + save Q&A (if user_id)
docker-compose.yml       # ADD: api-service, mongo
docs/
  BLUEPRINT.md           # This file
  API.md                 # REST + WebSocket spec (optional)
```

## REST API (API Service)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /health | No | Health check |
| GET | /users/me | JWT | Current user from JWT (create if new) |
| POST | /cv/upload | JWT | Upload CV file (multipart); parse and store |
| GET | /cv | JWT | List user's CVs |
| GET | /cv/{cv_id} | JWT | Get one CV (parsed_text, metadata) |
| POST | /sessions | JWT | Create session; return session_id |
| GET | /sessions | JWT | List user's sessions |
| POST | /history | JWT | Append Q&A (question, answer, session_id, cv_id?) |
| GET | /history | JWT | List Q&A (optional: session_id, cv_id, limit) |

## WebSocket /ws/audio (Audio Service) – optional fields

First text message after connect can include:

```json
{ "user_id": "auth0|xxx", "session_id": "session_001", "cv_id": "objectid_hex" }
```

- If **cv_id** present: audio-service fetches CV parsed_text from API and passes as **cv_context** to question-service.
- On **answer_done**: if **user_id** present, audio-service POSTs to API `/history` with question, answer, session_id, cv_id.

## MongoDB collections

- **users**: auth0_id, email, name, created_at
- **cvs**: user_id, filename, parsed_text, uploaded_at, original_file_path (or store file in volume/S3)
- **qa_history**: user_id, cv_id (optional), session_id (optional), question, answer, timestamp
- **sessions**: user_id, session_name, start_time, end_time (optional)

## Auth0

- Validate JWT with JWKS from Auth0 domain.
- Env: AUTH0_DOMAIN, AUTH0_AUDIENCE (API identifier). If unset, auth is skipped (local dev).

## Security

- All API routes (except /health) require valid JWT when AUTH0_* is set.
- CV files: store in backend volume; DB holds path + parsed_text only.
- MongoDB: single database; indexes on user_id, session_id, cv_id.

## Mobile (later)

- React Native or Flutter app: Auth0 SDK → get JWT → use in REST and WebSocket.
- WebSocket URL: wss://your-api/ws/audio; send first message with user_id, session_id, cv_id if logged in.

---

This blueprint is implemented incrementally: API service + MongoDB first, then question/audio wiring, then optional Auth0.
