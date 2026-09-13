from typing import Literal

from fastapi import APIRouter, HTTPException, Query

from app.schemas import BoundaryLevelOut, BoundarySummaryOut
from app.services import boundaries as boundaries_service

router = APIRouter(prefix="/boundaries", tags=["boundaries"])

BoundaryLevel = Literal["state", "lga", "ward"]


@router.get("", response_model=list[BoundaryLevelOut])
def list_boundary_levels():
    """Which admin boundary layers are available (drives the sidebar's
    State / LGA / Ward toggle list)."""
    return boundaries_service.list_levels()


@router.get("/{level}", response_model=list[BoundarySummaryOut])
def list_boundaries(
    level: BoundaryLevel,
    parent_code: str | None = Query(
        default=None, description="Filter by parent boundary code, e.g. an lga code to list its wards"
    ),
    q: str | None = Query(default=None, min_length=1, description="Filter by name substring"),
):
    """Lightweight index (name/code/centroid/bbox, no geometry) — used for
    populating filter dropdowns and search without shipping full polygons."""
    features = boundaries_service.get_features(level, parent_code=parent_code, q=q)
    return [
        BoundarySummaryOut(
            level=f.level,
            code=f.code,
            name=f.name,
            parent_code=f.parent_code,
            parent_name=f.parent_name,
            centroid=f.centroid,
            bbox=f.bbox,
        )
        for f in features
    ]


@router.get("/{level}/geojson")
def get_boundary_geojson(
    level: BoundaryLevel,
    parent_code: str | None = Query(
        default=None, description="Filter by parent boundary code, e.g. an lga code to get only its wards"
    ),
):
    """Full polygon geometry for a boundary layer, as a FeatureCollection
    ready to drop straight into L.geoJSON on the frontend."""
    features = boundaries_service.get_features(level, parent_code=parent_code)
    return {
        "type": "FeatureCollection",
        "features": [f.as_feature() for f in features],
    }


@router.get("/{level}/{code}")
def get_boundary_feature(level: BoundaryLevel, code: str):
    """A single boundary's full geometry — used as the AOI when a user
    picks one boundary (e.g. one LGA) to filter/analyze against."""
    feature = boundaries_service.get_feature(level, code)
    if not feature:
        raise HTTPException(status_code=404, detail=f"{level} '{code}' not found")
    return feature.as_feature()
