# Interview Genie – AI Interview Preparation & Live Interview Assistant

## Project overview

Interview Genie is an **AI-powered interview preparation platform** that helps users prepare for jobs by analyzing **CV and job description**, generating an **ATS compatibility score**, and conducting **topic-based AI interviews**.

### Core capabilities

1. **ATS compatibility analysis** – Compare CV vs job description; skill/keyword/experience/tech match; missing skills.
2. **AI-powered mock interviews** – Voice and text Q&A with CV + JD context.
3. **Real-time question answering** – Live transcription and streamed STAR answers.
4. **Topic-based interview history** – Each interview is tied to a topic; history is queryable per topic.
5. **Persistent storage** – MongoDB + PVC for CVs, job descriptions, topics, ATS results, and interview history.

---

## Core workflow

### Step 1 – Upload CV + job description

- User uploads **CV** (PDF/DOCX/TXT) and provides **job description** text (paste or upload).
- Backend parses CV, stores JD with a **topic** (e.g. "Senior Java Backend – Spotify").
- User can create a **topic** (name + job description); ATS analysis uses CV + that JD.

### Step 2 – ATS match analysis

- System compares CV parsed text vs job description.
- Outputs:
  - **ATS score** (overall %)
  - **Skill match**, **keyword match**, **experience match**, **technology match** (e.g. 0–100 each).
  - **Missing skills / keywords** list.
- Stored per topic for dashboard and graphs (radar chart, skill gap, missing keywords).

### Step 3 – Create interview topic

- Each interview run is under a **topic** (e.g. "Java Backend – Spotify").
- Topic = session identifier; all Q&A in that run are stored with `topic_id`.

### Step 4 – AI interview (voice or text)

- **Voice:** Microphone → STT (Whisper) → live transcript → question completion → LLM (Ollama) → streamed answer. CV + JD + topic used as context.
- **Text:** User types question → same LLM pipeline with same context.
- All Q&A saved with `topic_id` (and optional `cv_id`, `session_id`).

### Step 5 – Topic-based interview history

- User can list history by **topic**.
- Enables review of performance per role/company and improvement over time.

---

## MongoDB data structure

### Topics collection

```json
{
  "_id": ObjectId(),
  "user_id": "default",
  "topic": "Senior Java Backend – Spotify",
  "job_description": "We are looking for...",
  "created_at": ISODate()
}
```

Optional: `ats_score` cached on topic after last analysis.

### CVs collection (existing, unchanged)

```json
{
  "_id": ObjectId(),
  "user_id": "default",
  "filename": "cv.pdf",
  "parsed_text": "...",
  "uploaded_at": ISODate(),
  "original_file_path": "/cv_storage/..."
}
```

### Interview history (qa_history) – extended

```json
{
  "_id": ObjectId(),
  "user_id": "default",
  "topic_id": ObjectId(),
  "session_id": "optional_session_uid",
  "cv_id": ObjectId(),
  "question": "Explain microservices architecture",
  "answer": "Microservices architecture divides...",
  "timestamp": ISODate()
}
```

### ATS analysis collection

```json
{
  "_id": ObjectId(),
  "user_id": "default",
  "topic_id": ObjectId(),
  "cv_id": ObjectId(),
  "skill_match": 85,
  "keyword_match": 70,
  "experience_match": 80,
  "tech_match": 75,
  "overall_score": 78,
  "missing_skills": ["Kubernetes", "Kafka", "Terraform"],
  "created_at": ISODate()
}
```

---

## REST API (additions / changes)

| Method | Path | Description |
|--------|------|-------------|
| POST | /topics | Create topic (topic name + job_description). |
| GET | /topics | List user's topics. |
| GET | /topics/{topic_id} | Get one topic (incl. job_description). |
| POST | /ats/analyze | Body: `cv_id`, `topic_id` (JD from topic) or `job_description` raw. Returns ATS scores + missing_skills; stores in ats_analysis. |
| GET | /ats | Query by topic_id; return latest ATS result for topic. |
| POST | /history | Add `topic_id` to body; store with topic. |
| GET | /history | Add query param `topic_id`; filter by topic. |

---

## Kubernetes architecture

```
Mobile / Electron App
    │ REST (CV, topics, ATS, history) + WebSocket (audio)
    ▼
Backend
    ├── API service (CV, topics, ATS, history)
    ├── Audio service (WebSocket, pipeline)
    ├── STT / Question / LLM / Formatter
    └── Ollama
    ▼
MongoDB StatefulSet (topics, cvs, qa_history, ats_analysis)
    ▼
Persistent volumes: MongoDB data + CV file storage
```

---

## Persistent storage

- **MongoDB PVC** – All metadata: topics, CV metadata, qa_history, ats_analysis.
- **CV file storage PVC** – Uploaded CV files (e.g. `/cv_storage` or `UPLOAD_DIR`).

---

## Backend responsibilities

| Component | Responsibility |
|-----------|----------------|
| CV service | Upload CV, parse (PDF/DOCX/TXT), store parsed text. |
| Topics | Create/list/get topic; store job_description. |
| ATS analyzer | Compare CV vs JD; compute scores; extract missing skills; store result. |
| Interview / history | Append Q&A with topic_id; list by topic_id (and user_id). |
| Voice pipeline | STT, question completion, LLM with CV + JD context, stream answer. |

---

## Technology stack

| Layer | Technology |
|-------|------------|
| App | Electron / React Native |
| Backend | Python (FastAPI) – API, audio pipeline |
| Speech-to-text | Whisper (STT service) |
| LLM | Ollama (Qwen / Phi) |
| CV parsing | pypdf, python-docx |
| ATS analysis | Python (keyword/skill extraction, set comparison) |
| Database | MongoDB |
| File storage | Kubernetes PVC |
| Deployment | Kubernetes |

---

## User experience (summary)

1. Upload CV.
2. Create topic (name + paste job description).
3. Run ATS analysis (CV + topic’s JD) → view score dashboard / graph.
4. Start interview for that topic (voice or text).
5. Review topic-based interview history later.

---

## Optional future upgrades (not in this blueprint)

1. AI-generated interview questions from job description.
2. AI answer evaluation and score (interviewer-style).
3. AI rewrite of answers into optimal STAR format.
