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
# Guard against a stray vite.config.js shadowing vite.config.ts: Vite's
# default config search checks .js BEFORE .ts, so if a leftover
# vite.config.js ever ends up in the build context (old commit, editor
# artifact, etc.) it silently wins over this project's real vite.config.ts
# — which is exactly what was causing the "Cannot find package
# '@vitejs/plugin-react'" build failures. This repo intentionally has no
# vite.config.js, so it's always safe to remove one if it appears.
RUN rm -f vite.config.js && ls -la
# Broader guard: this project is pure TypeScript, so ANY .js file under
# src/ shadowing a same-named .ts/.tsx file is stale/leftover and will
# silently win module resolution (Vite/Node checks .js before .ts). This
# already caused two separate outages (vite.config.js hiding vite.config.ts,
# then a stale src/api/client.js hiding client.ts and missing methods like
# listHazards). Fail the build loudly instead of shipping a broken bundle.
RUN find src -type f -name '*.js' | while read -r f; do \
      ts="${f%.js}.ts"; tsx="${f%.js}.tsx"; \
      if [ -f "$ts" ] || [ -f "$tsx" ]; then \
        echo "ERROR: stray $f shadows a TypeScript source file — remove it from the repo" >&2; \
        exit 1; \
      fi; \
    done
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
