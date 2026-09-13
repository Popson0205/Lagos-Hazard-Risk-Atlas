import L from "leaflet";
import { api } from "../api/client";
import type { LayerManager } from "./layerControl";

/** Wires the "click map -> show value/metadata" identify tool (architecture
 * doc: "User can identify a location/feature, view risk class/value,
 * inspect metadata"). Only queries vector layers for now — see the backend
 * features.py note on wiring raster identify through TiTiler's /cog/point. */
export function setupIdentify(map: L.Map, layers: LayerManager, resultEl: HTMLElement): void {
  map.on("click", async (e: L.LeafletMouseEvent) => {
    const layerId = layers.getTopActiveLayerId();
    if (!layerId) {
      resultEl.textContent = "No active layer to identify against — toggle one on first.";
      return;
    }

    resultEl.textContent = "Querying...";
    try {
      const result = await api.identify(layerId, e.latlng.lng, e.latlng.lat);
      if (!result.properties && result.value === null) {
        resultEl.textContent = "No feature found at this location.";
        return;
      }
      resultEl.textContent = JSON.stringify(result.properties ?? result.value, null, 2);
    } catch (err) {
      resultEl.textContent = `Identify not available for this layer yet (${(err as Error).message}).`;
    }
  });
}
