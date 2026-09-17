-- Corrects the provider attribution shown in the layer info panel.
--
-- data/catalogue/hazard_layers.json was updated to Earth Search when the
-- provider switched, but app/seed.py only ever INSERTed layers that didn't
-- already exist, so the rows already in the database kept the old text and
-- still credit Microsoft Planetary Computer in the UI. The imagery itself
-- has come from Earth Search since fix_earth_search_switch.sql was applied,
-- so this is a display-only correction — but it is currently miscrediting
-- the data source to users.
--
-- app/seed.py now updates existing rows in place, so future catalogue edits
-- propagate on re-seed and this class of drift shouldn't recur.
--
-- Safe to run multiple times.

UPDATE layers
SET source = 'Sentinel-2 L2A NDWI (via Earth Search / AWS Open Data)'
WHERE id = 'coastal_flooding_water_extent_live';

UPDATE layers
SET source = 'Sentinel-2 L2A NDVI (via Earth Search / AWS Open Data)'
WHERE id = 'drought_water_stress_ndvi_live';

UPDATE layers
SET source = 'Landsat Collection 2 Level-2 (via Earth Search / AWS Open Data)'
WHERE id = 'extreme_heat_lst_baseline';

-- The methodology text on the two Sentinel-2 layers also names the old
-- provider in passing.
UPDATE layers
SET methodology = replace(
        methodology,
        'via Microsoft Planetary Computer',
        'via Earth Search / AWS Open Data'
    )
WHERE methodology LIKE '%Microsoft Planetary Computer%';

-- Verify (should return no rows):
SELECT id, source FROM layers
WHERE source LIKE '%Planetary Computer%'
   OR methodology LIKE '%Planetary Computer%';
