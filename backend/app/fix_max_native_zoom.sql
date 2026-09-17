-- Caps the tile pyramid for the three "live" STAC layers at their real
-- sensor resolution.
--
-- ROOT CAUSE THIS FIXES
-- ---------------------
-- layerControl.ts reads `style.max_native_zoom` and passes it to Leaflet as
-- the tile layer's maxNativeZoom. The two pre-rendered JRC layers already
-- set it (13). The three TiTiler-backed live layers did not, so Leaflet
-- requested *native* tiles all the way to the map's maxZoom of 19.
--
-- Because the tile count quadruples per zoom level, one ward-sized viewport
-- costs roughly:
--     z14 ->   ~6 tiles       z15 ->  ~24 tiles
--     z16 ->  ~92 tiles       z17 -> ~370 tiles
-- ...and every one of those is a separate TiTiler request that re-opens the
-- Sentinel-2/Landsat COG, re-reads a window, and re-runs the band-math
-- expression. With WEB_CONCURRENCY=1 on Render's free tier, TiTiler serves
-- them strictly one at a time, so a zoom-16 pan queues ~90 jobs ahead of
-- whatever comes next — which is what starves POST /api/v1/analysis into a
-- 504.
--
-- Beyond the native zoom there is no extra detail to fetch anyway:
-- Sentinel-2 is 10 m/px and Landsat thermal is 30 m/px, while at Lagos's
-- latitude a z16 tile pixel is ~2.4 m and z17 is ~1.2 m. Those requests were
-- paying full COG-read cost to manufacture pixels the sensor never recorded.
-- With maxNativeZoom set, Leaflet stops requesting and simply upscales the
-- z14/z13 tiles it already has, so zooming in stays visually identical and
-- costs zero additional requests.
--
-- Ground resolution at lat 6.5degN = 156543.03 * cos(6.5deg) / 2^z
--     z13 = 18.99 m/px      z14 = 9.49 m/px      z15 = 4.75 m/px
-- So: Sentinel-2 (10 m) -> 14, Landsat thermal (30 m) -> 13.
--
-- Safe to run multiple times.

UPDATE layers
SET style = jsonb_set(style, '{max_native_zoom}', '14')
WHERE id IN ('coastal_flooding_water_extent_live', 'drought_water_stress_ndvi_live');

UPDATE layers
SET style = jsonb_set(style, '{max_native_zoom}', '13')
WHERE id = 'extreme_heat_lst_baseline';

-- Verify:
SELECT id,
       style->>'max_native_zoom' AS max_native_zoom,
       style->'stac'->>'collection' AS collection,
       resolution
FROM layers
ORDER BY id;
