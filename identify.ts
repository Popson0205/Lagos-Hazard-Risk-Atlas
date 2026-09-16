import L from "leaflet";
import { api } from "../api/client";
import type { LayerManager } from "./layerControl";

/** Wires the "click map -> show value/metadata" identify tool (architecture
 * doc: "User can identify a location/feature, view risk class/value,
 * inspect metadata"). Vector layers do an ST_Contains lookup; raster layers
 * proxy to TiTiler's /stac/point or /cog/point for a real pixel value — see
 * backend routers/features.py. */
export function setupIdentify(map: L.Map, layers: LayerManager, resultEl: HTMLElement): void {
  map.on("click", async (e: L.LeafletMouseEvent) => {
    const layerId = layers.getTopActiveLayerId();
    if (!layerId) {
      resultEl.textContent = "No active layer to identify against — toggle one on first.";
      return;
    }

    resultEl.textContent = "Querying...";
    try {
      // Pass the currently-pinned scene (if any) so the identified value
      // matches whatever scene is actually rendered on screen, rather than
      // the backend silently re-resolving "most recent" and possibly
      // answering from a different date than what's visible.
      const result = await api.identify(layerId, e.latlng.lng, e.latlng.lat, layers.getSceneId());
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
