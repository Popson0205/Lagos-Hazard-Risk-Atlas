# Deploying on Railway (one service)

The whole app is **one Railway service**: the root `Dockerfile` builds the frontend, bakes
it into the FastAPI image, and TiTiler runs *inside* that same FastAPI app
(`backend/app/tiler.py`, mounted at `/titiler`). One container, one domain, one deploy:

| Path | What serves it |
|---|---|
| `/api/v1/...` | FastAPI backend |
| `/titiler/cog/...`, `/titiler/stac/...` | embedded TiTiler (raster tiles, stats, point lookups) |
| everything else | the built frontend |

`railway.json` at the repo root drives the build/deploy settings. There is no second
service, no TiTiler image, and no `TITILER_BASE_URL` to wire up.

## 0. Database: Supabase (unchanged)

1. Create a project at [supabase.com](https://supabase.com) (skip if you already have one).
2. **Project Settings > Database > Connect**, copy the **Session pooler** connection
   string (mode: Session). Use the session pooler, not the direct connection — the direct
   one is IPv6-only unless you've bought the IPv4 add-on, and fails to resolve from
   Railway's IPv4 network.
3. Rewrite the scheme from `postgresql://` to `postgresql+psycopg://`.
4. Load the schema, then the accumulated fixes, in this order:
   ```
   psql "$DATABASE_URL" -f backend/app/db_init_correct.sql
   psql "$DATABASE_URL" -f backend/app/fix_expression_bug.sql
   psql "$DATABASE_URL" -f backend/app/fix_nodata_bug.sql
   psql "$DATABASE_URL" -f backend/app/fix_earth_search_switch.sql
   psql "$DATABASE_URL" -f backend/app/fix_max_native_zoom.sql
   psql "$DATABASE_URL" -f backend/app/fix_source_attribution.sql
   psql "$DATABASE_URL" -f backend/app/fix_landsat_planetary_computer.sql
   ```
   (`db_init_correct.sql`, not `db_init.sql` — the latter is an older, abandoned schema.)
   No new SQL is needed for the TiTiler merge: the stored recipes keep their positional
   `b1`/`b2` expressions and the backend translates them (see `_titiler_expression` in
   `stac_client.py`).

## 1. Create the service

1. [railway.com/new](https://railway.com/new) → **Deploy from GitHub repo** → this repo.
   Railway picks up `railway.json` (Dockerfile build, context = repo root, health check
   `/api/v1/health`).
2. **Settings > Networking > Generate Domain**.
3. **Variables** tab:

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | your Supabase session-pooler string from step 0 |
   | `CORS_ORIGINS` | `*` (same-origin — frontend, API and tiles share one URL) |
   | `STAC_API_URL` | `https://earth-search.aws.element84.com/v1` |

   That's all that's required. The GDAL/COG read tuning that used to be set on the
   TiTiler service is now baked into the `Dockerfile` as defaults (see below), so you don't
   re-enter it.
4. Deploy, then check:
   - `https://<your-domain>/api/v1/health` → `{"status":"ok"}`
   - `https://<your-domain>/titiler/healthz` → `{"ping":"pong!"}`
   - `https://<your-domain>/titiler/docs` → TiTiler's own OpenAPI page

### Imagery sources (no credentials needed)

- **Sentinel-2** (coastal flooding NDWI, drought NDVI): Earth Search (`STAC_API_URL`), public S3 COGs.
- **Landsat** (extreme-heat LST): Microsoft Planetary Computer. Its asset URLs need a
  short-lived SAS token, which the backend fetches from
  `planetarycomputer.microsoft.com/api/sas/v1/...` and attaches on every read (no API key,
  free). The service therefore needs outbound access to that host, which Railway allows by
  default. Earth Search's own Landsat links point at a requester-pays AWS bucket, which is why
  it isn't used for this layer.

## 2. Already running the old two-service setup?

1. Deploy this version of the main service first.
2. **Delete the `TITILER_BASE_URL` variable** from the main service. It's ignored now, but
   leaving a reference to a service you're about to delete is just a trap.
3. Once the map loads tiles and *Run analysis* works, delete the old `titiler` service.

Nothing in the database changes, so rolling back is just redeploying the previous commit.

## Tuning knobs (Variables tab, all optional)

Defaults live in the `Dockerfile`; set a variable of the same name to override.

| Key | Default | Notes |
|---|---|---|
| `WEB_CONCURRENCY` | `2` | uvicorn workers. Two so one slow tile read can't block everything. |
| `GDAL_CACHEMAX` | `200` | MB of GDAL block cache, **per worker**. |
| `VSI_CACHE_SIZE` | `268435456` | bytes of remote-chunk cache, **per worker** (was 512 MB on the old TiTiler service; halved because the API now shares the instance). |
| `GDAL_HTTP_MULTIPLEX`, `GDAL_HTTP_VERSION`, `GDAL_INGESTED_BYTES_AT_OPEN`, `GDAL_BAND_BLOCK_CACHE`, `VSI_CACHE`, `CPL_VSIL_CURL_ALLOWED_EXTENSIONS`, `GDAL_DISABLE_READDIR_ON_OPEN` | see `Dockerfile` | the COG range-read tuning; every tile is an S3 range-read, so these matter more than CPU. |

**Sizing rule:** `WEB_CONCURRENCY × (GDAL_CACHEMAX + VSI_CACHE_SIZE)` plus the app itself
must fit in the service's memory. The defaults come to roughly 0.9 GB for caches, so give
the service **at least 1.5–2 GB**. If you see OOM restarts, lower `VSI_CACHE_SIZE` or drop
`WEB_CONCURRENCY` to `1` before anything else.

## Notes

- **No spin-down.** Railway's usage-based pricing doesn't sleep idle services by default.
- **Variable changes are staged.** Editing Variables doesn't take effect until you deploy
  (Railway shows a "review changes" prompt).
- **`backend/Dockerfile` and `frontend/Dockerfile`** are only used by `docker-compose.yml`
  for local dev. Railway uses the root `Dockerfile`.
- **TiTiler version.** `backend/requirements.txt` pins `titiler.core==1.2.1`, the newest
  release that installs alongside the pinned `fastapi==0.115.0`. TiTiler 2.x needs a newer
  FastAPI; upgrading both together is possible but is its own change to test.
