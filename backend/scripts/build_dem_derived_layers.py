#!/usr/bin/env python3
"""
Builds two DEM-derived rasters for Lagos State from the public Copernicus
DEM GLO-30 dataset (via Earth Search's STAC API, AWS Open Data — the same
source already used for the live Sentinel/Landsat hazard layers; see
backend/app/services/stac_client.py):

  1. landslides_lagos_dem_relief.tif
     A plain elevation mosaic. Lagos is almost entirely flat, so this is
     mostly a landslide-susceptibility *context* layer — it documents why
     risk here is low — not a slope/curvature-based susceptibility model.

  2. pluvial_flooding_relative_lowland_index.tif
     Elevation minus the local mean elevation in a ~1km window: how much
     lower/higher each pixel sits than its immediate surroundings.
     Negative = local basin/depression — a first-pass proxy for where
     rainfall tends to pond during flash/pluvial flooding, independent of
     the coastal/riverine themes covered elsewhere in this catalogue.

Why this is an offline script rather than another live TiTiler/STAC recipe
like extreme_heat / coastal_flooding / drought_water_stress: those three
are each backed by ONE Sentinel-2 or Landsat scene that already covers
most or all of Lagos. Copernicus DEM on Earth Search is tiled 1°x1° per
STAC item — several tiles are needed to cover Lagos State's roughly
1.6° x 0.35° extent — and TiTiler's /stac/tiles endpoint reads a single
STAC item, not a mosaic of several. So instead of trying to mosaic on the
fly per map tile, this fetches each DEM tile once and mosaics them into
one COG per output. You then host the two resulting files anywhere
publicly reachable over HTTPS (Supabase Storage, an S3 bucket, etc.) and
point the catalogue at them — the same "fetch real data offline, wire it
in by hand" pattern as fetch_osm_coastline.py, needed here for the same
reason: this sandbox/CI environment's network egress doesn't reach AWS
Open Data or arbitrary public hosting, only your own deployment's does.

Requires packages NOT in the deployed backend's requirements.txt (only
this one-off script needs them) — install with:
    pip install -r backend/scripts/requirements.txt

Usage:
    python3 build_dem_derived_layers.py
Writes, into the current directory:
    landslides_lagos_dem_relief.tif
    pluvial_flooding_relative_lowland_index.tif
then prints the remaining manual steps (COG-ify, host, wire into the
catalogue).
"""
from __future__ import annotations

import os
import sys

# Copernicus DEM on Earth Search is a public, unsigned S3 bucket — this
# just avoids GDAL trying (and failing) to sign requests with no
# credentials configured.
os.environ.setdefault("AWS_NO_SIGN_REQUEST", "YES")

import numpy as np  # noqa: E402
import rasterio  # noqa: E402
from rasterio.merge import merge  # noqa: E402
from pystac_client import Client  # noqa: E402
from scipy.ndimage import uniform_filter  # noqa: E402

STAC_API_URL = "https://earth-search.aws.element84.com/v1"
COLLECTION = "cop-dem-glo-30"
ASSET = "data"

# Same Lagos State bbox as backend/app/services/stac_client.LAGOS_BBOX —
# keep these in sync if that one ever changes.
LAGOS_BBOX = (2.7, 6.35, 4.3, 6.7)  # min_lon, min_lat, max_lon, max_lat

ELEVATION_OUT = "landslides_lagos_dem_relief.tif"
RELIEF_OUT = "pluvial_flooding_relative_lowland_index.tif"

# ~1km window at Copernicus DEM's native 30m/pixel.
RELIEF_WINDOW_PX = 33

NODATA = -9999.0


def find_dem_tile_urls() -> list[str]:
    """Every cop-dem-glo-30 STAC item intersecting the Lagos bbox — each is
    one 1°x1° tile, so this is typically 2-4 items for Lagos State."""
    catalog = Client.open(STAC_API_URL)
    search = catalog.search(collections=[COLLECTION], bbox=list(LAGOS_BBOX), limit=100)
    items = list(search.items())
    if not items:
        print("No cop-dem-glo-30 tiles found over the Lagos bbox — aborting.", file=sys.stderr)
        sys.exit(1)
    urls = [item.assets[ASSET].href for item in items]
    print(f"Found {len(urls)} DEM tile(s) covering Lagos State:", file=sys.stderr)
    for u in urls:
        print(f"  {u}", file=sys.stderr)
    return urls


