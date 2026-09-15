"""
Planetary Computer STAC integration.

This is the pipeline referenced in the architecture doc's data-sources layer:
it searches Microsoft's open STAC catalogue for candidate imagery (Sentinel-2
L2A, Sentinel-1 RTC, Copernicus DEM, ESA WorldCover, etc.) over the Lagos
State AOI, and signs the resulting asset URLs so they can be handed straight
to TiTiler for on-the-fly COG tiling — no need to download/store imagery for
a first pass.

Typical hazard <-> collection mapping (adjust as your methodology firms up):
  - Extreme heat / UHI        -> landsat-c2-l2 (thermal bands) or sentinel-3-slstr-lst
  - Coastal/riverine flooding -> sentinel-1-rtc (SAR, flood extent), cop-dem-glo-30 (elevation)
  - Land subsidence           -> sentinel-1-rtc (InSAR-ready) time series
  - Coastal erosion           -> sentinel-2-l2a time series (shoreline change)
  - Drought / water stress    -> sentinel-2-l2a (NDWI/NDVI), esa-worldcover
  - Landslides                -> cop-dem-glo-30 (slope), sentinel-2-l2a (land cover)
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from urllib.parse import urlencode

import planetary_computer
from pystac_client import Client

from app.config import get_settings

settings = get_settings()

_catalog: Client | None = None

# Lagos State roughly spans 2.7-4.3E, 6.35-6.7N (matches frontend/src/map/mapInit.ts).
LAGOS_BBOX: list[float] = [2.7, 6.35, 4.3, 6.7]


def get_catalog() -> Client:
    global _catalog
    if _catalog is None:
        _catalog = Client.open(
            settings.stac_api_url,
            modifier=planetary_computer.sign_inplace,
        )
    return _catalog


def search_scenes(
    collection: str,
    bbox: list[float],
    start: date,
    end: date,
    max_cloud_cover: int | None = 20,
    limit: int = 20,
) -> list[dict]:
    """Search a Planetary Computer collection over the given bbox/date range.

    bbox: [min_lon, min_lat, max_lon, max_lat] — for Lagos State, roughly
          [2.7, 6.35, 4.3, 6.7]
    Returns a list of lightweight dicts: id, datetime, cloud_cover, assets
    (asset key -> already-signed href), ready to feed to TiTiler or a
    processing job.
    """
    catalog = get_catalog()
    query = {}
    if max_cloud_cover is not None and collection in {"sentinel-2-l2a", "landsat-c2-l2"}:
        query["eo:cloud_cover"] = {"lt": max_cloud_cover}

    search = catalog.search(
        collections=[collection],
        bbox=bbox,
        datetime=f"{start.isoformat()}/{end.isoformat()}",
        query=query or None,
        limit=limit,
    )

    results = []
    for item in search.items():
        signed = planetary_computer.sign(item)
        results.append(
            {
                "id": signed.id,
                "datetime": str(signed.datetime),
                "cloud_cover": signed.properties.get("eo:cloud_cover"),
                "assets": {k: a.href for k, a in signed.assets.items()},
            }
        )
    return results


def titiler_tile_url(cog_url: str, colormap_name: str | None = None, rescale: str | None = None) -> str:
    """Build a TiTiler tile URL template for a given (already-signed) COG URL."""
    base = f"{settings.titiler_base_url}/cog/tiles/{{z}}/{{x}}/{{y}}.png?url={cog_url}"
    if colormap_name:
        base += f"&colormap_name={colormap_name}"
    if rescale:
        base += f"&rescale={rescale}"
    return base


def search_imagery(
    bbox: list[float] | None,
    collections: list[str],
    datetime_range: str | None = None,
    max_cloud_cover: float | None = 20.0,
    limit: int = 12,
) -> list:
    """Search one or more Planetary Computer collections for the raw imagery
    browser (GET /api/v1/imagery/search) — distinct from find_best_scene,
    which picks a single scene for a hazard recipe. This returns everything
    matching so the caller/frontend can list and choose."""
    catalog = get_catalog()
    query = {}
    if max_cloud_cover is not None and any(
        c in {"sentinel-2-l2a", "landsat-c2-l2"} for c in collections
    ):
        query["eo:cloud_cover"] = {"lt": max_cloud_cover}

    search = catalog.search(
        collections=collections,
        bbox=bbox or LAGOS_BBOX,
        datetime=datetime_range,
        query=query or None,
        limit=limit,
    )
    return list(search.items())


def item_to_dict(item) -> dict:
    """Flatten a signed pystac.Item down to the fields STACItemOut expects."""
    return {
        "id": item.id,
        "collection": item.collection_id,
        "datetime": str(item.datetime) if item.datetime else None,
        "cloud_cover": item.properties.get("eo:cloud_cover"),
        "assets": {k: a.href for k, a in item.assets.items()},
    }


def get_signed_asset_url(collection: str, item_id: str, asset: str) -> str:
    """A freshly-signed href for one asset of one item — assets are signed
    just-in-time here (rather than cached) because Planetary Computer SAS
    tokens are short-lived."""
    item = get_item_by_id(collection, item_id)
    if asset not in item.assets:
        raise KeyError(
            f"Asset '{asset}' not found on item '{item_id}' "
            f"(available: {sorted(item.assets)})"
        )
    return item.assets[asset].href


class NoScenesFoundError(RuntimeError):
    """Raised when no STAC item satisfies a hazard recipe's search criteria."""


