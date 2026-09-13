# Combined single-service build for Render: builds the Vite frontend, then
# copies the static output into the FastAPI backend image, which serves both
# the API (under /api/v1) and the frontend (everything else) from one
# container/port — see app/main.py's StaticFiles mount.
#
# For local dev, keep using docker-compose.yml (separate backend/frontend
# services with hot reload) or `npm run dev` + `uvicorn --reload` directly —
# this Dockerfile is a production build, not a dev workflow.

# --- Stage 1: build the frontend ---
FROM node:20-slim AS frontend-build
WORKDIR /frontend
COPY frontend/package.json ./
RUN npm install
COPY frontend/ ./
# Same-origin deploy — the API is served from this same container, so the
# frontend can keep using its default relative "/api/v1" base URL. No
# VITE_API_BASE_URL needed here (unlike the split two-service setup).
RUN npm run build

# --- Stage 2: backend, with the built frontend baked in ---
FROM python:3.12-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc curl \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY backend/data ./data
COPY --from=frontend-build /frontend/dist ./static

EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
