# Lagos State Climate Hazard Risk Atlas — WebGIS

Modular, self-hosted WebGIS for nine climate-risk hazard themes across Lagos State.

Stack: Leaflet + TypeScript (frontend) · FastAPI (backend) · PostgreSQL/PostGIS (Neon or self-hosted)
· COG + TiTiler (raster delivery) · Microsoft Planetary Computer STAC (open satellite imagery source)
· Docker Compose (deployment)

## Repo layout

```
backend/    FastAPI app: hazard catalogue, layer metadata, feature/identify queries, STAC ingestion
frontend/   Vite + TypeScript + Leaflet map client
data/       Layer metadata catalogue (source of truth for what the map can show)
nginx/      Reverse proxy config for the hosted deployment
docker-compose.yml   Local/production orchestration: postgis, titiler, backend, frontend, nginx
```

## Getting started (local dev)

1. Copy `.env.example` to `.env` and fill in DB credentials (Neon connection string or local PostGIS).
2. `docker compose up -d postgis titiler` — bring up the database and raster tile server.
3. Backend:
   ```
   cd backend
   python -m venv .venv && source .venv/bin/activate
   pip install -r requirements.txt
   alembic upgrade head   # once migrations exist — see NOTES below
   uvicorn app.main:app --reload --port 8000
   ```
4. Frontend:
   ```
   cd frontend
   npm install
   npm run dev
   ```
   The dev server proxies `/api` to `http://localhost:8000`.

## What's scaffolded vs. what's next

Scaffolded now (this drop):
- FastAPI app skeleton matching the API structure in the architecture doc (`/api/v1/hazards`, `/layers`,
  `/layers/{id}`, `/layers/{id}/features`, `/layers/{id}/identify`, `/scenarios`, `/search`, `/analysis`, `/health`)
- SQLAlchemy + GeoAlchemy2 models for the layer catalogue, hazard themes, scenarios
- A Planetary Computer STAC client (`app/services/stac_client.py`) that searches collections, signs asset
  URLs, and can hand a COG URL straight to TiTiler — no imagery is downloaded/stored unless you choose to
  cache it
- Leaflet + TS frontend shell: hazard selector, layer control, legend, identify-on-click, scenario/date
  selector, wired to the backend API client
- `docker-compose.yml` with postgis (PostGIS-enabled Postgres), titiler, backend, frontend, nginx
- A starter `data/catalogue/hazard_layers.json` — the metadata catalogue described in section 6 of the
  architecture doc. This is what both the `/layers` endpoint and the frontend hazard selector read from.

Deliberately left for you to fill in (data/domain-specific, not architecture):
- The actual hazard raster/vector datasets per theme (flood depth grids, subsidence velocity, etc.) —
  the STAC client gives you the *pipeline* to pull candidate imagery (Sentinel-2, Sentinel-1, DEM, land
  cover) from Planetary Computer; the hazard *models* (flood extent from DEM+rainfall, LST from thermal
  bands, etc.) are your GIS analysis work.
- Alembic migration files (I've set up the config; run `alembic revision --autogenerate` once your models
  are final).
- Auth/access control on the API Gateway layer (the doc's "access control" box) — currently open; add
  before any non-public hazard layer goes live.
- Statistics panel logic (`POST /api/v1/analysis`) — stubbed to return a 501 until you decide which
  zonal-statistics operations you want to expose.

## Imagery source (Planetary Computer)

No API key required for search or signed reads. `stac_client.py` uses `pystac-client` against
`https://planetarycomputer.microsoft.com/api/stac/v1` and `planetary-computer`'s `sign()` helper to get
short-lived, authenticated URLs for each asset — those signed URLs are what you hand to TiTiler
(`/cog/tiles/...?url=<signed_url>`), so nothing needs to be re-hosted for a first pass.
