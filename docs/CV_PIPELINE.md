# CV assembly pipeline (modular foundation)

## Current shape (monolith, section-aware)

ATS CV optimization runs in **api-service** / **cv-optimize-worker** but persists **per-section state** in MongoDB collection **`cv_assemblies`** keyed by the same id as **`cv_optimize_jobs`** (`pipeline_job_id`).

Sections tracked:

| Section        | Role |
|----------------|------|
| `coordinator`  | ATS rules JSON from one targeted LLM call (metadata only in DB). |
| `summary`      | LLM rewrite (2–3 lines). |
| `experience`   | **Tree**: `sections.experience.items[]` with one node per job entry (`exp_0`, `exp_1`, …). Each node has `raw`, `optimized`, `status` (`pending` → `processing` → `complete` \| `failed`). Denormalized `sections.experience.content` is set when the section finishes. Parallel LLM calls per node. |
| `skills`       | Deterministic merges + refresh after bullets. |
| `education`    | Pass-through today (parser may add rows later). |

**Summary** and **experience** LLM work run **in parallel** after rules + `apply_rules` (`CV_OPTIMIZE_PARALLEL_SECTIONS=1`).

## Events

- Every transition appends to `cv_assemblies.events` (last 50).
- Experience node lifecycle: `experience.node_processing`, `experience.node_updated`, `experience.node_failed` (detail includes `node_id`).
- Set **`CV_PIPELINE_EVENTS_RABBIT=1`** to also publish to RabbitMQ topic exchange **`cv.pipeline`** (routing key = event type). Use this to split workers later without changing the document model.

## API

`GET /cv/optimize/jobs/{job_id}` includes an **`assembly`** object when the job created an assembly row (inline + worker paths pass `pipeline_job_id`).

## Next steps (true microservices)

1. Consume RabbitMQ `cv.pipeline.*` in small services that only own one section.
2. Move `coordinator` rules generation behind a dedicated worker if desired.
3. Point **cv-renderer-service** at a read API that returns `assembly.final_cv` or merges `sections.*.content` + experience `items[].optimized` only (today the monolith still builds JSON in-process then POSTs to the renderer).
4. Optional: mirror **skills** as `items[]` nodes (normalization per skill) the same way as experience.

## Performance

Sub‑10s end-to-end depends on **Ollama model size and hardware**; the architecture removes sequential summary→experience where safe and records partial progress for UX.
