# Build Vue SPA (landing + /app workspace shell), then Python API.
# Vite resolves `../../../static/workspace.css` from frontend/src → /app/static (repo: api-service/static).
FROM node:20-alpine AS web
WORKDIR /app
COPY static ./static/
COPY frontend/package.json frontend/package-lock.json* ./frontend/
RUN cd frontend && npm install
COPY frontend/ ./frontend/
WORKDIR /app/frontend
RUN npm run build

FROM python:3.11-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY db.py cv_parser.py auth.py ats_analyzer.py main.py ./
COPY static ./static/
COPY --from=web /app/static/dist ./static/dist

EXPOSE 8001

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
