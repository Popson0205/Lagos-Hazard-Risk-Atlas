-- Fixes the "no color ramp / degenerate uniform analysis result" bug on the
-- three already-seeded live layers. Root cause: Landsat/Sentinel-2 fill
-- pixels (cloud gaps, scene edges, small AOIs that happen to land on a
-- masked patch) are raw value 0, and without telling TiTiler that's nodata,
-- those pixels get counted as "valid" and run through the band-math
-- expression like real data — for Extreme Heat that turns raw 0 into a
-- bogus ~-124°C, which then clamps to the bottom (near-black) of the
-- colormap, looking like "nothing rendered" against a dark basemap.
--
-- Safe to run multiple times.

UPDATE layers
SET style = jsonb_set(style, '{stac,nodata}', '0')
WHERE id IN ('extreme_heat_lst_baseline', 'coastal_flooding_water_extent_live', 'drought_water_stress_ndvi_live');

-- Verify:
SELECT id, style->'stac'->>'nodata' AS nodata, style->'stac'->>'expression' AS expression
FROM layers
WHERE id IN ('extreme_heat_lst_baseline', 'coastal_flooding_water_extent_live', 'drought_water_stress_ndvi_live');
