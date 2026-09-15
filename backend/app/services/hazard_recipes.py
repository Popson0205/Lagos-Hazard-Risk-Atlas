"""
Hazard theme -> Planetary Computer STAC recipe.

Each recipe describes how to turn open Planetary Computer imagery into a
live raster tile for one hazard theme, entirely on the fly:

  1. Search `collection` for the least-cloudy scene over Lagos in the last
     `lookback_days` (app/services/stac_client.find_best_scene).
  2. Hand the signed item + `assets` + `expression` to TiTiler's /stac/tiles
     endpoint (app/services/stac_client.stac_tile_url), which reads the
     bands and computes the expression per-tile, on demand.

No imagery is downloaded or stored — this is the "no imagery needs to be
downloaded/stored" pipeline described in README.md's "Imagery source"
section, now actually wired to the hazard selector instead of sitting
behind the separate /api/v1/imagery/search endpoint.

This is intentionally a *starting point*, not a finished set of validated
hazard models:
  - extreme_heat and coastal_flooding below use well-established, simple
    band math (thermal band -> LST, NDWI -> water extent) and are safe to
    treat as real first-pass layers.
  - Everything else needs either a genuine hazard model (flood depth from
    DEM + rainfall, InSAR time series for subsidence, slope + rainfall for
    landslides) or the client's own data, per README.md's "what's next"
    section — leave those hazard themes without an entry here until that
    modeling work happens, rather than shipping a misleading raw-imagery
    proxy as if it were a validated hazard product.

To add a theme: add a key here, then add a matching entry to
data/catalogue/hazard_layers.json with "raster_url": null and
"style": {"stac": {<this recipe>}, ...any existing legend config}. See
routers/layers.py's get_layer() for how the two are combined.
"""

HAZARD_RECIPES: dict[str, dict] = {
    "extreme_heat": {
        "collection": "landsat-c2-l2",
        # Single thermal band: Landsat Collection 2 Level-2 surface
        # temperature, stored as scaled digital numbers in Kelvin.
        # Official scale/offset (USGS LSDS-1619): DN * 0.00341802 + 149.0.
        "assets": ["lwir11"],
        # rio-tiler's MultiBaseReader (used for STACReader/`/stac/tiles`)
        # always renames merged asset bands positionally to b1, b2, ... in
        # the order `assets` is given — it does NOT keep the literal asset
        # name. b1 here == the single "lwir11" asset. See
        # stac_client.stac_statistics_url's docstring for the full
        # explanation (same reason B03/B08/B04 below are b1/b2, not the
        # literal band names).
        "expression": "b1*0.00341802+149.0-273.15",  # -> degrees Celsius
        "rescale": "20,45",
        "colormap_name": "inferno",
        "max_cloud_cover": 20,
        "lookback_days": 90,
    },
    "coastal_flooding": {
        "collection": "sentinel-2-l2a",
        # NDWI (McFeeters): (Green - NIR) / (Green + NIR). Positive values
        # are open water / saturated ground — a reasonable proxy for
        # current flood/inundation extent, not a forecast or return-period
        # flood risk map.
        "assets": ["B03", "B08"],
        # b1 = B03 (Green), b2 = B08 (NIR) — positional, not literal asset
        # names (see extreme_heat's comment above).
        "expression": "(b1-b2)/(b1+b2)",
        "rescale": "-1,1",
        "colormap_name": "rdbu",
        "max_cloud_cover": 20,
        "lookback_days": 60,
    },
    "drought_water_stress": {
        "collection": "sentinel-2-l2a",
        # NDVI: (NIR - Red) / (NIR + Red) — vegetation vigor/greenness, a
        # standard drought/water-stress proxy at this resolution.
        "assets": ["B08", "B04"],
        # b1 = B08 (NIR), b2 = B04 (Red) — positional, not literal asset
        # names (see extreme_heat's comment above).
        "expression": "(b1-b2)/(b1+b2)",
        "rescale": "-1,1",
        "colormap_name": "rdylgn",
        "max_cloud_cover": 20,
        "lookback_days": 60,
    },
}