def get_item_by_id(collection: str, item_id: str):
    """Fetch one STAC item by id, fully signed (the catalog is opened with
    ``modifier=planetary_computer.sign_inplace``, which pystac-client applies
    to every response — search results and direct item fetches alike)."""
    catalog = get_catalog()
    item = catalog.get_collection(collection).get_item(item_id)
    if item is None:
        raise NoScenesFoundError(f"Item '{item_id}' not found in collection '{collection}'")
    return item


def find_best_scene_with_fallback(
    collection: str,
    bbox: list[float] | None = None,
    lookback_days: int = 90,
    max_cloud_cover: int | None = 20,
    anchor_date: date | None = None,
) -> tuple["object", bool]:
    """find_best_scene, but if the configured window/cloud-cover threshold
    turns up nothing, automatically retries with a much wider window and no
    cloud filter before giving up. This matters specifically for Lagos:
    it's coastal and monsoon-influenced, so a strict 60-90 day / 20%
    cloud-cover search genuinely has no hits a lot of the time — that's not
    a rare unlucky window, it's the normal state for parts of the year, so
    failing hard there isn't useful.

    Returns (item, relaxed) — relaxed is True if the fallback search is what
    actually found something, so callers can tell the user the result isn't
    from as clean a scene as usual.
    """
    try:
        return find_best_scene(collection, bbox, lookback_days, max_cloud_cover, anchor_date), False
    except NoScenesFoundError:
        pass
    # Retry: 4x the window, no cloud-cover filter at all — take whatever's
    # least cloudy in that wider range rather than nothing.
    return find_best_scene(collection, bbox, lookback_days * 4, None, anchor_date), True


def find_best_scene(
    collection: str,
    bbox: list[float] | None = None,
    lookback_days: int = 90,
    max_cloud_cover: int | None = 20,
    anchor_date: date | None = None,
):
    """Find the least-cloudy scene over the AOI in the lookback_days window
    ending at anchor_date (defaults to today) — this is what backs each
    'live' hazard layer: instead of a pre-baked COG, we pick a Planetary
    Computer item each time a layer is resolved (see
    app/services/hazard_recipes.py and routers/layers.py).

    Passing anchor_date lets the caller ask "what did this look like around
    <some past date>" instead of always "what does this look like right
    now" — the historical-date picker in the frontend uses this to search
    any past window rather than only ever the most recent one.

    Returns the signed pystac.Item, or raises NoScenesFoundError if nothing
    in the lookback window meets the cloud-cover threshold (common for
    Lagos's cloudy season, or for a window before satellite coverage began —
    widen lookback_days or relax max_cloud_cover for those months).
    """
    catalog = get_catalog()
    end = anchor_date or datetime.utcnow().date()
    start = end - timedelta(days=lookback_days)

    query = {}
    if max_cloud_cover is not None and collection in {"sentinel-2-l2a", "landsat-c2-l2"}:
        query["eo:cloud_cover"] = {"lt": max_cloud_cover}

    search = catalog.search(
        collections=[collection],
        bbox=bbox or LAGOS_BBOX,
        datetime=f"{start.isoformat()}/{end.isoformat()}",
        query=query or None,
        limit=50,
    )
    items = list(search.items())
    if not items:
        window_desc = f"{start.isoformat()} to {end.isoformat()}"
        raise NoScenesFoundError(
            f"No '{collection}' scenes over Lagos between {window_desc} "
            f"under {max_cloud_cover}% cloud cover"
        )

    def cloud_cover(item):
        return item.properties.get("eo:cloud_cover", 100)

    items.sort(key=cloud_cover)
    return items[0]


