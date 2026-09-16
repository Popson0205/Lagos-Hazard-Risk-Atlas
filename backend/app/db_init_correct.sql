-- Lagos Risk Atlas — corrected catalogue schema.
--
-- The original db_init.sql was written against a different, older schema
-- than the one the app's SQLAlchemy models (app/models.py) actually use —
-- it creates tables named `hazards` with columns like `sort_order`, while
-- the app queries a table named `hazard_themes` with a column called
-- `display_order`, and so on. That mismatch is what produced:
--   psycopg.errors.UndefinedTable: relation "hazard_themes" does not exist
--
-- This file matches app/models.py exactly and seeds the same data as
-- app/seed.py (python -m app.seed), for use when you can't run that script
-- directly (e.g. no shell access on Render's free tier). Paste this whole
-- file into Supabase's SQL Editor and run it once.
--
-- If you already ran the old db_init.sql against this database, drop its
-- wrongly-shaped tables first (safe — they were never used by the app):
--   DROP TABLE IF EXISTS hazard_features, layers, scenarios, hazards CASCADE;

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS hazard_themes (
    id             VARCHAR(64) PRIMARY KEY,
    name           VARCHAR(128) NOT NULL,
    description    TEXT,
    icon           VARCHAR(128),
    display_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS scenarios (
    id           VARCHAR(64) PRIMARY KEY,
    label        VARCHAR(128) NOT NULL,
    time_period  VARCHAR(64),
    description  TEXT
);

CREATE TABLE IF NOT EXISTS layers (
    id               VARCHAR(128) PRIMARY KEY,
    hazard_theme_id  VARCHAR(64) NOT NULL REFERENCES hazard_themes(id),
    scenario_id      VARCHAR(64) REFERENCES scenarios(id),
    name             VARCHAR(256) NOT NULL,
    layer_type       VARCHAR(16) NOT NULL,   -- 'raster' | 'vector'
    source           VARCHAR(256),
    date_published   TIMESTAMP,
    unit             VARCHAR(64),
    resolution       VARCHAR(64),
    methodology      TEXT,
    raster_url       TEXT,
    style            JSONB,
    is_public        BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS hazard_features (
    id          SERIAL PRIMARY KEY,
    layer_id    VARCHAR(128) NOT NULL REFERENCES layers(id),
    properties  JSONB NOT NULL DEFAULT '{}'::jsonb,
    geom        GEOMETRY(Geometry, 4326)
);

CREATE INDEX IF NOT EXISTS idx_hazard_features_geom ON hazard_features USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_hazard_features_layer ON hazard_features (layer_id);

-- Seed: nine hazard themes (matches app/seed.py's HAZARD_THEMES)
INSERT INTO hazard_themes (id, name, display_order) VALUES
    ('coastal_flooding',      'Coastal Flooding & Storm Surge',     1),
    ('pluvial_flooding',      'Pluvial & Flash Flooding',           2),
    ('riverine_flooding',     'Riverine & Lagoon Flooding',         3),
    ('compound_flooding',     'Compound Flooding',                  4),
    ('land_subsidence',       'Land Subsidence',                    5),
    ('extreme_heat',          'Extreme Heat / Urban Heat Island',   6),
    ('coastal_erosion',       'Coastal Erosion',                    7),
    ('drought_water_stress',  'Drought / Water Stress / Quality',   8),
    ('landslides',            'Landslides / Mudslides',             9)
ON CONFLICT (id) DO NOTHING;

-- Seed: scenarios (matches app/seed.py's SCENARIOS)
INSERT INTO scenarios (id, label, time_period) VALUES
    ('baseline',        'Current / Baseline',           'present'),
    ('2050_moderate',   '2050 — Moderate Emissions',     '2050'),
    ('2050_high',       '2050 — High Emissions',         '2050'),
    ('2080_high',       '2080 — High Emissions',         '2080')
ON CONFLICT (id) DO NOTHING;

-- Seed: layer catalogue (matches data/catalogue/hazard_layers.json)
INSERT INTO layers (id, hazard_theme_id, scenario_id, name, layer_type, source, unit, resolution, methodology, raster_url, style, is_public)
VALUES ('extreme_heat_lst_baseline', 'extreme_heat', 'baseline', 'Land Surface Temperature (Baseline)', 'raster', 'Landsat Collection 2 Level-2 (via Earth Search / AWS Open Data)', 'C', '30m', 'LST derived from Landsat thermal band, atmospherically corrected surface temperature product. Computed live per request from the least-cloudy Landsat scene over Lagos in the last 90 days (see backend/app/services/hazard_recipes.py) — not a fixed historical baseline.', NULL, '{"colormap_name": "inferno", "rescale": "20,45", "stac": {"collection": "landsat-c2-l2", "assets": ["lwir11"], "expression": "b1*0.00341802+149.0-273.15", "rescale": "20,45", "colormap_name": "inferno", "max_cloud_cover": 20, "lookback_days": 90, "nodata": 0}}'::jsonb, TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO layers (id, hazard_theme_id, scenario_id, name, layer_type, source, unit, resolution, methodology, raster_url, style, is_public)
VALUES ('coastal_flooding_water_extent_live', 'coastal_flooding', 'baseline', 'Current Water Extent (Live, NDWI)', 'raster', 'Sentinel-2 L2A NDWI (via Earth Search / AWS Open Data)', 'NDWI', '10m', 'NDWI = (Green - NIR) / (Green + NIR), computed live from the least-cloudy Sentinel-2 scene over Lagos in the last 60 days. This is a current inundation/water-extent proxy, not a flood-risk or return-period model — see backend/app/services/hazard_recipes.py.', NULL, '{"colormap_name": "rdbu", "rescale": "-1,1", "stac": {"collection": "sentinel-2-l2a", "assets": ["green", "nir"], "expression": "(b1-b2)/(b1+b2)", "rescale": "-1,1", "colormap_name": "rdbu", "max_cloud_cover": 20, "lookback_days": 60, "nodata": 0}}'::jsonb, TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO layers (id, hazard_theme_id, scenario_id, name, layer_type, source, unit, resolution, methodology, raster_url, style, is_public)
VALUES ('drought_water_stress_ndvi_live', 'drought_water_stress', 'baseline', 'Vegetation Stress (Live, NDVI)', 'raster', 'Sentinel-2 L2A NDVI (via Earth Search / AWS Open Data)', 'NDVI', '10m', 'NDVI = (NIR - Red) / (NIR + Red), computed live from the least-cloudy Sentinel-2 scene over Lagos in the last 60 days — a standard vegetation-vigor proxy for drought/water stress, not a validated drought index.', NULL, '{"colormap_name": "rdylgn", "rescale": "-1,1", "stac": {"collection": "sentinel-2-l2a", "assets": ["nir", "red"], "expression": "(b1-b2)/(b1+b2)", "rescale": "-1,1", "colormap_name": "rdylgn", "max_cloud_cover": 20, "lookback_days": 60, "nodata": 0}}'::jsonb, TRUE)
ON CONFLICT (id) DO NOTHING;

-- The original coastal_erosion_shoreline_baseline entry (a described-but-
-- never-implemented NDWI/DSAS pipeline, with zero rows in hazard_features)
-- has been replaced by two genuinely real data sources: OpenStreetMap's
-- current coastline, and JRC's actual multi-decade water-change product.
DELETE FROM hazard_features WHERE layer_id = 'coastal_erosion_shoreline_baseline';
DELETE FROM layers WHERE id = 'coastal_erosion_shoreline_baseline';

INSERT INTO layers (id, hazard_theme_id, scenario_id, name, layer_type, source, unit, resolution, methodology, raster_url, style, is_public)
VALUES ('coastal_erosion_osm_coastline', 'coastal_erosion', 'baseline', 'Coastline (OpenStreetMap, current)', 'vector', 'OpenStreetMap contributors, via the Overpass API (ODbL — https://www.openstreetmap.org/copyright)', NULL, NULL, 'The current mapped coastline (natural=coastline ways) from OpenStreetMap — a real, community-mapped snapshot of shoreline position, not a computed erosion rate. On its own this shows where the coast is today; combine it with the JRC Global Surface Water Change layer below to see how it has actually moved. Ingested via backend/scripts/fetch_osm_coastline.py — re-run periodically to refresh, since OSM coastline edits happen continuously.', NULL, '{"line_color": "#38bdf8", "line_weight": 2}'::jsonb, TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO layers (id, hazard_theme_id, scenario_id, name, layer_type, source, unit, resolution, methodology, raster_url, style, is_public)
VALUES ('coastal_erosion_jrc_gsw_change', 'coastal_erosion', 'baseline', 'Land/Water Change, 1984–2021 (JRC Global Surface Water)', 'raster', 'EC Joint Research Centre / Google — Global Surface Water Explorer v1.4 (Pekel et al. 2016, Nature, doi:10.1038/nature20584). Attribution required: ''Source: EC JRC/Google''.', NULL, '30m (Landsat, 1984–2021 composite)', 'Pre-rendered reference tiles from JRC''s Global Surface Water ''change'' layer: blue = permanent water gain (land lost to the sea — an erosion signal), red = permanent water loss (land gained/reclaimed — an accretion signal), over the full 1984–2021 Landsat archive. This is a genuine multi-decade change product (unlike the single-scene ''live'' layers elsewhere in this catalogue), served directly from Google Cloud Storage as pre-styled PNG tiles — not routed through TiTiler/STAC, and not stats-capable (the source is styled imagery, not raw pixel values), so ''Run analysis'' on this layer returns an explanation rather than numbers. Tiles are undefined above zoom 13.', NULL, '{"xyz_url": "https://storage.googleapis.com/global-surface-water/tiles2021/change/{z}/{x}/{y}.png", "max_native_zoom": 13, "breaks": ["Water gain (erosion signal)", "Water loss (accretion signal)"], "colors": ["#3b82f6", "#dc2626"]}'::jsonb, TRUE)
ON CONFLICT (id) DO NOTHING;

-- riverine_flooding: JRC Global Surface Water 'seasonality' tiles (same
-- pre-styled-PNG, no-TiTiler pattern as coastal_erosion_jrc_gsw_change
-- above). Ready to publish now — no script/upload needed.
INSERT INTO layers (id, hazard_theme_id, scenario_id, name, layer_type, source, unit, resolution, methodology, raster_url, style, is_public)
VALUES ('riverine_flooding_jrc_gsw_seasonality', 'riverine_flooding', 'baseline', 'Surface Water Seasonality, 2021 (JRC Global Surface Water)', 'raster', 'EC Joint Research Centre / Google — Global Surface Water Explorer v1.4 (Pekel et al. 2016, Nature, doi:10.1038/nature20584). Attribution required: ''Source: EC JRC/Google''.', NULL, '30m (Landsat, 2021 composite)', 'Pre-rendered reference tiles from JRC''s Global Surface Water ''seasonality'' layer: for each pixel, how many months of the year (0–12) it was classified as water in 2021. Land that''s water only part of the year — along the lagoon fringe and river channels — is a reasonable proxy for land regularly inundated by riverine/lagoon flooding, distinct from permanent open water shown elsewhere. This is real observed satellite data for a single reference year, not a return-period flood model. Served directly from Google Cloud Storage as pre-styled PNG tiles — not routed through TiTiler/STAC, and not stats-capable (the source is styled imagery, not raw pixel values), so ''Run analysis'' on this layer returns an explanation rather than numbers. Tiles are undefined above zoom 13.', NULL, '{"xyz_url": "https://storage.googleapis.com/global-surface-water/tiles2021/seasonality/{z}/{x}/{y}.png", "max_native_zoom": 13, "breaks": ["Never water (0 months/yr)", "Seasonal water (1–11 months/yr)", "Permanent water (12 months/yr)"], "colors": ["#f0f9ff", "#38bdf8", "#0c4a6e"]}'::jsonb, TRUE)
ON CONFLICT (id) DO NOTHING;

-- landslides + pluvial_flooding: both derived from Copernicus DEM GLO-30,
-- mosaicked offline by backend/scripts/build_dem_derived_layers.py (DEM
-- STAC items are 1°x1° tiles — too small to serve live the way a single
-- Sentinel/Landsat scene covers Lagos for the themes above). Inserted here
-- as NOT YET PUBLIC (is_public = FALSE, raster_url = NULL) — after running
-- the script and hosting the two output COGs somewhere public, run:
--   UPDATE layers SET raster_url = '<hosted COG URL>', is_public = TRUE
--   WHERE id = 'landslides_lagos_dem_relief';
--   UPDATE layers SET raster_url = '<hosted COG URL>', is_public = TRUE
--   WHERE id = 'pluvial_flooding_relative_lowland_index';
INSERT INTO layers (id, hazard_theme_id, scenario_id, name, layer_type, source, unit, resolution, methodology, raster_url, style, is_public)
VALUES ('landslides_lagos_dem_relief', 'landslides', 'baseline', 'Elevation / Terrain Relief (Copernicus DEM)', 'raster', 'Copernicus DEM GLO-30 (ESA/Airbus, via Earth Search / AWS Open Data), mosaicked offline', 'm', '30m', 'PENDING — not yet public. Elevation mosaic over Lagos State from Copernicus GLO-30 DEM, built offline by backend/scripts/build_dem_derived_layers.py rather than served live: the DEM''s STAC items are individual 1°x1° tiles (too small to cover Lagos State the way a single Sentinel/Landsat scene does), so several tiles are fetched once and mosaicked into one COG instead of a live per-tile TiTiler request. This shows raw elevation, not slope or a validated landslide-susceptibility model — but it''s informative on its own: Lagos is an almost entirely flat coastal/lagoon plain (well under ~60m everywhere), which is exactly why landslide risk here is minimal. Run the script, host the resulting COG somewhere public, then set raster_url and flip is_public to true.', NULL, '{"colormap_name": "terrain", "rescale": "0,60"}'::jsonb, FALSE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO layers (id, hazard_theme_id, scenario_id, name, layer_type, source, unit, resolution, methodology, raster_url, style, is_public)
VALUES ('pluvial_flooding_relative_lowland_index', 'pluvial_flooding', 'baseline', 'Relative Low-Lying Terrain Index (Pluvial Ponding Proxy)', 'raster', 'Derived from Copernicus DEM GLO-30 (ESA/Airbus, via Earth Search / AWS Open Data), computed offline', 'm (relative to local surroundings)', '30m', 'PENDING — not yet public. For every pixel, elevation minus the mean elevation within a ~1km moving window (backend/scripts/build_dem_derived_layers.py) — negative values sit lower than their immediate surroundings (a local basin/depression), the kind of poorly-draining terrain where rainfall tends to pond during flash/pluvial flooding, independent of distance to the coast or a river (which the coastal_flooding and riverine_flooding themes already cover). This is a first-pass topographic susceptibility proxy, not a hydrologically-correct HAND (height-above-nearest-drainage) or flow-routed model, and it says nothing about drainage infrastructure or actual rainfall — a genuine pluvial flood-depth model needs DEM + rainfall + drainage-network routing. Run the script, host the resulting COG somewhere public, then set raster_url and flip is_public to true.', NULL, '{"colormap_name": "coolwarm", "rescale": "-5,5"}'::jsonb, FALSE)
ON CONFLICT (id) DO NOTHING;

-- Real coastline geometry for coastal_erosion_osm_coastline comes from
-- backend/scripts/fetch_osm_coastline.py, which fetches it fresh from
-- OpenStreetMap and prints ready-to-run SQL — run it and paste that
-- output in separately, since it needs a live network call this static
-- file can't make.