def mosaic_and_clip(urls: list[str]) -> tuple[np.ndarray, dict]:
    """Open every tile directly over HTTPS (GDAL's /vsicurl/ range
    requests — no full download needed) and mosaic + clip to the Lagos
    bbox in one pass."""
    datasets = [rasterio.open(url) for url in urls]
    try:
        mosaic, transform = merge(datasets, bounds=LAGOS_BBOX)
    finally:
        for ds in datasets:
            ds.close()

    profile = {
        "driver": "GTiff",
        "dtype": "float32",
        "count": 1,
        "height": mosaic.shape[1],
        "width": mosaic.shape[2],
        "crs": "EPSG:4326",
        "transform": transform,
        "nodata": NODATA,
        "compress": "deflate",
        "tiled": True,
        "blockxsize": 256,
        "blockysize": 256,
    }
    elevation = mosaic[0].astype("float32")
    return elevation, profile


def write_geotiff(path: str, array: np.ndarray, profile: dict) -> None:
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(array, 1)
    print(f"Wrote {path}", file=sys.stderr)


def main() -> None:
    urls = find_dem_tile_urls()
    elevation, profile = mosaic_and_clip(urls)

    write_geotiff(ELEVATION_OUT, elevation, profile)

    # Local relief: elevation minus the mean elevation in a ~1km window.
    # Negative = sits lower than its surroundings (a basin/depression);
    # positive = sits higher (better-drained relative to its neighbourhood).
    # nodata pixels would otherwise corrupt the moving average, so they're
    # excluded from the window mean rather than treated as elevation 0.
    valid = elevation != profile["nodata"]
    filled = np.where(valid, elevation, 0.0)
    local_sum = uniform_filter(filled, size=RELIEF_WINDOW_PX, mode="nearest")
    local_count = uniform_filter(valid.astype("float32"), size=RELIEF_WINDOW_PX, mode="nearest")
    with np.errstate(invalid="ignore", divide="ignore"):
        local_mean = np.where(local_count > 0, local_sum / local_count, profile["nodata"])
    relief = np.where(valid, elevation - local_mean, profile["nodata"]).astype("float32")

    write_geotiff(RELIEF_OUT, relief, profile)

    print(
        "\nDone. Remaining steps:\n"
        "  1. (Recommended) Convert both to proper Cloud-Optimized GeoTIFFs\n"
        "     with rio-cogeo, e.g.:\n"
        f"       pip install rio-cogeo\n"
        f"       rio cogeo create {ELEVATION_OUT} {ELEVATION_OUT.replace('.tif', '_cog.tif')}\n"
        f"       rio cogeo create {RELIEF_OUT} {RELIEF_OUT.replace('.tif', '_cog.tif')}\n"
        "  2. Upload both COGs somewhere publicly reachable over HTTPS\n"
        "     (Supabase Storage, a public S3 bucket, etc.) — TiTiler needs a\n"
        "     URL it can fetch itself, exactly like raster_url already works\n"
        "     for any other non-live layer in this catalogue.\n"
        "  3. Point the catalogue at the hosted URLs and publish them:\n"
        "       UPDATE layers SET raster_url = '<hosted COG URL>', is_public = TRUE\n"
        "         WHERE id = 'landslides_lagos_dem_relief';\n"
        "       UPDATE layers SET raster_url = '<hosted COG URL>', is_public = TRUE\n"
        "         WHERE id = 'pluvial_flooding_relative_lowland_index';\n"
        "     (also update the raster_url values in\n"
        "     data/catalogue/hazard_layers.json so the two stay in sync, per\n"
        "     the note at the top of db_init_correct.sql).\n",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
