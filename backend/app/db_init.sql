-- Lagos Risk Atlas — catalogue schema
-- Run once against a PostGIS-enabled database (Supabase or local).
-- Supabase ships PostGIS already enabled, so the CREATE EXTENSION below is
-- a no-op there, but it's kept for local/other-provider Postgres.

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

-- ---------------------------------------------------------------------------
-- Accounts, Data Management Portal and saved items (app/accounts/models.py).
-- The API also creates these automatically on startup if they are missing.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atlas_users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(254) NOT NULL UNIQUE,
    full_name VARCHAR(160) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'contributor',
    professional_role VARCHAR(160),
    organization VARCHAR(200),
    preferences JSON,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS atlas_dataset_records (
    id SERIAL PRIMARY KEY,
    code VARCHAR(32) UNIQUE,
    title VARCHAR(240) NOT NULL,
    description TEXT,
    hazard_theme_id VARCHAR(64) NOT NULL,
    region VARCHAR(160) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'draft',
    data_url TEXT,
    data_format VARCHAR(32),
    review_note TEXT,
    owner_id INTEGER NOT NULL REFERENCES atlas_users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_atlas_records_status ON atlas_dataset_records (status);
CREATE INDEX IF NOT EXISTS ix_atlas_records_owner ON atlas_dataset_records (owner_id);

CREATE TABLE IF NOT EXISTS atlas_saved_items (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES atlas_users(id) ON DELETE CASCADE,
    kind VARCHAR(16) NOT NULL,
    name VARCHAR(160) NOT NULL,
    payload JSON NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_atlas_saved_items_user ON atlas_saved_items (user_id);

CREATE TABLE IF NOT EXISTS atlas_user_avatars (
    user_id INTEGER PRIMARY KEY REFERENCES atlas_users(id) ON DELETE CASCADE,
    content_type VARCHAR(32) NOT NULL,
    data BYTEA NOT NULL,
    token VARCHAR(32) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
