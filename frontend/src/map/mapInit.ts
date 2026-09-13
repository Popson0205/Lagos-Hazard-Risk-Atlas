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

  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 19,
  }).addTo(map);

  return map;
}
