import { useEffect, useState } from "react";
import MapView from "./components/MapView.jsx";
import HazardSidebar from "./components/HazardSidebar.jsx";
import InfoPanel from "./components/InfoPanel.jsx";
import { api } from "./api/client.js";

export default function App() {
  const [hazards, setHazards] = useState([]);
  const [scenarios, setScenarios] = useState([]);
  const [layers, setLayers] = useState([]);

  const [activeHazardId, setActiveHazardId] = useState(null);
  const [activeScenarioId, setActiveScenarioId] = useState(null);
  const [activeGeoJSON, setActiveGeoJSON] = useState(null);
  const [identifyResult, setIdentifyResult] = useState(null);

  const [showImagery, setShowImagery] = useState(false);
  const [imageryTileUrl, setImageryTileUrl] = useState(null);

  // Load the hazard/scenario catalogue once on mount.
  useEffect(() => {
    api.getHazards().then(setHazards).catch(console.error);
    api.getScenarios().then(setScenarios).catch(console.error);
  }, []);

  // Refetch the layer list whenever the active hazard/scenario changes.
  useEffect(() => {
    if (!activeHazardId) {
      setActiveGeoJSON(null);
      return;
    }
    api
      .getLayers({ hazardId: activeHazardId, scenarioId: activeScenarioId })
      .then(setLayers)
      .catch(console.error);
  }, [activeHazardId, activeScenarioId]);

  // Once we know which layer is active, pull its features onto the map.
  useEffect(() => {
    const layer = layers[0];
    if (!layer) return;
    if (layer.delivery !== "postgis") return; // raster layers get COG tiles instead — see README
    api.getLayerFeatures(layer.id).then(setActiveGeoJSON).catch(console.error);
  }, [layers]);

  // Pull a recent, low-cloud Sentinel-2 scene from Planetary Computer for context.
  useEffect(() => {
    if (!showImagery) {
      setImageryTileUrl(null);
      return;
    }
    api
      .searchImagery({ maxCloudCover: 15 })
      .then((items) => {
        const best = items[0];
        setImageryTileUrl(best?.preview_tilejson_url ? tileTemplateFromTilejson(best) : null);
      })
      .catch(console.error);
  }, [showImagery]);

  const activeLayer = layers[0] || null;

  function handleMapClick(lon, lat) {
    if (!activeLayer) return;
    api.identify(activeLayer.id, lon, lat).then(setIdentifyResult).catch(console.error);
  }

  return (
    <div style={{ display: "flex", height: "100%" }}>
      <HazardSidebar
        hazards={hazards}
        scenarios={scenarios}
        activeHazardId={activeHazardId}
        activeScenarioId={activeScenarioId}
        onSelectHazard={setActiveHazardId}
        onSelectScenario={setActiveScenarioId}
        showImagery={showImagery}
        onToggleImagery={() => setShowImagery((v) => !v)}
      />
      <div style={{ position: "relative", flex: 1 }}>
        <MapView
          activeGeoJSON={activeGeoJSON}
          imageryTileUrl={imageryTileUrl}
          onMapClick={handleMapClick}
        />
        <InfoPanel activeLayer={activeLayer} identifyResult={identifyResult} />
      </div>
    </div>
  );
}

/**
 * The backend hands back a TiTiler tilejson.json URL (see /imagery/search).
 * Leaflet's tileLayer wants a {z}/{x}/{y} template, which TiTiler's
 * tilejson document itself contains under `tiles[0]` — fetch it once here.
 * For a first pass we resolve it lazily; swap for a proper tilejson fetch
 * + L.TileLayer once you wire a real TiTiler deployment (see README).
 */
function tileTemplateFromTilejson(item) {
  return item.preview_tilejson_url; // placeholder — resolve via fetch(item.preview_tilejson_url).tiles[0]
}
