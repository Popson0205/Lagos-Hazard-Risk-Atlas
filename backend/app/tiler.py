"""TiTiler, embedded in this app instead of deployed as its own service.

Mounted as a sub-application at settings.titiler_mount_path ("/titiler" by
default) from app/main.py, so the one container serves the API, the frontend
and the raster tiles. Endpoint shapes are the stock TiTiler ones, just under
that prefix:

    /titiler/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=<cog>
    /titiler/cog/statistics (POST), /titiler/cog/point/{lon},{lat}
    /titiler/stac/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=stac-item://...
    /titiler/stac/statistics (POST), /titiler/stac/point/{lon},{lat}

It is a sub-app (not just two routers on the main app) so TiTiler's own
exception handlers stay scoped to it — features.py relies on a point outside
a raster's footprint coming back as a plain 404 from /point.

STAC items never go over HTTP. `url=stac-item://<collection>/<item_id>` is
resolved by InProcessSTACReader straight from stac_client's in-memory item
cache, so a tile burst doesn't turn into a burst of requests back into this
same process (which is what the separate-service deploy did, once per tile,
and which would otherwise compete with the tiles for the same thread pool).
"""
from __future__ import annotations

import attr
from fastapi import FastAPI, HTTPException
from rio_tiler.errors import PointOutsideBounds
from rio_tiler.io import STACReader
from titiler.core.errors import DEFAULT_STATUS_CODES, add_exception_handlers
from titiler.core.factory import MultiBaseTilerFactory, TilerFactory

from app.services import stac_client

STAC_ITEM_SCHEME = "stac-item://"


@attr.s
class InProcessSTACReader(STACReader):
    """STACReader that resolves `stac-item://<collection>/<item_id>` from the
    in-process STAC item cache instead of fetching an item JSON over HTTP.
    Any other input falls through to the stock reader (plain item URL)."""

    def __attrs_post_init__(self):
        if self.item is None and self.input and self.input.startswith(STAC_ITEM_SCHEME):
            collection, _, item_id = self.input[len(STAC_ITEM_SCHEME):].partition("/")
            try:
                # signed_item(): Planetary Computer (Landsat) asset URLs need
                # a short-lived SAS token, attached per read to a copy so the
                # cached item never holds an expired one.
                self.item = stac_client.signed_item(stac_client.get_item_by_id(collection, item_id))
            except stac_client.NoScenesFoundError as exc:
                raise HTTPException(status_code=404, detail=str(exc)) from exc
            except Exception as exc:  # noqa: BLE001 — STAC API/network failure on a cache miss
                raise HTTPException(
                    status_code=502, detail=f"Could not load STAC item '{item_id}': {exc}"
                ) from exc
        super().__attrs_post_init__()


def create_tiler_app() -> FastAPI:
    app = FastAPI(
        title="Embedded TiTiler",
        description="TiTiler's /cog and /stac endpoints, served from the Risk Atlas container.",
    )

    cog = TilerFactory()
    app.include_router(cog.router, prefix="/cog", tags=["Cloud Optimized GeoTIFF"])

    stac = MultiBaseTilerFactory(reader=InProcessSTACReader)
    app.include_router(stac.router, prefix="/stac", tags=["SpatioTemporal Asset Catalog"])

    # A /point lookup outside the raster's footprint is a plain "nothing
    # there" (routers/features.py treats 404 as exactly that), but this
    # TiTiler version's defaults would answer 500 for it.
    add_exception_handlers(app, {**DEFAULT_STATUS_CODES, PointOutsideBounds: 404})

    @app.get("/healthz", include_in_schema=False)
    def healthz():
        return {"ping": "pong!"}

    return app