def stac_item_json_url(request_base_url: str, collection: str, item_id: str) -> str:
    """The URL our own backend serves a signed STAC item at (see
    routers/imagery.py's /item/{collection}/{item_id}.json) — this is what we
    hand to TiTiler's /stac endpoint, since TiTiler needs a URL it can fetch
    itself, not a Python object. request_base_url should already end in '/'
    (FastAPI's Request.base_url does)."""
    return f"{request_base_url}api/v1/imagery/item/{collection}/{item_id}.json"


def stac_statistics_url(
    item_json_url: str, assets: list[str], expression: str | None = None, nodata: float | None = None
) -> tuple[str, list[tuple[str, str]]]:
    """URL + query params for TiTiler's POST /stac/statistics — same asset
    URL as stac_tile_url above, but for zonal stats over an AOI instead of a
    map tile. TiTiler expects the AOI as a GeoJSON Feature/FeatureCollection
    POST body (see routers/analysis.py), not a query param.

    Expressions must use rio-tiler's standard positional b1/b2/... band
    convention (matching the order `assets` are given in), not the literal
    asset name — rio-tiler's core expression parser treats any token
    matching b<digits> (case-insensitively) as a band index, which
    Sentinel-2's real asset names ("B03", "B08", ...) collide with: passing
    literal "B03" gets read as band index 3, not "the asset named B03",
    throwing "Invalid band/asset name 'b03'". b1/b2/... side-steps this
    entirely since it's the convention rio-tiler expects in the first place.

    `nodata` matters a lot here specifically: Landsat/Sentinel-2 fill pixels
    (cloud gaps, scene edges) are commonly 0 in the raw band, and without an
    explicit nodata value TiTiler can't tell those apart from real
    readings — they get counted as "valid" and run through the expression
    like everything else, producing a uniform, wrong result (e.g. LST's
    formula turns raw 0 into a bogus ~-124°C) rather than being excluded.
    """
    params: list[tuple[str, str]] = [("url", item_json_url)]
    for asset in assets:
        params.append(("assets", asset))
    if expression:
        params.append(("expression", expression))
    if nodata is not None:
        params.append(("nodata", str(nodata)))
    return f"{settings.titiler_base_url}/stac/statistics", params


def cog_statistics_url(raster_url: str) -> tuple[str, list[tuple[str, str]]]:
    """Same as stac_statistics_url, for a layer with a stored/static COG
    (layer.raster_url) rather than a live STAC recipe."""
    return f"{settings.titiler_base_url}/cog/statistics", [("url", raster_url)]


def stac_tile_url(
    item_json_url: str,
    assets: list[str],
    expression: str | None = None,
    rescale: str | None = None,
    colormap_name: str | None = None,
    nodata: float | None = None,
) -> str:
    """Build a TiTiler /stac/tiles URL template that reads one or more
    assets from a STAC item (via item_json_url) and optionally combines them
    with a band-math expression — this is how NDWI/NDVI-style two-band
    hazard layers get computed on the fly, without ever downloading or
    storing the source imagery ourselves.

    See stac_statistics_url's docstring on why expressions must use
    positional b1/b2/... band references rather than literal asset names,
    and why `nodata` needs to be passed explicitly.
    """
    params: list[tuple[str, str]] = [("url", item_json_url)]
    for asset in assets:
        params.append(("assets", asset))
    if expression:
        params.append(("expression", expression))
    if rescale:
        params.append(("rescale", rescale))
    if colormap_name:
        params.append(("colormap_name", colormap_name))
    if nodata is not None:
        params.append(("nodata", str(nodata)))
    query = urlencode(params, safe="{}/:")
    # WebMercatorQuad is the standard tile grid Leaflet itself uses — this
    # {tileMatrixSetId} path segment is required by TiTiler's router; its
    # absence (my earlier mistake) is exactly why every tile request 404'd
    # while /stac/statistics (no TMS in its path at all) worked fine.
    return f"{settings.titiler_base_url}/stac/tiles/WebMercatorQuad/{{z}}/{{x}}/{{y}}.png?{query}"
