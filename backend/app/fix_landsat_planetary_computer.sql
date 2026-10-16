-- Landsat (extreme_heat_lst_baseline) is now read from Microsoft's Planetary
-- Computer instead of Earth Search, because Earth Search's Landsat assets live
-- in a requester-pays AWS bucket that needs billed AWS credentials.
--
-- Nothing about the layer's recipe changes — same collection id
-- (landsat-c2-l2), same asset ("lwir11"), same expression and nodata — so this
-- is a display-only correction of the attribution shown in the layer info
-- panel. The provider switch itself is in the application code
-- (app/services/stac_client.py), not in the database.
--
-- Safe to run multiple times.

UPDATE layers
SET source = 'Landsat Collection 2 Level-2 (via Microsoft Planetary Computer)'
WHERE id = 'extreme_heat_lst_baseline';

SELECT id, source FROM layers WHERE id = 'extreme_heat_lst_baseline';
