from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.tiler import create_tiler_app
from app.routers import hazards, layers, features, scenarios, search, analysis, health, boundaries, imagery

settings = get_settings()

app = FastAPI(
    title="Lagos State Climate Hazard Risk Atlas API",
    version="0.1.0",
    description="Backend API Gateway for the Risk Atlas WebGIS — validates layer requests "
    "and routes to raster (COG/TiTiler) or vector (PostGIS/GeoJSON) delivery.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routes must be registered before the static-file mount below — Starlette
# matches routes in registration order, and a "/" mount would otherwise
# swallow every request (including /api/v1/...) if it came first.
app.include_router(health.router, prefix=settings.api_v1_prefix)
app.include_router(hazards.router, prefix=settings.api_v1_prefix)
app.include_router(scenarios.router, prefix=settings.api_v1_prefix)
app.include_router(layers.router, prefix=settings.api_v1_prefix)
app.include_router(features.router, prefix=settings.api_v1_prefix)
app.include_router(search.router, prefix=settings.api_v1_prefix)
app.include_router(analysis.router, prefix=settings.api_v1_prefix)
app.include_router(boundaries.router, prefix=settings.api_v1_prefix)
# imagery.router already declares its own "/api/v1/imagery" prefix, so no
# extra prefix here. (Its /item/...json endpoint is no longer fetched by
# TiTiler — see app/tiler.py — but stays as a handy way to inspect an item.)
app.include_router(imagery.router)

# TiTiler runs inside this app (see app/tiler.py) — one deployment serves the
# API, the raster tiles and the frontend. Like the API routers, this has to be
# mounted before the "/" static-file mount below.
app.mount(settings.titiler_mount_path, create_tiler_app(), name="titiler")

# Serve the built frontend (Vite's `dist` output, copied to ./static by the
# root Dockerfile) for the single-combined-service deploy on Render — see
# render.yaml. Not present in local dev (you run `npm run dev` separately
# there instead), so this is skipped gracefully if the folder is missing.
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
if STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="frontend")
