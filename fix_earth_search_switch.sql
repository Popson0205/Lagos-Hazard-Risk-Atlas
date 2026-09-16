-- Switches the two Sentinel-2 layers' asset names for the new provider,
-- Earth Search (AWS Open Data), which replaces Microsoft Planetary
-- Computer entirely as of this change. Earth Search uses common band names
-- ("green", "nir", "red") instead of Planetary Computer's literal band
-- codes ("B03", "B08", "B04") — the collection id (sentinel-2-l2a) and the
-- b1/b2 expression convention are unchanged, only the `assets` list needs
-- updating.
--
-- extreme_heat_lst_baseline needs NO change here: Earth Search's
-- landsat-c2-l2 uses the identical asset name ("lwir11") and identical
-- nodata/scale/offset as Planetary Computer's, so that layer's style JSON
-- is already correct as-is.
--
-- Also requires deploying the updated backend code (services/stac_client.py
-- no longer signs URLs, and config.py's default STAC API now points at
-- Earth Search) — this SQL alone does nothing without that.
--
-- Safe to run multiple times.

UPDATE layers
SET style = jsonb_set(style, '{stac,assets}', '["green", "nir"]')
WHERE id = 'coastal_flooding_water_extent_live';

UPDATE layers
SET style = jsonb_set(style, '{stac,assets}', '["nir", "red"]')
WHERE id = 'drought_water_stress_ndvi_live';

-- Verify:
SELECT id, style->'stac'->>'assets' AS assets, style->'stac'->>'expression' AS expression
FROM layers
WHERE id IN ('extreme_heat_lst_baseline', 'coastal_flooding_water_extent_live', 'drought_water_stress_ndvi_live');
