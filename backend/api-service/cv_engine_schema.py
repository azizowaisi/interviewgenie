"""CV engine event-driven pipeline — exchange names and collection (shared contract)."""

from __future__ import annotations

EXCHANGE_JOBS = "cv.jobs"
EXCHANGE_EVENTS = "cv.events"
CV_ENGINE_RUNS = "cv_engine_runs"

# Routing keys (jobs): cv.summary | cv.skills | cv.education | cv.experience.exp_<n>
# Events: cv.summary.updated | cv.skills.updated | cv.education.updated | cv.experience.exp_<n>.updated | cv.assembly.complete
