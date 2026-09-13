from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models import Layer
from app.schemas import LayerOut, LayerDetailOut
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
def get_layer(layer_id: str, db: Session = Depends(get_db)):
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
    if layer.layer_type == "raster" and layer.raster_url:
        colormap = (layer.style or {}).get("colormap_name")
        rescale = (layer.style or {}).get("rescale")
        tile_url = titiler_tile_url(layer.raster_url, colormap, rescale)
    elif layer.layer_type == "vector":
        features_url = f"{settings.api_v1_prefix}/layers/{layer.id}/features"

    return LayerDetailOut(
        **LayerOut.model_validate(layer).model_dump(),
        tile_url=tile_url,
        features_url=features_url,
    )
