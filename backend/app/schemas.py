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
