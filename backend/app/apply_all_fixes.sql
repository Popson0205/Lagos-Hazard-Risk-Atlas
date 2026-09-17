-- Applies every accumulated layer-style fix in dependency order.
--
-- RUN THIS WITH psql, FROM THIS DIRECTORY:
--     cd backend/app && psql "$DATABASE_URL" -f apply_all_fixes.sql
--
-- \i and \echo are psql meta-commands — they are NOT understood by
-- Supabase's web SQL Editor, and the relative paths need this file's own
-- directory as the working directory. If you're working in the Supabase
-- dashboard instead, paste the five fix_*.sql files individually, in the
-- order listed below.
--
-- All of these are idempotent (plain UPDATEs against known ids), so running
-- this against an already-corrected database is a no-op. It assumes the
-- schema itself is already loaded from db_init_correct.sql.
--
-- These exist as SQL rather than as a re-seed because app/seed.py used to
-- only INSERT layers that didn't already exist, so a row that was already
-- in the database could never be corrected from the catalogue. seed.py now
-- updates in place, so `python -m app.seed` is an alternative to everything
-- below — but running this is safe either way, and is the only option if
-- you can't get a shell on the deployed service.

\echo '1/5  expression: positional b1/b2 band refs (rio-tiler parser collision)'
\i fix_expression_bug.sql

\echo '2/5  nodata: exclude raw-0 fill pixels from band math'
\i fix_nodata_bug.sql

\echo '3/5  assets: Earth Search common band names'
\i fix_earth_search_switch.sql

\echo '4/5  max_native_zoom: cap the tile pyramid at sensor resolution'
\i fix_max_native_zoom.sql

\echo '5/5  source: correct provider attribution'
\i fix_source_attribution.sql

-- Final verification — every live layer should have a positional expression,
-- an explicit nodata, Earth Search asset names, and a native zoom cap.
SELECT id,
       style->'stac'->>'assets'       AS assets,
       style->'stac'->>'expression'   AS expression,
       style->'stac'->>'nodata'       AS nodata,
       style->>'max_native_zoom'      AS max_native_zoom,
       source
FROM layers
WHERE style ? 'stac'
ORDER BY id;
