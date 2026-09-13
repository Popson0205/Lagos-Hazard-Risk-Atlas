from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/api/v1", tags=["misc"])


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/search")
def search(q: str):
    """Location / administrative-area / asset search.

    Plug in a Nominatim (self-hosted or public, rate-limited) lookup, or a
    PostGIS gazetteer table of Lagos LGAs/wards, keyed on this free-text q.
    """
    raise HTTPException(
        status_code=501,
        detail="Search not yet wired — plug in Nominatim or a PostGIS gazetteer table",
    )


@router.post("/analysis")
def analysis():
    """User-requested geoprocessing (zonal stats, buffer, overlay, etc.).

    Per the architecture doc this is where a Redis + worker queue belongs —
    long-running jobs shouldn't block the request/response cycle. Stubbed
    until the first real analysis use case is picked.
    """
    raise HTTPException(status_code=501, detail="Analysis jobs not yet implemented")
