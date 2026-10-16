import L from "leaflet";

/**
 * A raster tile layer clipped to an arbitrary GeoJSON polygon — the "only
 * show color inside my selected boundary/drawn area" look the plain
 * L.tileLayer used in layerControl.ts can't do on its own, since a z/x/y
 * tile pyramid is inherently rectangular; there's no query param that makes
 * an individual tile request "only this shape".
 *
 * Approach: draw each fetched tile image onto a canvas, then clip that
 * canvas with the AOI polygon projected into that specific tile's own
 * local pixel space (via the map's projection at that tile's zoom level).
 * This is done per-tile rather than as a single CSS clip-path over the
 * whole layer because each tile's local origin differs, and because it
 * naturally stays correct across pan/zoom without recomputing anything on
 * map move — a CSS clip-path would need re-projecting the AOI to screen
 * coordinates on every move/zoom event instead.
 */
export class MaskedTileLayer extends L.GridLayer {
  private readonly map: L.Map;
  private readonly tileUrlTemplate: string;
  private readonly maskRings: L.LatLng[][];

  constructor(
    map: L.Map,
    tileUrlTemplate: string,
    maskGeometry: GeoJSON.Geometry,
    options?: L.GridLayerOptions
  ) {
    super(options);
    this.map = map;
    this.tileUrlTemplate = tileUrlTemplate;
    this.maskRings = ringsFromGeometry(maskGeometry);
  }

  createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
    const size = this.getTileSize();
    const canvas = L.DomUtil.create("canvas", "leaflet-tile") as HTMLCanvasElement;
    canvas.width = size.x;
    canvas.height = size.y;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      done(new Error("Canvas 2D context unavailable"), canvas);
      return canvas;
    }

    const img = new Image();
    // Deliberately no img.crossOrigin here: we only ever drawImage() this
    // (never read pixels back via getImageData/toDataURL), which works
    // fine even without CORS headers on the tile response — setting
    // crossOrigin would instead risk the load failing outright if TiTiler
    // doesn't send an Access-Control-Allow-Origin header, for no benefit.
    img.onload = () => {
      const zoom = coords.z;
      const tileOriginX = coords.x * size.x;
      const tileOriginY = coords.y * size.y;

      ctx.save();
      ctx.beginPath();
      for (const ring of this.maskRings) {
        ring.forEach((latlng, i) => {
          const pt = this.map.project(latlng, zoom);
          const x = pt.x - tileOriginX;
          const y = pt.y - tileOriginY;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.closePath();
      }
      ctx.clip();
      ctx.drawImage(img, 0, 0, size.x, size.y);
      ctx.restore();
      done(undefined, canvas);
    };
    img.onerror = () => done(new Error("Tile image failed to load"), canvas);
    img.src = L.Util.template(this.tileUrlTemplate, coords as unknown as Record<string, string>);

    return canvas;
  }
}

function ringsFromGeometry(geom: GeoJSON.Geometry): L.LatLng[][] {
  const ringToLatLngs = (ring: number[][]) => ring.map(([lng, lat]) => L.latLng(lat, lng));
  if (geom.type === "Polygon") {
    return geom.coordinates.map(ringToLatLngs);
  }
  if (geom.type === "MultiPolygon") {
    return geom.coordinates.flatMap((polygon) => polygon.map(ringToLatLngs));
  }
  throw new Error(`AOI masking only supports Polygon/MultiPolygon geometry, got ${geom.type}`);
}
