from fastapi import APIRouter, HTTPException, Query

from ..schemas import ImagerySearchOut, STACItemOut
from ..services import stac_client

router = APIRouter(prefix="/api/v1/imagery", tags=["imagery"])


@router.get("/search", response_model=ImagerySearchOut)
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
    """Search Planetary Computer's open STAC catalogue for scenes over the AOI,
    for the manual browse-and-pick imagery panel — this is the 'open
    planetary' imagery source referenced in the architecture doc: free
    Sentinel-2/Landsat COGs, no API key required.

    If the requested date range/cloud-cover threshold turns up nothing, the
    search is automatically retried with a widened window and no cloud
    filter (see stac_client.search_imagery_with_fallback) rather than just
    returning an empty list — common in Lagos's monsoon season.
    """
    bbox_list = [float(v) for v in bbox.split(",")] if bbox else None
    try:
        items, relaxed_search, searched_start, searched_end = stac_client.search_imagery_with_fallback(
            bbox=bbox_list,
            collections=[collection],
            datetime_range=datetime_range,
            max_cloud_cover=max_cloud_cover,
            limit=limit,
        )
    except Exception as exc:  # noqa: BLE001 — surface STAC errors plainly to the client
        raise HTTPException(status_code=502, detail=f"STAC search failed: {exc}") from exc

    return ImagerySearchOut(
        items=[stac_client.item_to_dict(item) for item in items],
        relaxed_search=relaxed_search,
        searched_start=searched_start,
        searched_end=searched_end,
    )


@router.get("/item/{collection}/{item_id}.json")
def get_signed_item_json(collection: str, item_id: str):
    """Serve one Planetary Computer STAC item as signed STAC JSON.

    This exists for TiTiler to fetch, not for the frontend: TiTiler's
    /stac/tiles endpoint takes a `url` it can GET on its own, so instead of
    handing TiTiler an unsigned Planetary Computer item (whose asset hrefs
    need a short-lived SAS token) or re-signing on our side and trying to
    pass a giant signed item as a query param, we host the already-signed
    item here and give TiTiler *this* URL. See
    app/services/stac_client.stac_item_json_url / stac_tile_url and
    routers/layers.py's get_layer().
    """
    try:
        item = stac_client.get_item_by_id(collection, item_id)
    except stac_client.NoScenesFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Could not fetch STAC item: {exc}") from exc
    return item.to_dict()


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
