import json
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import transform
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import HazardFeature, Layer
from app.schemas import AnalysisRequest, ZonalStatsResult
from app.services import stac_client

router = APIRouter(prefix="/analysis", tags=["analysis"])
settings = get_settings()

AOI_SRID = 4326
# UTM zone 31N covers Lagos and gives accurate metre-based areas — a fixed
# projected CRS (rather than EPSG:4326 degrees) is required for any real
# area calculation.
METRIC_SRID = 32631

_TO_METRIC = Transformer.from_crs(f"EPSG:{AOI_SRID}", f"EPSG:{METRIC_SRID}", always_xy=True)


def _aoi_area_km2(geometry: dict) -> float:
    """AOI area in km² — computed in Python (pyproj + shapely) rather than
    PostGIS, since raster analysis has no PostGIS geometry to piggyback the
    area calculation on the way the vector path below does."""
    geom = shape(geometry)
    projected = transform(_TO_METRIC.transform, geom)
    return projected.area / 1_000_000


def _run_vector_analysis(layer: Layer, body: AnalysisRequest, db: Session) -> ZonalStatsResult:
    """Zonal statistics against a vector hazard layer's features in PostGIS —
    unchanged from the original implementation."""
    aoi = func.ST_SetSRID(func.ST_GeomFromGeoJSON(json.dumps(body.geometry)), AOI_SRID)
    intersection = func.ST_Intersection(HazardFeature.geom, aoi)
    area_m2 = func.ST_Area(func.ST_Transform(intersection, METRIC_SRID))

    stmt = select(HazardFeature.properties, area_m2.label("area_m2")).where(
        HazardFeature.layer_id == body.layer_id,
        func.ST_Intersects(HazardFeature.geom, aoi),
    )
    rows = db.execute(stmt).all()
    total_area_km2 = sum(r.area_m2 for r in rows) / 1_000_000

    if body.operation == "area_by_class":
        by_class: dict[str, float] = {}
        for row in rows:
            props = row.properties or {}
            cls = str(props.get("risk_class", "unclassified"))
            by_class[cls] = by_class.get(cls, 0.0) + row.area_m2 / 1_000_000
        return ZonalStatsResult(
            layer_id=layer.id,
            operation=body.operation,
            feature_count=len(rows),
            area_km2=round(total_area_km2, 3),
            by_class={k: round(v, 3) for k, v in by_class.items()},
        )

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
        operation=body.operation,
        feature_count=len(rows),
        area_km2=round(total_area_km2, 3),
        values=summary,
    )


# TiTiler runs one worker on Render's free tier, so it serves requests
# strictly one at a time. A statistics call issued while the map is still
# pulling tiles queues behind every one of them, and 502/504 here is almost
# always "the queue was long", not "the request was wrong" — the identical
# payload succeeds in ~8s once the tile burst drains. Retrying is therefore
# the correct response, and doing it server-side (rather than making the
# user click again) is what turns a flaky button into a reliable one.
_RETRY_STATUS = {429, 500, 502, 503, 504}
_RETRY_BACKOFF_SECONDS = (3, 9)  # two retries; ~12s of waiting worst case


def _post_statistics_with_retry(url: str, params, feature: dict) -> httpx.Response:
    """POST to TiTiler's statistics endpoint, retrying transient queue/cold-start
    failures. Timeout is per-attempt: 75s covers a free-tier cold start (the
    container spins down after 15 min idle) plus the actual raster read."""
    last_error: str | None = None
    last_status: int | None = None

    for attempt in range(len(_RETRY_BACKOFF_SECONDS) + 1):
        if attempt:
            time.sleep(_RETRY_BACKOFF_SECONDS[attempt - 1])
        try:
            resp = httpx.post(url, params=params, json=feature, timeout=75)
        except httpx.TimeoutException:
            last_error, last_status = "timed out", 504
            continue
        except httpx.HTTPError as exc:
            last_error, last_status = f"connection failed ({exc})", 502
            continue

        if resp.status_code in _RETRY_STATUS:
            last_error = f"returned {resp.status_code}"
            last_status = 502 if resp.status_code != 504 else 504
            continue

        try:
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            # A non-retryable 4xx — a genuinely bad request, so surface it as-is.
            raise HTTPException(
                status_code=502,
                detail=f"TiTiler rejected the statistics request "
                f"({exc.response.status_code}): {exc.response.text[:300]}",
            ) from exc
        return resp

    raise HTTPException(
        status_code=last_status or 502,
        detail=f"The tile server {last_error} on every attempt. It is most likely still "
        "busy rendering map tiles, or waking from idle. Wait a few seconds for the map "
        "to finish loading, then run the analysis again.",
    )


