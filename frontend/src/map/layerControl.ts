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
  /** ISO date (YYYY-MM-DD) currently applied to live STAC raster layers, or
   * null for "most recent". Set via setDate() from the sidebar's date
   * picker; toggle() and refreshActiveRasterLayers() both read this so any
   * newly-activated or re-activated raster layer honors it. */
  private currentDate: string | null = null;
  onLegendChange: (detail: LayerDetail | null) => void = () => {};

  constructor(map: L.Map) {
    this.map = map;
  }

  isActive(layerId: string): boolean {
    return this.active.has(layerId);
  }

  setDate(date: string | null): void {
    this.currentDate = date;
  }

  getDate(): string | null {
    return this.currentDate;
  }

  private async activate(layerId: string): Promise<void> {
    const detail = await api.getLayer(layerId, this.currentDate);
    this.details.set(layerId, detail);

    let leafletLayer: L.Layer;
    if (detail.layer_type === "raster" && detail.tile_url) {
      const maxNativeZoom = detail.style?.max_native_zoom as number | undefined;
      leafletLayer = L.tileLayer(detail.tile_url, {
        opacity: 0.75,
        ...(maxNativeZoom ? { maxNativeZoom } : {}),
      });
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

  async toggle(layerId: string): Promise<void> {
    if (this.active.has(layerId)) {
      const layer = this.active.get(layerId)!;
      this.map.removeLayer(layer);
      this.active.delete(layerId);
      this.details.delete(layerId);
      this.onLegendChange(null);
      return;
    }
    await this.activate(layerId);
  }

  /** Re-fetches every currently-active *raster* layer against the current
   * date (see setDate) and swaps its tiles in place. Vector layers are left
   * alone — a historical date has no meaning for them here. Call this after
   * setDate() so an already-toggled-on layer actually shows the newly
   * picked date instead of only affecting layers toggled on afterwards. */
  async refreshActiveRasterLayers(): Promise<void> {
    const rasterIds = [...this.active.keys()].filter(
      (id) => this.details.get(id)?.layer_type === "raster"
    );
    for (const id of rasterIds) {
      const oldLayer = this.active.get(id)!;
      this.map.removeLayer(oldLayer);
      this.active.delete(id);
      this.details.delete(id);
      await this.activate(id);
    }
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
