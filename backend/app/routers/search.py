from fastapi import APIRouter, Query

from app.schemas import SearchResult

router = APIRouter(prefix="/search", tags=["search"])

# Starter gazetteer for Lagos State LGAs so search/zoom-to-administrative-area
# works out of the box. Swap for a proper geocoder (Nominatim self-hosted, or
# a boundaries table in PostGIS) once you're past the prototype stage.
_LGA_GAZETTEER = [
    {"label": "Lagos Island", "lat": 6.4550, "lon": 3.3947},
    {"label": "Eti-Osa (Lekki/Ikoyi/VI)", "lat": 6.4432, "lon": 3.4708},
    {"label": "Ikeja", "lat": 6.6018, "lon": 3.3515},
    {"label": "Apapa", "lat": 6.4432, "lon": 3.3592},
    {"label": "Badagry", "lat": 6.4149, "lon": 2.8811},
    {"label": "Epe", "lat": 6.5832, "lon": 3.9836},
    {"label": "Ikorodu", "lat": 6.6194, "lon": 3.5105},
    {"label": "Ajeromi-Ifelodun", "lat": 6.4552, "lon": 3.3313},
    {"label": "Surulere", "lat": 6.5027, "lon": 3.3541},
    {"label": "Amuwo-Odofin (Festac)", "lat": 6.4649, "lon": 3.2874},
]


@router.get("", response_model=list[SearchResult])
def search(q: str = Query(..., min_length=2)):
    q_lower = q.lower()
    matches = [row for row in _LGA_GAZETTEER if q_lower in row["label"].lower()]
    return [SearchResult(label=m["label"], type="administrative", lat=m["lat"], lon=m["lon"]) for m in matches]
