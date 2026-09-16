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
  - extreme_heat, coastal_flooding and drought_water_stress below use
    well-established, simple band math (thermal band -> LST, NDWI -> water
    extent, NDVI -> vegetation stress) computed live from a single Sentinel/
    Landsat scene that already covers Lagos — safe to treat as real
    first-pass layers.
  - riverine_flooding (JRC Global Surface Water "seasonality" tiles) and
    coastal_erosion's second layer (JRC "change" tiles) are real multi-
    decade satellite products too, but pre-rendered by JRC/Google, not a
    STAC recipe at all — see data/catalogue/hazard_layers.json directly.
  - landslides and pluvial_flooding are now backed by Copernicus DEM
    (cop-dem-glo-30), but NOT as a live STAC recipe here: DEM items on
    Earth Search are 1°x1° tiles, too small for a single scene to cover
    Lagos the way Sentinel/Landsat do, so they're mosaicked offline once
    by backend/scripts/build_dem_derived_layers.py and served as a plain
    hosted COG (raster_url) instead — see that script and the catalogue
    entries for landslides_lagos_dem_relief and
    pluvial_flooding_relative_lowland_index.
  - land_subsidence and compound_flooding still need either a genuine
    hazard model (InSAR time series for subsidence; a real composite of
    the other flood drivers for compound flooding) or the client's own
    data, per README.md's "what's next" section — left without an entry
    anywhere in the catalogue until that modeling work happens, rather
    than shipping a misleading proxy as if it were a validated hazard
    product.

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
        "expression": "lwir11*0.00341802+149.0-273.15",  # -> degrees Celsius
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
        "expression": "(B03-B08)/(B03+B08)",
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
        "expression": "(B08-B04)/(B08+B04)",
        "rescale": "-1,1",
        "colormap_name": "rdylgn",
        "max_cloud_cover": 20,
        "lookback_days": 60,
    },
}
