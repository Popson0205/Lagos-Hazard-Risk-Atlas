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
VALUES ('extreme_heat_lst_baseline', 'extreme_heat', 'baseline', 'Land Surface Temperature (Baseline)', 'raster', 'Landsat Collection 2 Level-2 (via Microsoft Planetary Computer)', 'C', '30m', 'LST derived from Landsat thermal band, atmospherically corrected surface temperature product. Computed live per request from the least-cloudy Landsat scene over Lagos in the last 90 days (see backend/app/services/hazard_recipes.py) — not a fixed historical baseline.', NULL, '{"colormap_name": "inferno", "rescale": "20,45", "stac": {"collection": "landsat-c2-l2", "assets": ["lwir11"], "expression": "lwir11*0.00341802+149.0-273.15", "rescale": "20,45", "colormap_name": "inferno", "max_cloud_cover": 20, "lookback_days": 90}}'::jsonb, TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO layers (id, hazard_theme_id, scenario_id, name, layer_type, source, unit, resolution, methodology, raster_url, style, is_public)
VALUES ('coastal_flooding_water_extent_live', 'coastal_flooding', 'baseline', 'Current Water Extent (Live, NDWI)', 'raster', 'Sentinel-2 L2A NDWI (via Microsoft Planetary Computer)', 'NDWI', '10m', 'NDWI = (Green - NIR) / (Green + NIR), computed live from the least-cloudy Sentinel-2 scene over Lagos in the last 60 days. This is a current inundation/water-extent proxy, not a flood-risk or return-period model — see backend/app/services/hazard_recipes.py.', NULL, '{"colormap_name": "rdbu", "rescale": "-1,1", "stac": {"collection": "sentinel-2-l2a", "assets": ["B03", "B08"], "expression": "(B03-B08)/(B03+B08)", "rescale": "-1,1", "colormap_name": "rdbu", "max_cloud_cover": 20, "lookback_days": 60}}'::jsonb, TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO layers (id, hazard_theme_id, scenario_id, name, layer_type, source, unit, resolution, methodology, raster_url, style, is_public)
VALUES ('drought_water_stress_ndvi_live', 'drought_water_stress', 'baseline', 'Vegetation Stress (Live, NDVI)', 'raster', 'Sentinel-2 L2A NDVI (via Microsoft Planetary Computer)', 'NDVI', '10m', 'NDVI = (NIR - Red) / (NIR + Red), computed live from the least-cloudy Sentinel-2 scene over Lagos in the last 60 days — a standard vegetation-vigor proxy for drought/water stress, not a validated drought index.', NULL, '{"colormap_name": "rdylgn", "rescale": "-1,1", "stac": {"collection": "sentinel-2-l2a", "assets": ["B08", "B04"], "expression": "(B08-B04)/(B08+B04)", "rescale": "-1,1", "colormap_name": "rdylgn", "max_cloud_cover": 20, "lookback_days": 60}}'::jsonb, TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO layers (id, hazard_theme_id, scenario_id, name, layer_type, source, unit, resolution, methodology, raster_url, style, is_public)
VALUES ('coastal_erosion_shoreline_baseline', 'coastal_erosion', 'baseline', 'Shoreline Position (Baseline)', 'vector', 'Sentinel-2 L2A shoreline extraction (via Microsoft Planetary Computer)', 'm/year (erosion rate)', '10m', 'NDWI-based shoreline extraction across multi-year Sentinel-2 composites; rate computed via DSAS-style transects.', NULL, '{"classification": "erosion_rate", "breaks": [-5, -2, -0.5, 0.5, 2], "colors": ["#7f0000", "#d7301f", "#fdae61", "#a6d96a", "#1a9850", "#006837"]}'::jsonb, TRUE)
ON CONFLICT (id) DO NOTHING;
