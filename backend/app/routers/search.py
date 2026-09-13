from fastapi import APIRouter, Query

from app.schemas import SearchResult
from app.services import boundaries as boundaries_service

router = APIRouter(prefix="/search", tags=["search"])


@router.get("", response_model=list[SearchResult])
def search(q: str = Query(..., min_length=2), limit: int = Query(default=20, le=100)):
    """Search / zoom-to-administrative-area, backed by the real state / LGA /
    ward boundary datasets (see app/services/boundaries.py) rather than a
    hardcoded shortlist — covers the state, all 20 LGAs and all 394 wards."""
    q_lower = q.lower()
    matches = [f for f in boundaries_service.all_features_flat() if q_lower in f.name.lower()]

    # Surface higher administrative levels first (state, then LGA, then ward),
    # then alphabetically within a level.
    level_order = {"state": 0, "lga": 1, "ward": 2}
    matches.sort(key=lambda f: (level_order[f.level], f.name))

    results = []
    for f in matches[:limit]:
        label = f.name if f.level != "ward" else f"{f.name} ({f.parent_name} LGA)"
        results.append(
            SearchResult(
                label=label,
                type="administrative",
                lat=f.centroid[1],
                lon=f.centroid[0],
                level=f.level,
                code=f.code,
                bbox=f.bbox,
            )
        )
    return results
