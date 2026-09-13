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

from datetime import date

import planetary_computer
from pystac_client import Client

from app.config import get_settings

settings = get_settings()

_catalog: Client | None = None


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
