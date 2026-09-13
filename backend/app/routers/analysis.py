import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import HazardFeature, Layer
from app.schemas import AnalysisRequest, ZonalStatsResult

router = APIRouter(prefix="/analysis", tags=["analysis"])

AOI_SRID = 4326
# UTM zone 31N covers Lagos and gives accurate metre-based areas — a fixed
# projected CRS (rather than EPSG:4326 degrees) is required for any real
# area calculation.
METRIC_SRID = 32631


@router.post("", response_model=ZonalStatsResult)
def run_analysis(request: AnalysisRequest, db: Session = Depends(get_db)):
    """Zonal statistics for a user-supplied AOI — either a drawn polygon or
    an admin boundary the user selected (state/LGA/ward) — against a vector
    hazard layer's features in PostGIS.

    Raster zonal stats (sampling a COG under the AOI) isn't implemented here;
    that needs rasterio/rasterstats reading the layer's raster_url and is a
    separate code path from this PostGIS one — left as a follow-up.
    """
    layer = db.get(Layer, request.layer_id)
    if not layer:
        raise HTTPException(status_code=404, detail="Layer not found")
    if layer.layer_type != "vector":
        raise HTTPException(
            status_code=501,
            detail="Analysis is only implemented for vector (PostGIS) layers right now — "
            "raster zonal stats would sample the COG via rasterio/rasterstats instead.",
        )

    aoi = func.ST_SetSRID(func.ST_GeomFromGeoJSON(json.dumps(request.geometry)), AOI_SRID)
    intersection = func.ST_Intersection(HazardFeature.geom, aoi)
    area_m2 = func.ST_Area(func.ST_Transform(intersection, METRIC_SRID))

    stmt = select(HazardFeature.properties, area_m2.label("area_m2")).where(
        HazardFeature.layer_id == request.layer_id,
        func.ST_Intersects(HazardFeature.geom, aoi),
    )
    rows = db.execute(stmt).all()
    total_area_km2 = sum(r.area_m2 for r in rows) / 1_000_000

    if request.operation == "area_by_class":
        by_class: dict[str, float] = {}
        for row in rows:
            props = row.properties or {}
            cls = str(props.get("risk_class", "unclassified"))
            by_class[cls] = by_class.get(cls, 0.0) + row.area_m2 / 1_000_000
        return ZonalStatsResult(
            layer_id=layer.id,
            operation=request.operation,
            feature_count=len(rows),
            area_km2=round(total_area_km2, 3),
            by_class={k: round(v, 3) for k, v in by_class.items()},
        )

    # zonal_stats: summary of the numeric "value" property across intersecting features.
    values = [
        float(props["value"])
        for row in rows
        if isinstance((props := (row.properties or {})).get("value"), (int, float))
    ]
    summary = None
    if values:
        summary = {
            "count": len(values),
            "min": round(min(values), 3),
            "max": round(max(values), 3),
            "mean": round(sum(values) / len(values), 3),
        }
    return ZonalStatsResult(
        layer_id=layer.id,
        operation=request.operation,
        feature_count=len(rows),
        area_km2=round(total_area_km2, 3),
        values=summary,
    )
