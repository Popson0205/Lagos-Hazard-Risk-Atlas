from fastapi import APIRouter, HTTPException, Query

from ..schemas import STACItemOut
from ..services import stac_client

router = APIRouter(prefix="/api/v1/imagery", tags=["imagery"])


@router.get("/search", response_model=list[STACItemOut])
def search_imagery(
    bbox: str | None = Query(
        None, description="minlon,minlat,maxlon,maxlat — defaults to Lagos State"
    ),
    collection: str = Query("sentinel-2-l2a", description="STAC collection id"),
    datetime_range: str | None = Query(
        None, alias="datetime", description="ISO8601 interval, e.g. 2025-01-01/2025-12-31"
    ),
    max_cloud_cover: float = Query(20.0, ge=0, le=100),
    limit: int = Query(12, le=50),
):
    """Search Planetary Computer's open STAC catalogue for scenes over the AOI.

    This is the 'open planetary' imagery source referenced in the
    architecture doc — free Sentinel-2/Landsat COGs, no API key required.
    """
    bbox_list = [float(v) for v in bbox.split(",")] if bbox else None
    try:
        items = stac_client.search_imagery(
            bbox=bbox_list,
            collections=[collection],
            datetime_range=datetime_range,
            max_cloud_cover=max_cloud_cover,
            limit=limit,
        )
    except Exception as exc:  # noqa: BLE001 — surface STAC errors plainly to the client
        raise HTTPException(status_code=502, detail=f"STAC search failed: {exc}") from exc

    return [stac_client.item_to_dict(item) for item in items]


@router.get("/{collection}/{item_id}/asset-url")
def get_asset_url(collection: str, item_id: str, asset: str = Query("visual")):
    """Return a freshly-signed COG URL for one STAC asset, e.g. to hand to
    TiTiler's /cog/tiles endpoint or a rasterio read. Sign just-in-time —
    Planetary Computer SAS tokens are short-lived.
    """
    try:
        url = stac_client.get_signed_asset_url(collection, item_id, asset)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Could not sign asset: {exc}") from exc
    return {"url": url}
