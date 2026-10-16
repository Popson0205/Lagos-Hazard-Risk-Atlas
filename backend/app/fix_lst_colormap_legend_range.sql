-- Extreme-heat (LST) colour ramp: blue = coolest, red = hottest (was inferno),
-- and a fixed 0-12 month legend range for the JRC seasonality layer.
-- The live-layer recipe is read from style->'stac', so BOTH copies of the
-- colormap name are updated. Safe to run multiple times.
-- (Alternative: `python -m app.seed` applies the same change from the catalogue.)

UPDATE layers
SET style = jsonb_set(jsonb_set(style, '{colormap_name}', '"coolwarm"'),
                      '{stac,colormap_name}', '"coolwarm"')
WHERE id = 'extreme_heat_lst_baseline';

UPDATE layers
SET style = jsonb_set(style, '{legend_range}', '[0, 12]')
WHERE id = 'riverine_flooding_jrc_gsw_seasonality';

SELECT id, style->>'colormap_name' AS colormap, style->'stac'->>'colormap_name' AS stac_colormap,
       style->'legend_range' AS legend_range
FROM layers WHERE id IN ('extreme_heat_lst_baseline','riverine_flooding_jrc_gsw_seasonality');
