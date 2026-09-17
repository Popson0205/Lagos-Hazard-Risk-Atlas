# Lagos Risk Atlas — why `/api/v1/analysis` returns 502/504

## Short version

The endpoint is not broken and the database is correct. In your own HAR,
one of the six analysis requests returned **HTTP 200 in 7.7 seconds** with
a complete, sensible result — using a byte-identical payload to the ones
that failed.

The difference is entirely **what else was hitting TiTiler at that moment**.

## The `{"detail":"Not Found"}` is a red herring

Opening `https://lagos-hazard-risk-atlas.onrender.com/api/v1/analysis` in a
browser sends a `GET`. The route is declared `@router.post("")`, so it is
`POST`-only.

Normally FastAPI answers that with `405 Method Not Allowed`. You get `404`
instead because of the `StaticFiles` mount at the end of `main.py`: when
Starlette finds a route whose path matches but whose method doesn't, it
records a *partial* match and keeps scanning. The catch-all `app.mount("/")`
then matches fully, StaticFiles looks for a file literally named
`api/v1/analysis` in `./static`, doesn't find one, and raises its own 404.

Nothing is misconfigured. The endpoint is reachable — only by POST.

## The real cause: TiTiler request queue

`POST /api/v1/analysis` on a raster layer proxies to TiTiler's
`/stac/statistics`. TiTiler is deployed with `plan: free` and
`WEB_CONCURRENCY: "1"` — **one worker, 0.1 CPU** — so it processes requests
strictly one at a time.

Timeline reconstructed from the HAR:

```
         ... 70 tile requests fired
13:44:28 ANALYSIS  -> 504 after 76s
         ... 25 tile requests fired
13:46:04 ANALYSIS  -> 502 after 49s
13:47:22 ANALYSIS  -> 200 after 8s      <-- no tiles in flight
         ... 129 tile requests fired
13:48:14 ANALYSIS  -> 504 after 77s
         ... 107 tile requests fired
13:50:44 ANALYSIS  -> 504 after 163s
13:51:57 ANALYSIS  -> 504 after 93s
```

Every failure is immediately preceded by a burst of 70–129 tile requests.
The one success is the one attempt with an empty queue.

Supporting numbers from the same capture: 331 TiTiler requests, **median
response 35.7 s**, slowest 360 s, 65 of them 5xx. Failures by zoom level:

| zoom | requests | failures |
|------|---------:|---------:|
| 11–13 | 90 | 0 |
| 14 | 47 | 2 |
| 15 | 82 | 22 |
| 16 | 92 | 41 |
| 17 | 20 | 0 |

Clean below z14, falling apart above it.

## Why the tile burst is so large

`layerControl.ts` sets Leaflet's `maxNativeZoom` from
`style.max_native_zoom`. The two pre-rendered JRC layers set it (13). The
three TiTiler-backed live layers **leave it null**, so Leaflet requests
native tiles up to the map's `maxZoom: 19`. Tile count quadruples per zoom
level.

This is pure waste: Sentinel-2 is 10 m/px and Landsat thermal is 30 m/px,
while a z16 tile pixel at Lagos's latitude is ~2.4 m. Those requests paid
the full COG-read-plus-band-math cost to invent pixels the sensor never
recorded.

Two behaviours make it worse at exactly the wrong moment. Selecting a ward
calls `fitBounds(..., { maxZoom: 16 })` (`boundaries.ts:94`), and `setAoi`
then calls `refreshActiveRasterLayers()`, which tears down and rebuilds
every raster layer to apply the AOI mask — forcing a **full re-fetch of
every visible tile at z16**. The user's next action is to click "Run
analysis", which lands at the back of that queue.

There is also a feedback loop worth knowing about: TiTiler fetches the STAC
item JSON from *your own backend* (`/api/v1/imagery/item/...`) once per tile
request. A 107-tile burst is also 107 concurrent requests back into the
FastAPI app. Since the handlers are `def` rather than `async def`, they run
in Starlette's 40-thread pool — which is how a 504 took 163 s despite an
internal 75 s timeout: ~88 s of that was spent waiting for a thread before
the TiTiler call was even issued.

## Database: verified correct

Checked against the live API responses in the HAR, not just the source:

