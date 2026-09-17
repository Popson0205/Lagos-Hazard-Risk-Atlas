# CHANGES — analysis 502/504 fix bundle

Full project with every fix applied. See `DIAGNOSIS.md` for the evidence
behind each change.

## Summary

`POST /api/v1/analysis` was not broken. In the supplied HAR it returned
**200 in 7.7s** on the one attempt where no map tiles were in flight, and
502/504 on every attempt that followed a burst of 70–129 tile requests.
TiTiler runs one worker on Render's free tier, so it serves requests
strictly one at a time and the statistics call queued behind the tiles.

The `{"detail":"Not Found"}` seen in the browser is unrelated: the route is
POST-only, and the `StaticFiles` catch-all mounted at `/` turns the usual
405 into a 404.

## Deployment order

**Step 1 is the important one.** It is a data-only change, needs no
redeploy, and removes ~59% of all tile requests and ~97% of the failures.

```bash
# 1. Database (from backend/app/)
cd backend/app
psql "$DATABASE_URL" -f apply_all_fixes.sql
#    Supabase web SQL Editor instead? \i won't work there — paste
#    fix_expression_bug.sql, fix_nodata_bug.sql, fix_earth_search_switch.sql,
#    fix_max_native_zoom.sql, fix_source_attribution.sql in that order.

# 2. Redeploy the app (frontend + backend changes)
git push   # or trigger a Render deploy

# 3. In the Render dashboard, upgrade the TiTiler service to Starter and
#    set the new env vars — or re-sync the Blueprint from render.yaml.
```

Step 3 is not strictly required once step 1 lands, but without it a heavy
pan at low zoom can still saturate a single 0.1-CPU worker.

## Changed files

| File | Change |
|---|---|
| `backend/app/fix_max_native_zoom.sql` | **New.** Caps the tile pyramid at sensor resolution: 14 for Sentinel-2 (10 m), 13 for Landsat thermal (30 m). The three live layers had no cap, so Leaflet requested native tiles to `maxZoom: 19` — paying full COG-read cost for detail the sensor never recorded. |
| `backend/app/fix_source_attribution.sql` | **New.** Layer rows still credited Microsoft Planetary Computer; imagery has come from Earth Search since the switch. |
| `backend/app/apply_all_fixes.sql` | **New.** Runs all five migrations in order via psql. |
| `backend/app/routers/analysis.py` | `_post_statistics_with_retry()` retries 429/500/502/503/504 and timeouts twice (3s, 9s backoff). Non-retryable 4xx still surface immediately. Error text now names tile-server contention rather than blaming a cold start. |
| `backend/app/seed.py` | Updates existing layers in place instead of skipping them. The insert-only behaviour is the sole reason every `fix_*.sql` had to be hand-written. |
| `frontend/src/map/layerControl.ts` | `suspendRasterTiles()` detaches raster layers (aborting pending tile loads) and returns a restore function. |
| `frontend/src/main.ts` | Calls `suspendRasterTiles()` before the analysis request, restores it in `finally`. |
| `data/catalogue/hazard_layers.json` | `max_native_zoom` added for the three live layers, matching the SQL. |
| `render.yaml` | TiTiler `free` → `starter`, `WEB_CONCURRENCY` 1 → 2, plus GDAL/VSI remote-COG tuning. Schema instruction corrected to `db_init_correct.sql`. |
| `backend/app/db_init.sql` | **Deleted.** Stale schema (`hazards`/`sort_order`/`source_uri`) that does not match `models.py`; `render.yaml` used to point at it, which yields `UndefinedTable: relation "hazard_themes" does not exist`. |
| `backend/app/db.py` | **Deleted.** Dead module; did `from .config import settings`, a name `config.py` does not export. Nothing imported it. |

## Verification performed

- `npm run build` (includes `tsc`) passes clean.
- `app.main:app` imports; OpenAPI confirms `POST /api/v1/analysis` is
  POST-only, which is what produces the 404 on a browser GET.
- Retry helper unit-tested across four cases: recovers from a transient
  502; returns 504 after persistent 504s; returns 504 after repeated
  timeouts; does **not** retry a non-retryable 422.
- Catalogue JSON and `render.yaml` parse.

## Not changed — worth considering later

- `boundaries.ts:94` zooms to `maxZoom: 16` on ward select, then `setAoi`
  calls `refreshActiveRasterLayers()`, rebuilding every raster layer and
  re-fetching every visible tile. Dropping that to 14, and skipping the
  refresh when only the mask changed, removes most of the remaining burst.
- TiTiler fetches the STAC item JSON from your own backend once per tile, so
  a 107-tile burst is also 107 requests back into FastAPI. The handlers are
  `def`, not `async def`, so they share a 40-thread pool — which is why one
  504 took 163s despite a 75s internal timeout. Adding a `Cache-Control`
  header to `/api/v1/imagery/item/...` would let that be cached.
- `landslides_lagos_dem_relief` and `pluvial_flooding_relative_lowland_index`
  have no `raster_url`, `stac`, or `xyz_url`, so analysis returns 501. Both
  are marked `is_public: false` and documented PENDING — expected, not a bug.
