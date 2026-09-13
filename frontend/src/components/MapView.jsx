import { useEffect, useRef } from "react";
import L from "leaflet";

const LAGOS_CENTER = [6.5244, 3.3792];
const DEFAULT_ZOOM = 10;

/**
 * Thin Leaflet wrapper. Keeps map instance in a ref so React re-renders
 * don't rebuild the map; layers are added/removed imperatively via effects
 * keyed on the props that changed, matching the "map state" the
 * architecture doc describes (hazard/scenario switch without a full reload).
 */
export default function MapView({ activeGeoJSON, onMapClick, imageryTileUrl }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const geoJsonLayerRef = useRef(null);
  const imageryLayerRef = useRef(null);

  useEffect(() => {
    const map = L.map(containerRef.current, {
      center: LAGOS_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: false,
    });

    L.control.zoom({ position: "bottomright" }).addTo(map);

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://carto.com/attributions">CARTO</a>, OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    map.on("click", (e) => {
      onMapClick?.(e.latlng.lng, e.latlng.lat);
    });

    mapRef.current = map;
    return () => map.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap the active hazard layer's GeoJSON in/out without touching the base map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (geoJsonLayerRef.current) {
      map.removeLayer(geoJsonLayerRef.current);
      geoJsonLayerRef.current = null;
    }
    if (activeGeoJSON) {
      geoJsonLayerRef.current = L.geoJSON(activeGeoJSON, {
        style: (feature) => styleForRiskClass(feature.properties?.risk_class),
        pointToLayer: (feature, latlng) =>
          L.circleMarker(latlng, { radius: 6, ...styleForRiskClass(feature.properties?.risk_class) }),
      }).addTo(map);
    }
  }, [activeGeoJSON]);

  // Swap in a Planetary Computer COG tile layer when one is selected.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (imageryLayerRef.current) {
      map.removeLayer(imageryLayerRef.current);
      imageryLayerRef.current = null;
    }
    if (imageryTileUrl) {
      imageryLayerRef.current = L.tileLayer(imageryTileUrl, { maxZoom: 19, opacity: 0.9 }).addTo(map);
    }
  }, [imageryTileUrl]);

  return <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />;
}

function styleForRiskClass(riskClass) {
  const colors = {
    low: "#4f9d78",
    moderate: "#d9a441",
    high: "#c1502e",
    severe: "#7a2418",
  };
  const color = colors[riskClass] || "#5b7480";
  return { color, weight: 1, fillColor: color, fillOpacity: 0.55 };
}
