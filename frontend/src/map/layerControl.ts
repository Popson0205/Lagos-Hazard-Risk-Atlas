import L from "leaflet";
import type { LayerDetail } from "../types";
import { api } from "../api/client";

/**
 * Manages the set of active Leaflet layers backing the sidebar's layer list
 * and legend/identify panels. Mirrors the System Flow: fetch layer metadata
 * -> route to raster (TiTiler tile URL) or vector (GeoJSON features) display.
 */
export class LayerManager {
  private map: L.Map;
  private active = new Map<string, L.Layer>();
  private details = new Map<string, LayerDetail>();
  onLegendChange: (detail: LayerDetail | null) => void = () => {};

  constructor(map: L.Map) {
    this.map = map;
  }

  isActive(layerId: string): boolean {
    return this.active.has(layerId);
  }

  async toggle(layerId: string): Promise<void> {
    if (this.active.has(layerId)) {
      const layer = this.active.get(layerId)!;
      this.map.removeLayer(layer);
      this.active.delete(layerId);
      this.details.delete(layerId);
      this.onLegendChange(null);
      return;
    }

    const detail = await api.getLayer(layerId);
    this.details.set(layerId, detail);

    let leafletLayer: L.Layer;
    if (detail.layer_type === "raster" && detail.tile_url) {
      leafletLayer = L.tileLayer(detail.tile_url, { opacity: 0.75 });
    } else if (detail.layer_type === "vector" && detail.features_url) {
      const geojson = await api.getFeatures(layerId);
      leafletLayer = L.geoJSON(geojson, {
        style: () => ({ color: "#2563eb", weight: 1, fillOpacity: 0.4 }),
      });
    } else {
      throw new Error(`Layer ${layerId} has no raster tile_url or vector features_url configured yet`);
    }

    leafletLayer.addTo(this.map);
    this.active.set(layerId, leafletLayer);
    this.onLegendChange(detail);
  }

  getActiveDetails(): LayerDetail[] {
    return [...this.details.values()];
  }

  /** Which active layer should answer an identify click — last one toggled on. */
  getTopActiveLayerId(): string | null {
    const ids = [...this.active.keys()];
    return ids.length ? ids[ids.length - 1] : null;
  }

  /** Full metadata (incl. layer_type) for the layer getTopActiveLayerId()
   * points at — lets callers (e.g. the AOI analysis flow) branch on
   * raster vs vector without a second network round-trip. */
  getTopActiveDetail(): LayerDetail | null {
    const id = this.getTopActiveLayerId();
    return id ? this.details.get(id) ?? null : null;
  }
}