def _run_raster_analysis(layer: Layer, body: AnalysisRequest, request: Request) -> ZonalStatsResult:
    """Zonal statistics against a raster layer by delegating the actual
    pixel sampling to TiTiler's POST /stac/statistics (live STAC-recipe
    layers) or POST /cog/statistics (a stored raster_url) — both accept a
    GeoJSON AOI and return per-band min/max/mean/etc for the pixels inside
    it, so we don't need our own rasterio/rasterstats code path."""
    style = layer.style or {}
    stac_recipe = style.get("stac")

    if style.get("xyz_url") and not stac_recipe and not layer.raster_url:
        raise HTTPException(
            status_code=422,
            detail="This layer is served as pre-rendered reference tiles (e.g. JRC Global "
            "Surface Water), not raw pixel data, so there's nothing to compute zonal "
            "statistics from — it's a visual reference layer only.",
        )

    if stac_recipe:
        try:
            if body.scene_id:
                item = stac_client.get_item_by_id(stac_recipe["collection"], body.scene_id)
                relaxed_search = False
            else:
                item, relaxed_search = stac_client.find_best_scene_with_fallback(
                    collection=stac_recipe["collection"],
                    bbox=stac_recipe.get("bbox"),
                    lookback_days=stac_recipe.get("lookback_days", 90),
                    max_cloud_cover=stac_recipe.get("max_cloud_cover", 20),
                )
        except stac_client.NoScenesFoundError as exc:
            raise HTTPException(status_code=404 if body.scene_id else 503, detail=str(exc)) from exc
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(
                status_code=502, detail=f"Could not reach Planetary Computer: {exc}"
            ) from exc

        item_json_url = stac_client.stac_item_json_url(
            str(request.base_url), stac_recipe["collection"], item.id
        )
        url, params = stac_client.stac_statistics_url(
            item_json_url,
            assets=stac_recipe["assets"],
            expression=stac_recipe.get("expression"),
            nodata=stac_recipe.get("nodata"),
            max_size=512,
        )
        observed_at = str(item.datetime) if item.datetime else None
    elif layer.raster_url:
        url, params = stac_client.cog_statistics_url(layer.raster_url, max_size=512)
        observed_at = None
        relaxed_search = False
    else:
        raise HTTPException(
            status_code=501,
            detail="This raster layer has neither a live STAC recipe nor a stored raster_url "
            "configured, so there's no imagery to sample statistics from.",
        )

    feature = {"type": "Feature", "geometry": body.geometry, "properties": {}}
    resp = _post_statistics_with_retry(url, params, feature)

    data = resp.json()
    # TiTiler's GeoJSON statistics endpoints return the same Feature back
    # with a "statistics" block added under properties, keyed by band/asset
    # or expression name. Fall back to a flat {band: stats} shape too, in
    # case of an older TiTiler version.
    stats_by_band = (data.get("properties") or {}).get("statistics") or data
    if not isinstance(stats_by_band, dict) or not stats_by_band:
        raise HTTPException(status_code=502, detail=f"Unexpected response from TiTiler: {data!r}")

    stats = next(iter(stats_by_band.values()))
    values = {k: round(v, 4) for k, v in stats.items() if isinstance(v, (int, float))}
    pixel_count = int(stats.get("valid_pixels") or stats.get("count") or 0)

    return ZonalStatsResult(
        layer_id=layer.id,
        operation=body.operation,
        feature_count=pixel_count,
        area_km2=round(_aoi_area_km2(body.geometry), 3),
        values=values,
        observed_at=observed_at,
        relaxed_search=relaxed_search,
    )


@router.post("", response_model=ZonalStatsResult)
def run_analysis(body: AnalysisRequest, request: Request, db: Session = Depends(get_db)):
    """Zonal statistics for a user-supplied AOI — either a drawn polygon or
    an admin boundary the user selected (state/LGA/ward) — against any
    hazard layer, vector or raster."""
    layer = db.get(Layer, body.layer_id)
    if not layer:
        raise HTTPException(status_code=404, detail="Layer not found")

    if layer.layer_type == "vector":
        return _run_vector_analysis(layer, body, db)
    return _run_raster_analysis(layer, body, request)
