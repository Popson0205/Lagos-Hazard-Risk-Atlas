from datetime import date as date_type

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import Layer
from app.schemas import LayerOut, LayerDetailOut
from app.services import stac_client
from app.services.stac_client import titiler_tile_url

router = APIRouter(prefix="/layers", tags=["layers"])
settings = get_settings()


def _parse_anchor_date(date_str: str | None) -> date_type | None:
    if not date_str:
        return None
    try:
        parsed = date_type.fromisoformat(date_str)
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail=f"Invalid date '{date_str}' — expected YYYY-MM-DD"
        ) from exc
    if parsed > date_type.today():
        raise HTTPException(status_code=400, detail="date cannot be in the future")
    return parsed


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
    date: str | None = Query(
        default=None,
        description="ISO date (YYYY-MM-DD) to anchor a live STAC layer's imagery "
        "search to — finds the least-cloudy scene in the lookback window ending on "
        "this date, instead of today. No effect on non-live raster layers or vector "
        "layers. Ignored if item_id is also given.",
    ),
    item_id: str | None = Query(
        default=None,
        description="A specific STAC item id from GET /imagery/search (same collection "
        "as the layer's recipe) to pin this layer to, instead of auto-picking the "
        "least-cloudy scene — for the manual imagery search-and-select panel. Takes "
        "priority over `date`.",
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

    anchor_date = _parse_anchor_date(date)

    tile_url = None
    features_url = None
    observed_at = None
    cloud_cover = None
    relaxed_search = False

    if layer.layer_type == "raster":
        style = layer.style or {}
        stac_recipe = style.get("stac")
        xyz_url = style.get("xyz_url")
        if xyz_url:
            # A plain pre-rendered public XYZ tile service (e.g. JRC Global
            # Surface Water) — served straight from its own host, no
            # TiTiler/STAC involved at all. Different provider entirely from
            # the Planetary Computer "live" layers below, and not anchored
            # to any particular date the user can pick (it's a fixed
            # multi-decade 1984-2021 composite), so `date` is ignored here.
            tile_url = xyz_url
        elif stac_recipe:
            # Live layer: use a specific user-picked scene (item_id, from the
            # manual imagery search-and-select panel) if given, otherwise
            # auto-pick the least-cloudy scene the same way it always has —
            # either way we compute the hazard's band-math expression on the
            # fly (no stored COG for this layer — layer.raster_url stays null).
            if item_id:
                try:
                    item = stac_client.get_item_by_id(stac_recipe["collection"], item_id)
                except stac_client.NoScenesFoundError as exc:
                    raise HTTPException(status_code=404, detail=str(exc)) from exc
                except Exception as exc:  # noqa: BLE001
                    raise HTTPException(
                        status_code=502, detail=f"Could not fetch the selected scene: {exc}"
                    ) from exc
            else:
                try:
                    item, relaxed_search = stac_client.find_best_scene_with_fallback(
                        collection=stac_recipe["collection"],
                        bbox=stac_recipe.get("bbox"),
                        lookback_days=stac_recipe.get("lookback_days", 90),
                        max_cloud_cover=stac_recipe.get("max_cloud_cover", 20),
                        anchor_date=anchor_date,
                    )
                except stac_client.NoScenesFoundError as exc:
                    raise HTTPException(status_code=503, detail=str(exc)) from exc
                except Exception as exc:  # noqa: BLE001 — surface STAC/network errors plainly
                    raise HTTPException(
                        status_code=502, detail=f"Could not reach Planetary Computer: {exc}"
                    ) from exc

            item_json_url = stac_client.stac_item_json_url(
                str(request.base_url), stac_recipe["collection"], item.id
            )
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
    )
