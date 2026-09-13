from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import hazards, layers, features, scenarios, search, analysis, health

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

app.include_router(health.router, prefix=settings.api_v1_prefix)
app.include_router(hazards.router, prefix=settings.api_v1_prefix)
app.include_router(scenarios.router, prefix=settings.api_v1_prefix)
app.include_router(layers.router, prefix=settings.api_v1_prefix)
app.include_router(features.router, prefix=settings.api_v1_prefix)
app.include_router(search.router, prefix=settings.api_v1_prefix)
app.include_router(analysis.router, prefix=settings.api_v1_prefix)
