import hashlib
import json
import math
import time

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import Layer
from app.routers.analysis import _post_statistics_with_retry
from app.schemas import LayerOut, LayerDetailOut, LayerRangeOut, LayerRangeRequest
from app.services import boundaries as boundaries_service
from app.services import stac_client
from app.services.stac_client import titiler_tile_url

router = APIRouter(prefix="/layers", tags=["layers"])
settings = get_settings()


@router.get("", response_model=list[LayerOut])
def list_layers(
    hazard: str | None = Query(default=None, description="Filter by hazard_theme_id"),
    scenario: str | None = Query(default=None, description="Filter by scenario_id"),
    db: Session = Depends(get_db),
):
    """The published layer catalogue (section 6 of the architecture doc)."""
    stmt = select(Layer).where(Layer.is_public.is_(True))
    if hazard:
        stmt = stmt.where(Layer.hazard_theme_id == hazard)
    if scenario:
        stmt = stmt.where(Layer.scenario_id == scenario)
    return db.execute(stmt).scalars().all()


@router.get("/{layer_id}", response_model=LayerDetailOut)
def get_layer(
    layer_id: str,
    request: Request,
    scene_id: str | None = Query(
        default=None,
        description="Pin an exact Planetary Computer scene (its STAC item id, from "
        "GET /api/v1/imagery/search) for a live STAC layer, instead of auto-picking "
        "the most recent one. No effect on non-live raster layers or vector layers.",
    ),
    db: Session = Depends(get_db),
):
    """Layer metadata + style configuration, plus the resolved URL the
    frontend should actually request data from (raster tile template or
    vector features endpoint) — this is what backs step 3-5 of the System
    Flow ("Leaflet requests layer metadata... backend routes the request to
    the appropriate delivery mechanism")."""
    layer = db.get(Layer, layer_id)
    if not layer:
        raise HTTPException(status_code=404, detail="Layer not found")

    tile_url = None
    features_url = None
    observed_at = None
    cloud_cover = None
    relaxed_search = False
    resolved_scene_id = None

    if layer.layer_type == "raster":
        style = layer.style or {}
        stac_recipe = style.get("stac")
        xyz_url = style.get("xyz_url")
        if xyz_url:
            # A plain pre-rendered public XYZ tile service (e.g. JRC Global
            # Surface Water) — served straight from its own host, no
            # TiTiler/STAC involved at all. Different provider entirely from
            # the Planetary Computer "live" layers below, and not anchored
            # to any particular scene the user can pick (it's a fixed
            # multi-decade 1984-2021 composite), so `scene_id` is ignored
            # here.
            tile_url = xyz_url
        elif stac_recipe:
            # Live layer: either use the exact scene the user picked (via
            # GET /api/v1/imagery/search — see the frontend's scene-browser
            # UI), or fall back to auto-picking the most recent one, same as
            # before that existed.
            try:
                if scene_id:
                    item = stac_client.get_item_by_id(stac_recipe["collection"], scene_id)
                else:
                    item, relaxed_search = stac_client.find_best_scene_with_fallback(
                        collection=stac_recipe["collection"],
                        bbox=stac_recipe.get("bbox"),
                        lookback_days=stac_recipe.get("lookback_days", 90),
                        max_cloud_cover=stac_recipe.get("max_cloud_cover", 20),
                    )
            except stac_client.NoScenesFoundError as exc:
                raise HTTPException(status_code=404 if scene_id else 503, detail=str(exc)) from exc
            except Exception as exc:  # noqa: BLE001 — surface STAC/network errors plainly
                raise HTTPException(
                    status_code=502, detail=f"Could not reach Planetary Computer: {exc}"
                ) from exc

            item_json_url = stac_client.stac_item_ref(stac_recipe["collection"], item.id)
            tile_url = stac_client.stac_tile_url(
                item_json_url,
                assets=stac_recipe["assets"],
                expression=stac_recipe.get("expression"),
                rescale=stac_recipe.get("rescale"),
                colormap_name=stac_recipe.get("colormap_name"),
                nodata=stac_recipe.get("nodata"),
            )
            observed_at = str(item.datetime) if item.datetime else None
            cloud_cover = item.properties.get("eo:cloud_cover")
            resolved_scene_id = item.id
        elif layer.raster_url:
            colormap = (layer.style or {}).get("colormap_name")
            rescale = (layer.style or {}).get("rescale")
            tile_url = titiler_tile_url(layer.raster_url, colormap, rescale)
    elif layer.layer_type == "vector":
        features_url = f"{settings.api_v1_prefix}/layers/{layer.id}/features"

    return LayerDetailOut(
        **LayerOut.model_validate(layer).model_dump(),
        tile_url=tile_url,
        features_url=features_url,
        observed_at=observed_at,
        cloud_cover=cloud_cover,
        relaxed_search=relaxed_search,
        scene_id=resolved_scene_id,
    )


