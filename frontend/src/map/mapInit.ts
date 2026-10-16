import L from "leaflet";

// Lagos State roughly spans 2.7–4.3E, 6.35–6.7N.
const LAGOS_CENTER: [number, number] = [6.5244, 3.3792];
const LAGOS_BOUNDS = L.latLngBounds([6.35, 2.7], [6.7, 4.3]);

export interface BasemapOption {
  id: string;
  label: string;
  layer: L.TileLayer;
}

/** All hazard/boundary overlays (raster tiles, GeoJSON) are added to the
 * map's default panes ('tilePane' at z-index 200, 'overlayPane' at 400).
 * Basemaps live on their own pane below that (z-index 150) so that
 * switching the basemap — which removes one tile layer and adds another —
 * can never end up drawn on top of an active hazard layer, regardless of
 * which order the two happen to be added/removed in. */
const BASEMAP_PANE = "basemapPane";
const BASEMAP_PANE_Z_INDEX = "150";

/** A handful of keyless (no API key/signup) basemaps spanning the styles a
 * hazard-mapping tool typically needs: a dark canvas for data-forward work
 * (the previous/default look), true-color satellite imagery for ground-
 * truthing, a labelled street map for orientation, and a topographic map
 * that shows terrain relief — handy alongside the elevation-derived
 * landslide/pluvial layers. CARTO's free raster basemaps started requiring
 * an API key in Aug 2026 (and watermark unauthenticated requests), so
 * everything here is Esri's keyless ArcGIS Online service or OpenStreetMap
 * directly, not CARTO.
 */
function buildBasemaps(): BasemapOption[] {
  const common: L.TileLayerOptions = { pane: BASEMAP_PANE, maxZoom: 19 };

  return [
    {
      id: "dark",
      label: "Dark",
      layer: L.tileLayer(
        "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
        {
          ...common,
          attribution: '&copy; <a href="https://www.esri.com">Esri</a> &mdash; Esri, DeLorme, NAVTEQ',
          maxNativeZoom: 16, // Esri only serves tiles up to z16; Leaflet upscales beyond that
        }
      ),
    },
    {
      id: "imagery",
      label: "Satellite",
      layer: L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        {
          ...common,
          attribution:
            '&copy; <a href="https://www.esri.com">Esri</a> &mdash; Esri, Maxar, Earthstar Geographics',
          maxNativeZoom: 19,
        }
      ),
    },
    {
      id: "topo",
      label: "Terrain",
      layer: L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
        {
          ...common,
          attribution: '&copy; <a href="https://www.esri.com">Esri</a> &mdash; Esri, HERE, Garmin, FAO, USGS',
          maxNativeZoom: 19,
        }
      ),
    },
    {
      id: "streets",
      label: "Streets",
      layer: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        ...common,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxNativeZoom: 19,
      }),
    },
  ];
}

export function createMap(containerId: string): { map: L.Map; basemaps: BasemapOption[] } {
  const map = L.map(containerId, {
    zoomControl: true,
    minZoom: 8,
    maxZoom: 19,
  }).setView(LAGOS_CENTER, 11);

  map.setMaxBounds(LAGOS_BOUNDS.pad(0.3));

  map.createPane(BASEMAP_PANE);
  const pane = map.getPane(BASEMAP_PANE);
  if (pane) pane.style.zIndex = BASEMAP_PANE_Z_INDEX;

  const basemaps = buildBasemaps();
  basemaps[0].layer.addTo(map); // "Dark" stays the default look

  return { map, basemaps };
}
