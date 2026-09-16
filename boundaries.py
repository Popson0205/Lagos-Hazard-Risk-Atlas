"""
Loads the three static admin-boundary GeoJSON files (state / LGA / ward,
sourced from OCHA COD-AB + the state's ward delimitation) and exposes them
through a small, level-agnostic API so routers don't need to know the raw
COD-AB field names (ADM1_EN, ADM2_PCODE, wardname, ...).

Files are read once per process and cached in memory — at ~1.2MB total this
is cheap, and it avoids a PostGIS round trip / migration just to serve
boundaries that never change at runtime. If these ever need to be edited by
users, promote them into a `boundaries` PostGIS table instead (same shape as
`hazard_features`) and swap the loader below for a query.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from shapely.geometry import shape

BoundaryLevel = Literal["state", "lga", "ward"]

DATA_DIR = Path(__file__).resolve().parents[2] / "data" / "boundaries"

_FILES: dict[BoundaryLevel, str] = {
    "state": "lagos_state.geojson",
    "lga": "lagos_lgas.geojson",
    "ward": "lagos_wards.geojson",
}

_LABELS: dict[BoundaryLevel, str] = {
    "state": "State",
    "lga": "Local Government Area",
    "ward": "Ward",
}

# Parent level for each level, used to filter e.g. wards by lga code.
_PARENT: dict[BoundaryLevel, BoundaryLevel | None] = {
    "state": None,
    "lga": "state",
    "ward": "lga",
}


@dataclass(frozen=True)
class NormalizedFeature:
    level: BoundaryLevel
    code: str
    name: str
    parent_code: str | None
    parent_name: str | None
    geometry: dict[str, Any]
    raw_properties: dict[str, Any]
    bbox: tuple[float, float, float, float]
    centroid: tuple[float, float]  # (lon, lat)

    def as_feature(self, include_raw: bool = False) -> dict[str, Any]:
        props: dict[str, Any] = {
            "level": self.level,
            "code": self.code,
            "name": self.name,
            "parent_code": self.parent_code,
            "parent_name": self.parent_name,
        }
        if include_raw:
            props["raw"] = self.raw_properties
        return {"type": "Feature", "geometry": self.geometry, "properties": props}


def _extract(level: BoundaryLevel, props: dict[str, Any]) -> tuple[str, str, str | None, str | None]:
    """Map each dataset's own field names onto (code, name, parent_code, parent_name)."""
    if level == "state":
        return props["ADM1_PCODE"], props["ADM1_EN"], props.get("ADM0_PCODE"), props.get("ADM0_EN")
    if level == "lga":
        return props["ADM2_PCODE"], props["ADM2_EN"], props.get("ADM1_PCODE"), props.get("ADM1_EN")
    # ward — handled separately in _load_all, since it needs the LGA code map
    # to line up with the LGA dataset (see note below).
    raise AssertionError("ward extraction is handled in _load_all")


def _to_normalized(level: BoundaryLevel, feat: dict[str, Any], code: str, name: str,
                    parent_code: str | None, parent_name: str | None) -> NormalizedFeature:
    geom = shape(feat["geometry"])
    minx, miny, maxx, maxy = geom.bounds
    centroid = geom.centroid
    return NormalizedFeature(
        level=level,
        code=str(code),
        name=str(name).strip(),
        parent_code=str(parent_code) if parent_code not in (None, "") else None,
        parent_name=str(parent_name).strip() if parent_name not in (None, "") else None,
        geometry=feat["geometry"],
        raw_properties=feat["properties"],
        bbox=(minx, miny, maxx, maxy),
        centroid=(centroid.x, centroid.y),
    )


@lru_cache(maxsize=1)
def _load_all() -> dict[BoundaryLevel, list[NormalizedFeature]]:
    result: dict[BoundaryLevel, list[NormalizedFeature]] = {}

    for level in ("state", "lga"):
        raw = json.loads((DATA_DIR / _FILES[level]).read_text())
        result[level] = [
            _to_normalized(level, feat, *_extract(level, feat["properties"]))
            for feat in raw["features"]
        ]

    # Wards need special handling: the source file (a state-level ward
    # delimitation exercise) includes ~17 border wards that actually belong
    # to neighbouring Ogun State, and its own `lgacode` field ('25001') uses
    # a different scheme than the LGA dataset's ADM2_PCODE ('NG025001') — the
    # LGA one is just the ward one prefixed with 'NG0'. We filter to Lagos
    # State only and rewrite parent_code/parent_name so ward -> LGA lookups
    # line up with the `lga` level loaded above.
    lga_name_by_code = {f.code: f.name for f in result["lga"]}
    raw_wards = json.loads((DATA_DIR / _FILES["ward"]).read_text())
    wards: list[NormalizedFeature] = []
    for feat in raw_wards["features"]:
        props = feat["properties"]
        if props.get("statename") != "Lagos":
            continue
        parent_code = f"NG0{props['lgacode']}"
        parent_name = lga_name_by_code.get(parent_code, props.get("lganame"))
        wards.append(_to_normalized("ward", feat, props["wardcode"], props["wardname"], parent_code, parent_name))
    result["ward"] = wards

    return result


def level_label(level: BoundaryLevel) -> str:
    return _LABELS[level]


def parent_level(level: BoundaryLevel) -> BoundaryLevel | None:
    return _PARENT[level]


def list_levels() -> list[dict[str, Any]]:
    all_data = _load_all()
    return [
        {
            "level": level,
            "label": _LABELS[level],
            "parent_level": _PARENT[level],
            "feature_count": len(features),
        }
        for level, features in all_data.items()
    ]


def get_features(
    level: BoundaryLevel,
    parent_code: str | None = None,
    q: str | None = None,
) -> list[NormalizedFeature]:
    features = _load_all()[level]
    if parent_code:
        features = [f for f in features if f.parent_code == parent_code]
    if q:
        q_lower = q.lower()
        features = [f for f in features if q_lower in f.name.lower()]
    return features


def get_feature(level: BoundaryLevel, code: str) -> NormalizedFeature | None:
    for f in _load_all()[level]:
        if f.code == code:
            return f
    return None


def all_features_flat() -> list[NormalizedFeature]:
    """Every boundary feature across all three levels — used by search."""
    all_data = _load_all()
    return [f for features in all_data.values() for f in features]
