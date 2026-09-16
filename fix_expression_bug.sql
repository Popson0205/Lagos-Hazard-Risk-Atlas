-- Fixes the "Invalid band/asset name 'b03'" bug in the three live layers
-- already seeded in your database. db_init_correct.sql uses ON CONFLICT DO
-- NOTHING, so re-running it won't touch these existing rows — run this
-- instead (safe to run multiple times).
--
-- Root cause: rio-tiler's expression parser treats any token matching
-- b<digits> (case-insensitively) as a positional band index, not a literal
-- asset name. Sentinel-2's real asset names ("B03", "B08", "B04") collide
-- with that convention; Landsat's "lwir11" didn't, which is why only the
-- NDWI/NDVI layers broke. Fix: reference bands by position (b1, b2, ...,
-- matching the order given in `assets`) instead of repeating the asset
-- name in the expression itself.

UPDATE layers
SET style = jsonb_set(style, '{stac,expression}', '"b1*0.00341802+149.0-273.15"')
WHERE id = 'extreme_heat_lst_baseline';

UPDATE layers
SET style = jsonb_set(style, '{stac,expression}', '"(b1-b2)/(b1+b2)"')
WHERE id = 'coastal_flooding_water_extent_live';

UPDATE layers
SET style = jsonb_set(style, '{stac,expression}', '"(b1-b2)/(b1+b2)"')
WHERE id = 'drought_water_stress_ndvi_live';

-- Verify:
SELECT id, style->'stac'->>'expression' AS expression FROM layers
WHERE id IN ('extreme_heat_lst_baseline', 'coastal_flooding_water_extent_live', 'drought_water_stress_ndvi_live');
