from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel


class HazardThemeOut(BaseModel):
    id: str
    name: str
    description: str | None = None
    icon: str | None = None
    display_order: int = 0

    class Config:
        from_attributes = True


class ScenarioOut(BaseModel):
    id: str
    label: str
    time_period: str | None = None
    description: str | None = None

    class Config:
        from_attributes = True


class LayerOut(BaseModel):
    id: str
    hazard_theme_id: str
    scenario_id: str | None = None
    name: str
    layer_type: Literal["raster", "vector"]
    source: str | None = None
    date_published: datetime | None = None
    unit: str | None = None
    resolution: str | None = None
    methodology: str | None = None
    style: dict[str, Any] | None = None
    is_public: bool = True

    class Config:
        from_attributes = True


class LayerDetailOut(LayerOut):
    """Adds the resolved access URL the frontend should request:
    - raster layers: a TiTiler tile URL template
    - vector layers: the /features endpoint for this layer
    """
    tile_url: str | None = None
    features_url: str | None = None
    # Only set for layers computed live from Planetary Computer STAC imagery
    # (see hazard_recipes.py) — tells the frontend which actual scene it's
    # looking at, since "live" means a different date every time it's asked.
    observed_at: str | None = None
    cloud_cover: float | None = None
    # The resolved STAC item id behind observed_at (or the user's explicitly
    # pinned scene_id echoed back). The frontend passes this straight into
    # POST /analysis so that request re-fetches this exact item by id
    # (a single lightweight lookup) instead of re-running the same
    # collection/bbox/date-range search that just resolved it here —
    # avoiding a redundant round trip to the STAC API on every "Run
    # analysis" click, and guaranteeing the stats match the displayed scene.
    scene_id: str | None = None
    # True if the strict lookback/cloud-cover window from the recipe found
    # nothing and a much wider, unfiltered fallback search is what actually
    # produced this scene — Lagos's monsoon season makes that fairly common,
    # so the frontend surfaces this rather than silently showing a cloudier
    # scene as if it were a normal clean one.
    relaxed_search: bool = False


class STACItemOut(BaseModel):
    """One Planetary Computer STAC item, as returned by GET /imagery/search."""

    id: str
    collection: str
    datetime: str | None = None
    cloud_cover: float | None = None
    assets: dict[str, str]  # asset key -> already-signed href


class IdentifyResult(BaseModel):
    layer_id: str
    value: Any | None = None
    properties: dict[str, Any] | None = None
    unit: str | None = None
    risk_class: str | None = None


class AnalysisRequest(BaseModel):
    layer_id: str
    geometry: dict[str, Any]  # GeoJSON geometry for the area of interest
    operation: Literal["zonal_stats", "area_by_class"] = "zonal_stats"
    # Pin an exact scene (from GET /api/v1/imagery/search) instead of
    # auto-picking the most recent one — same as GET /layers/{id}?scene_id=.
    # No effect on vector layers or xyz-tile layers (see routers/analysis.py).
    scene_id: str | None = None


class SearchResult(BaseModel):
    label: str
    type: Literal["administrative", "asset", "location"]
    lat: float
    lon: float
    level: Literal["state", "lga", "ward"] | None = None
    code: str | None = None
    bbox: tuple[float, float, float, float] | None = None


class BoundaryLevelOut(BaseModel):
    level: Literal["state", "lga", "ward"]
    label: str
    parent_level: Literal["state", "lga", "ward"] | None = None
    feature_count: int


class BoundarySummaryOut(BaseModel):
    level: Literal["state", "lga", "ward"]
    code: str
    name: str
    parent_code: str | None = None
    parent_name: str | None = None
    centroid: tuple[float, float]  # (lon, lat)
    bbox: tuple[float, float, float, float]  # (min_lon, min_lat, max_lon, max_lat)


class ZonalStatsResult(BaseModel):
    layer_id: str
    operation: Literal["zonal_stats", "area_by_class"]
    feature_count: int
    area_km2: float
    by_class: dict[str, float] | None = None
    values: dict[str, float] | None = None
    # Which actual scene's date this result reflects, for live STAC layers
    # (the requested date and the scene actually found can differ — the
    # search picks the least-cloudy item in the window, not necessarily
    # exactly the requested day).
    observed_at: str | None = None
    relaxed_search: bool = False
