import L from "leaflet";

// Lagos State roughly spans 2.7–4.3E, 6.35–6.7N.
const LAGOS_CENTER: [number, number] = [6.5244, 3.3792];
const LAGOS_BOUNDS = L.latLngBounds([6.35, 2.7], [6.7, 4.3]);

export function createMap(containerId: string): L.Map {
  const map = L.map(containerId, {
    zoomControl: true,
    minZoom: 8,
    maxZoom: 19,
  }).setView(LAGOS_CENTER, 11);

  map.setMaxBounds(LAGOS_BOUNDS.pad(0.3));

  // CARTO's free raster basemaps (basemaps.cartocdn.com) started requiring
  // an API key in Aug 2026 and now watermark unauthenticated requests with
  // "API KEY REQUIRED". Esri's Dark Gray Canvas is a keyless dark basemap
  // with a similar look, so we use that instead of signing up for a key.
  L.tileLayer(
    "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    {
      attribution:
        '&copy; <a href="https://www.esri.com">Esri</a> &mdash; Esri, DeLorme, NAVTEQ',
      maxZoom: 19,
      maxNativeZoom: 16, // Esri only serves tiles up to z16; Leaflet upscales beyond that
    }
  ).addTo(map);

  return map;
}
