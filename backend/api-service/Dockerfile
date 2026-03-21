# Build Vue SPA (landing + /app workspace shell), then Python API.
# Vite resolves `../../../static/workspace.css` from frontend/src → /app/static (repo: api-service/static).
FROM node:22-alpine AS web
WORKDIR /app
COPY static ./static/
COPY frontend/package.json frontend/package-lock.json* ./frontend/
RUN cd frontend && npm install
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
    && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
WORKDIR /app
RUN pip install --no-cache-dir --upgrade pip setuptools wheel
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY db.py cv_parser.py auth.py ats_analyzer.py main.py ./
COPY static ./static/
COPY --from=web /app/static/dist ./static/dist
EXPOSE 8001
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