# --- Legend range -----------------------------------------------------------
# The colour ramp / legend is stretched to the real min and max of the layer
# over the area being looked at (the selected AOI, or all of Lagos State when
# nothing is selected) rather than a fixed catalogue value. Statistics come
# from the same TiTiler endpoints the "Run analysis" button uses.

_RANGE_CACHE_TTL_SECONDS = 600
_range_cache: dict[tuple, tuple[float, tuple[float, float]]] = {}


def _lagos_state_geometry() -> dict:
    features = boundaries_service.get_features("state")
    if not features:
        raise HTTPException(status_code=500, detail="Lagos State boundary is not available.")
    return features[0].geometry


@router.post("/{layer_id}/range", response_model=LayerRangeOut)
def get_layer_range(layer_id: str, body: LayerRangeRequest, db: Session = Depends(get_db)):
    """Min/max of a raster layer over the AOI (or all of Lagos), plus the
    tile URL re-styled to that range so the legend matches the map."""
    layer = db.get(Layer, layer_id)
    if not layer:
        raise HTTPException(status_code=404, detail="Layer not found")
    if layer.layer_type != "raster":
        raise HTTPException(status_code=422, detail="Only raster layers have a value range.")

    style = layer.style or {}
    stac_recipe = style.get("stac")
    if style.get("xyz_url") and not stac_recipe and not layer.raster_url:
        raise HTTPException(
            status_code=422,
            detail="Pre-rendered tile layers have no raw pixel values to calculate a range from.",
        )

    geometry = body.geometry or _lagos_state_geometry()
    geom_key = hashlib.md5(json.dumps(geometry, sort_keys=True).encode()).hexdigest()

    item = None
    if stac_recipe:
        try:
            if body.scene_id:
                item = stac_client.get_item_by_id(stac_recipe["collection"], body.scene_id)
            else:
                item, _ = stac_client.find_best_scene_with_fallback(
                    collection=stac_recipe["collection"],
                    bbox=stac_recipe.get("bbox"),
                    lookback_days=stac_recipe.get("lookback_days", 90),
                    max_cloud_cover=stac_recipe.get("max_cloud_cover", 20),
                )
        except stac_client.NoScenesFoundError as exc:
            raise HTTPException(status_code=404 if body.scene_id else 503, detail=str(exc)) from exc
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=502, detail=f"Could not reach STAC catalogue: {exc}") from exc
        source_key = item.id
    elif layer.raster_url:
        source_key = layer.raster_url
    else:
        raise HTTPException(status_code=501, detail="This raster layer has no imagery configured.")

    cache_key = (layer.id, source_key, geom_key)
    cached = _range_cache.get(cache_key)
    if cached and time.monotonic() - cached[0] < _RANGE_CACHE_TTL_SECONDS:
        lo, hi = cached[1]
    else:
        if stac_recipe:
            url, params = stac_client.stac_statistics_url(
                stac_client.stac_item_ref(stac_recipe["collection"], item.id),
                assets=stac_recipe["assets"],
                expression=stac_recipe.get("expression"),
                nodata=stac_recipe.get("nodata"),
                max_size=512,
            )
        else:
            url, params = stac_client.cog_statistics_url(layer.raster_url, max_size=512)

        resp = _post_statistics_with_retry(
            url, params, {"type": "Feature", "geometry": geometry, "properties": {}}
        )
        data = resp.json()
        stats_by_band = (data.get("properties") or {}).get("statistics") or data
        stats = next(iter(stats_by_band.values())) if isinstance(stats_by_band, dict) and stats_by_band else {}
        raw_lo, raw_hi = stats.get("min"), stats.get("max")
        if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in (raw_lo, raw_hi)):
            raise HTTPException(status_code=404, detail="No valid pixels in this area to calculate a range from.")

        # Floor/ceil at 2 dp so every pixel sits inside the ramp and the
        # legend labels are short, clean numbers.
        lo = math.floor(raw_lo * 100) / 100
        hi = math.ceil(raw_hi * 100) / 100
        if hi <= lo:
            hi = round(lo + 0.01, 2)
        _range_cache[cache_key] = (time.monotonic(), (lo, hi))

    rescale = f"{lo},{hi}"
    if stac_recipe:
        tile_url = stac_client.stac_tile_url(
            stac_client.stac_item_ref(stac_recipe["collection"], item.id),
            assets=stac_recipe["assets"],
            expression=stac_recipe.get("expression"),
            rescale=rescale,
            colormap_name=stac_recipe.get("colormap_name"),
            nodata=stac_recipe.get("nodata"),
        )
    else:
        tile_url = titiler_tile_url(layer.raster_url, style.get("colormap_name"), rescale)

    return LayerRangeOut(min=lo, max=hi, tile_url=tile_url)