- All 9 hazard themes present with correct ids and `display_order`.
- `coastal_flooding_water_extent_live` and `extreme_heat_lst_baseline`
  resolve with correct `style.stac` blocks — assets `["green","nir"]` /
  `["lwir11"]`, `nodata: 0`, positional `b1/b2` expressions. All three
  historical fixes (`fix_expression_bug`, `fix_nodata_bug`,
  `fix_earth_search_switch`) are applied in the live database.
- Scene resolution works: `S2C_31NEH_20260124_0_L2A` (1.35% cloud) and
  `LC09_L2SP_191056_20260707_02_T2` (16.6% cloud).
- `tile_url` is well-formed, including the `WebMercatorQuad` path segment.
- The successful analysis returned coherent NDWI values (min −0.657, max
  0.011, mean −0.224, 17,497 valid pixels over 1.706 km²) — negative NDWI
  meaning mostly non-water, which is right for that AOI.

Four non-blocking issues found:

1. **`db_init.sql` is a trap.** It creates `hazards` / `sort_order` /
   `source_uri`, which do not match `app/models.py`
   (`hazard_themes` / `display_order` / `raster_url` / `style`). `render.yaml`
   line 30 tells you to load *that* file. Your live DB is fine, so you used
   `db_init_correct.sql` — but the instruction should be fixed and
   `db_init.sql` deleted.
2. **`seed.py` can't repair rows.** It uses
   `if not db.get(Layer, entry["id"])`, so existing layers are never
   updated — which is the whole reason the `fix_*.sql` files exist.
   Consider a merge/upsert.
3. **`app/db.py` is dead and broken.** It does `from .config import settings`,
   but `config.py` only exports `get_settings`. Nothing imports it
   (everything uses `app/database.py`), so it never raises — but it will the
   first time someone imports it. Delete it.
4. **Stale `source` text.** Two layers still say "via Microsoft Planetary
   Computer" though you moved to Earth Search. Cosmetic, but it's shown in
   the UI.

## Fixes, in order of impact

### 1. Cap the tile pyramid — do this first

`backend/app/fix_max_native_zoom.sql`

Sets `max_native_zoom` to 14 for the Sentinel-2 layers and 13 for Landsat.
Leaflet then upscales tiles it already has instead of requesting new ones
past native resolution. The z15/z16/z17 requests — 194 of the 331 in your
capture, and 63 of the 65 failures — simply stop happening. No visual
change; zooming in already showed interpolated 10 m data.

This is a data change. Apply it and the fix takes effect on reload, no
redeploy needed.

### 2. Give TiTiler room

`render.yaml` — `plan: starter`, `WEB_CONCURRENCY: 2`, plus the standard
GDAL/VSI remote-COG tuning (`VSI_CACHE`, `GDAL_HTTP_MULTIPLEX`,
`GDAL_INGESTED_BYTES_AT_OPEN`, etc.). Those env vars cut per-tile latency
on their own, because the cost of a tile here is HTTP round-trips against
S3, not CPU.

### 3. Don't let the analysis queue behind tiles

`frontend/src/map/layerControl.ts` gains `suspendRasterTiles()`, which
detaches raster layers (aborting their pending image loads) and returns a
restore function.

Wire it up in `main.ts`, in the run-analysis handler around line 618:

```ts
runAnalysisBtn.disabled = true;
aoiResultEl.textContent = "Running analysis...";
const restoreTiles = layers.suspendRasterTiles();   // <-- add
try {
  const result = await api.runAnalysis({ /* unchanged */ });
  // ...
} catch (err) {
  aoiResultEl.textContent = `Analysis unavailable: ${(err as Error).message}`;
} finally {
  restoreTiles();                                   // <-- add
  runAnalysisBtn.disabled = false;
}
```

### 4. Retry transient failures server-side

`backend/app/routers/analysis.py` — `_post_statistics_with_retry()` retries
429/500/502/503/504 and timeouts twice, with 3 s then 9 s backoff. Since the
same payload succeeds once the queue drains, retrying is the correct
response rather than making the user click again. The failure message now
says the tile server is busy instead of blaming a cold start.

### Optional follow-up

Drop the `fitBounds` zoom on ward select from 16 to 14, and skip
`refreshActiveRasterLayers()` when the AOI mask is the only thing that
changed and the layer is already masked to the same geometry. Together those
remove most of the remaining burst.
