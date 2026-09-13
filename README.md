# Lagos State Climate Hazard Risk Atlas — WebGIS

Modular, self-hosted WebGIS for nine climate-risk hazard themes across Lagos State.

Stack: Leaflet + TypeScript (frontend) · FastAPI (backend) · PostgreSQL/PostGIS (Neon or self-hosted)
· COG + TiTiler (raster delivery) · Microsoft Planetary Computer STAC (open satellite imagery source)
· Docker Compose (deployment)

## Repo layout

```
backend/    FastAPI app: hazard catalogue, layer metadata, feature/identify queries, STAC ingestion
backend/data/boundaries/   State / LGA / Ward admin boundary GeoJSON (see "Admin boundaries" below)
frontend/   Vite + TypeScript + Leaflet map client
data/       Layer metadata catalogue (source of truth for what the map can show)
nginx/      Reverse proxy config for the hosted deployment
docker-compose.yml   Local/production orchestration: postgis, titiler, backend, frontend, nginx
```

## Admin boundaries (State / LGA / Ward) + area of interest

Three boundary layers are bundled and served straight from disk (no DB/migration needed —
see `backend/app/services/boundaries.py`):

- **State** — 1 feature (Lagos State outline)
- **LGA** — 20 Local Government Areas
- **Ward** — 377 wards (the source file also carried ~17 border wards belonging to Ogun
  State; those are filtered out by `statename`, and each ward's `parent_code` is rewritten
  to match the LGA dataset's `ADM2_PCODE` scheme so ward → LGA lookups work)

Endpoints (all under `/api/v1/boundaries`):
- `GET /boundaries` — which levels exist, with feature counts
- `GET /boundaries/{level}` — lightweight index (name/code/centroid/bbox), optionally
  `?parent_code=` to filter (e.g. all wards in one LGA) or `?q=` to filter by name
- `GET /boundaries/{level}/geojson` — full polygon FeatureCollection for the map
- `GET /boundaries/{level}/{code}` — a single boundary's full geometry

The frontend's **Boundaries** sidebar section toggles each level as an outline overlay;
clicking any boundary on the map sets it as the current **Area of Interest** (AOI). The
**Area of Interest** section also lets a user draw their own polygon by hand (click to
place vertices, "Finish drawing" to close it) — see `frontend/src/map/draw.ts`. Either
kind of AOI can be sent to `POST /api/v1/analysis` (`operation: "area_by_class"`) to get
area-by-risk-class stats for the currently active vector hazard layer, computed in
PostGIS (`ST_Intersection`/`ST_Area` in UTM 31N for accurate km²) — see
`backend/app/routers/analysis.py`. `/search` also now resolves against the real
boundary data (state, all 20 LGAs, all 377 wards) instead of a 10-item shortlist, and
picking a search result that matches a boundary sets it as the AOI too.

Raster hazard layers aren't wired into analysis yet — that needs a `rasterio`/`rasterstats`
pass over the layer's COG for the AOI, a different code path from the PostGIS one above.

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
