-- Lagos Risk Atlas — catalogue schema
-- Run once against a PostGIS-enabled database (Neon or local).

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS hazards (
    id          TEXT PRIMARY KEY,           -- e.g. 'coastal_flooding'
    name        TEXT NOT NULL,
    description TEXT,
    sort_order  INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS scenarios (
    id          TEXT PRIMARY KEY,           -- e.g. 'baseline_2025', 'ssp2_2050'
    label       TEXT NOT NULL,
    year        INTEGER,
    description TEXT
);

CREATE TABLE IF NOT EXISTS layers (
    id              TEXT PRIMARY KEY,       -- e.g. 'coastal_flood_extent_ssp2_2050'
    hazard_id       TEXT REFERENCES hazards(id),
    scenario_id     TEXT REFERENCES scenarios(id),
    name            TEXT NOT NULL,
    layer_type      TEXT NOT NULL CHECK (layer_type IN ('raster', 'vector')),
    delivery        TEXT NOT NULL CHECK (delivery IN ('cog', 'postgis', 'vector_tile')),
    source_uri      TEXT,                   -- COG path/URL, or table name for vector
    unit            TEXT,
    resolution      TEXT,
    methodology     TEXT,
    style           JSONB,                  -- classification breaks, colors, opacity
    is_public       BOOLEAN DEFAULT TRUE,
    date_published  DATE DEFAULT CURRENT_DATE
);

-- Example vector feature table for a polygonised hazard output.
-- Real hazard tables follow this pattern: geometry + risk_class + value + metadata FK.
CREATE TABLE IF NOT EXISTS hazard_features (
    id          SERIAL PRIMARY KEY,
    layer_id    TEXT REFERENCES layers(id),
    risk_class  TEXT,
    value       DOUBLE PRECISION,
    geom        GEOMETRY(Geometry, 4326) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hazard_features_geom ON hazard_features USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_hazard_features_layer ON hazard_features (layer_id);

-- Seed the nine hazard themes from the architecture doc.
INSERT INTO hazards (id, name, sort_order) VALUES
    ('coastal_flooding',   'Coastal Flooding and Storm Surge', 1),
    ('pluvial_flooding',   'Pluvial and Flash Flooding', 2),
    ('riverine_flooding',  'Riverine and Lagoon Flooding', 3),
    ('compound_flooding',  'Compound Flooding', 4),
    ('land_subsidence',    'Land Subsidence', 5),
    ('extreme_heat',       'Extreme Heat / Urban Heat Island', 6),
    ('coastal_erosion',    'Coastal Erosion', 7),
    ('drought',            'Drought / Water Stress / Quality', 8),
    ('landslides',         'Landslides / Mudslides', 9)
ON CONFLICT (id) DO NOTHING;

INSERT INTO scenarios (id, label, year) VALUES
    ('baseline_2025', 'Baseline (current)', 2025),
    ('ssp2_2050',     'SSP2-4.5, 2050',     2050),
    ('ssp5_2050',     'SSP5-8.5, 2050',     2050)
ON CONFLICT (id) DO NOTHING;
