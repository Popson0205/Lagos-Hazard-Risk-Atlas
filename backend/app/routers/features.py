import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from geoalchemy2.shape import to_shape
from shapely.geometry import mapping
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import HazardFeature, Layer
from app.services import stac_client

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
    # NOTE: bbox filtering should use ST_Intersects with an extent-based index
    # (section 6: "spatial indexes and extent-based queries") — left as a
    # follow-up once real geometries are loaded; parsing is stubbed here.
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
    request: Request,
    lon: float = Query(...),
    lat: float = Query(...),
    scene_id: str | None = Query(
        default=None,
        description="Same scene pin as GET /layers/{id}?scene_id= — identify should read "
        "whatever scene is actually on screen, not silently re-pick 'most recent'.",
    ),
    db: Session = Depends(get_db),
):
    """Hazard value / feature identify for a clicked point.

    Vector layers: ST_Contains lookup against hazard_features.
    Raster layers: proxied to TiTiler's GET /stac/point or /cog/point (a
    single-pixel value lookup) — mirrors exactly the same scene-resolution
    and expression/nodata handling as the tile and statistics endpoints.
    """
    layer = db.get(Layer, layer_id)
    if not layer:
        raise HTTPException(status_code=404, detail="Layer not found")

    if layer.layer_type == "vector":
        stmt = select(HazardFeature).where(
            HazardFeature.layer_id == layer_id,
            func.ST_Contains(HazardFeature.geom, func.ST_SetSRID(func.ST_MakePoint(lon, lat), 4326)),
        )
        row = db.execute(stmt).scalars().first()
        if not row:
            return {"layer_id": layer_id, "value": None, "properties": None}
        return {"layer_id": layer_id, "value": None, "properties": row.properties}

    style = layer.style or {}
    stac_recipe = style.get("stac")

    if style.get("xyz_url") and not stac_recipe and not layer.raster_url:
        raise HTTPException(
            status_code=422,
            detail="This layer is served as pre-rendered reference tiles (e.g. JRC Global "
            "Surface Water), not raw pixel data, so there's no value to identify — it's a "
            "visual reference layer only.",
        )

    if stac_recipe:
        try:
            if scene_id:
                item = stac_client.get_item_by_id(stac_recipe["collection"], scene_id)
            else:
                item, _relaxed = stac_client.find_best_scene_with_fallback(
                    collection=stac_recipe["collection"],
                    bbox=stac_recipe.get("bbox"),
                    lookback_days=stac_recipe.get("lookback_days", 90),
                    max_cloud_cover=stac_recipe.get("max_cloud_cover", 20),
                )
        except stac_client.NoScenesFoundError as exc:
            raise HTTPException(status_code=404 if scene_id else 503, detail=str(exc)) from exc
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(
                status_code=502, detail=f"Could not reach Planetary Computer: {exc}"
            ) from exc

        item_json_url = stac_client.stac_item_json_url(
            str(request.base_url), stac_recipe["collection"], item.id
        )
        url, params = stac_client.stac_point_url(
            item_json_url,
            assets=stac_recipe["assets"],
            expression=stac_recipe.get("expression"),
            nodata=stac_recipe.get("nodata"),
        )
    elif layer.raster_url:
        url, params = stac_client.cog_point_url(layer.raster_url)
    else:
        raise HTTPException(
            status_code=501,
            detail="This raster layer has neither a live STAC recipe nor a stored raster_url "
            "configured, so there's no imagery to identify a value from.",
        )

    lon_lat_path = f"{lon},{lat}"
    try:
        resp = httpx.get(f"{url}/{lon_lat_path}", params=params, timeout=30)
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        # TiTiler returns 404 when the point falls outside the raster's
        # actual footprint — a real "nothing there", not a server error.
        if exc.response.status_code == 404:
            return {"layer_id": layer_id, "value": None, "properties": None}
        raise HTTPException(
            status_code=502,
            detail=f"TiTiler point lookup failed ({exc.response.status_code}): {exc.response.text[:300]}",
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Could not reach TiTiler: {exc}") from exc

    data = resp.json()
    values = data.get("values") or []
    value = values[0] if values else None
    return {"layer_id": layer_id, "value": value, "properties": None}
