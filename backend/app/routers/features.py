from fastapi import APIRouter, Depends, HTTPException, Query
from geoalchemy2.shape import to_shape
from shapely.geometry import mapping
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import HazardFeature, Layer

router = APIRouter(prefix="/layers", tags=["layers"])


@router.get("/{layer_id}/features")
def get_features(
    layer_id: str,
    bbox: str | None = Query(default=None, description="min_lon,min_lat,max_lon,max_lat"),
    db: Session = Depends(get_db),
):
    """Filtered vector feature query -> GeoJSON FeatureCollection, per
    section 6 ('Use GeoJSON for manageable feature responses')."""
    layer = db.get(Layer, layer_id)
    if not layer or layer.layer_type != "vector":
        raise HTTPException(status_code=404, detail="Vector layer not found")

    stmt = select(HazardFeature).where(HazardFeature.layer_id == layer_id)
    if bbox:
        try:
            min_lon, min_lat, max_lon, max_lat = (float(v) for v in bbox.split(","))
        except ValueError:
            raise HTTPException(
                status_code=400, detail="bbox must be 'min_lon,min_lat,max_lon,max_lat'"
            )
        # Scope to the selected area of interest (state/LGA/ward/drawn AOI)
        # using ST_Intersects with an envelope — see section 6's guidance on
        # extent-based queries. This is a bounding-box filter, not an exact
        # polygon clip; a feature that merely overlaps the AOI's bbox corner
        # can still come back even if it's outside the AOI's true shape.
        # Exact polygon clipping (ST_Intersection against the AOI geometry
        # itself) is a reasonable follow-up if that precision matters.
        envelope = func.ST_MakeEnvelope(min_lon, min_lat, max_lon, max_lat, 4326)
        stmt = stmt.where(func.ST_Intersects(HazardFeature.geom, envelope))
    rows = db.execute(stmt).scalars().all()

    features = [
        {
            "type": "Feature",
            "geometry": mapping(to_shape(row.geom)),
            "properties": row.properties,
        }
        for row in rows
    ]
    return {"type": "FeatureCollection", "features": features}


@router.get("/{layer_id}/identify")
def identify(
    layer_id: str,
    lon: float = Query(...),
    lat: float = Query(...),
    db: Session = Depends(get_db),
):
    """Hazard value / feature identify for a clicked point.

    For vector layers: ST_Contains lookup against hazard_features.
    For raster layers: proxy to TiTiler's /cog/point endpoint using the
    layer's raster_url (left as a follow-up call from the frontend directly
    to titiler_point_url, or implement here once a specific raster is wired
    up — the plumbing (layer -> raster_url) already exists in layers.py).
    """
    layer = db.get(Layer, layer_id)
    if not layer:
        raise HTTPException(status_code=404, detail="Layer not found")

    if layer.layer_type == "vector":
        from sqlalchemy import func

        stmt = select(HazardFeature).where(
            HazardFeature.layer_id == layer_id,
            func.ST_Contains(HazardFeature.geom, func.ST_SetSRID(func.ST_MakePoint(lon, lat), 4326)),
        )
        row = db.execute(stmt).scalars().first()
        if not row:
            return {"layer_id": layer_id, "value": None, "properties": None}
        return {"layer_id": layer_id, "value": None, "properties": row.properties}

    raise HTTPException(
        status_code=501,
        detail="Raster identify not yet wired — proxy to TiTiler /cog/point using layer.raster_url",
    )
