# syntax=docker/dockerfile:1.6
# Build Vue SPA (landing + /app workspace shell), then Python API.
# Vite resolves `../../../static/workspace.css` from frontend/src → /app/static (repo: api-service/static).
# Mirror of docker.io/library/node — avoids Docker Hub rate limits in CI.
FROM public.ecr.aws/docker/library/node:22-alpine AS web
WORKDIR /app
COPY static ./static/
COPY frontend/package.json frontend/package-lock.json* ./frontend/
RUN --mount=type=cache,target=/root/.npm \
    cd frontend && npm ci
COPY frontend/ ./frontend/
WORKDIR /app/frontend
RUN npm run build

FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    python3 \
    python3-pip \
    python3-venv \
    tesseract-ocr \
    tesseract-ocr-eng \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
WORKDIR /app
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir --upgrade pip setuptools wheel
COPY requirements.txt .
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --no-cache-dir -r requirements.txt
COPY db.py cv_parser.py cv_docx_optimizer.py auth.py ats_analyzer.py main.py cv_optimize_worker.py cv_optimize_pipeline.py ./
COPY static ./static/
COPY --from=web /app/static/dist ./static/dist
EXPOSE 8001
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
