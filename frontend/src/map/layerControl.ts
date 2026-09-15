import L from "leaflet";
import type { LayerDetail } from "../types";
import { api } from "../api/client";
import { geometryBbox } from "./geometryUtils";

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
   * null for "most recent". Superseded by currentItemId when that's set.
   * toggle() and refreshActiveRasterLayers() both read this so any
   * newly-activated or re-activated raster layer honors it. */
  private currentDate: string | null = null;
  /** A specific STAC item id the user picked from the imagery
   * search-and-select panel (see setItemId) — takes priority over
   * currentDate, pinning live raster layers to this exact scene rather than
   * auto-picking the least-cloudy one. */
  private currentItemId: string | null = null;
  /** Bounding box of the current area of interest, or null when none is
   * selected. Vector layers are re-fetched scoped to this bbox (real
   * ST_Intersects filtering server-side); raster tile layers are given it
   * as their Leaflet `bounds` option so tiles outside the AOI's bounding
   * box are never requested/drawn — a cheap rectangular clip. Neither is a
   * pixel-perfect polygon clip; that's a heavier follow-up (TiTiler feature
   * masking / PostGIS ST_Intersection) layered on top of this. */
  private aoiBbox: [number, number, number, number] | null = null;
  onLegendChange: (detail: LayerDetail | null) => void = () => {};

  constructor(map: L.Map) {
    this.map = map;
  }

  /** Called whenever the user's area of interest changes (any boundary
   * level, or a drawn polygon, or cleared). Re-scopes every already-active
   * layer to the new area so "toggle a layer" and "pick an area" stay in
   * sync instead of the layer silently continuing to show all of Lagos. */
  setAoi(geometry: GeoJSON.Geometry | null): void {
    this.aoiBbox = geometry ? geometryBbox(geometry) : null;
    this.refreshActiveRasterLayers().catch((err) => {
      console.error("Could not rescope raster layers to the new area:", err);
    });
    this.refreshActiveVectorLayers().catch((err) => {
      console.error("Could not rescope vector layers to the new area:", err);
    });
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

  setItemId(itemId: string | null): void {
    this.currentItemId = itemId;
  }

  getItemId(): string | null {
    return this.currentItemId;
  }

  private async activate(layerId: string): Promise<void> {
    const detail = await api.getLayer(layerId, { date: this.currentDate, itemId: this.currentItemId });
    this.details.set(layerId, detail);

    let leafletLayer: L.Layer;
    if (detail.layer_type === "raster" && detail.tile_url) {
      const maxNativeZoom = detail.style?.max_native_zoom as number | undefined;
      const bounds = this.aoiBbox
        ? L.latLngBounds([this.aoiBbox[1], this.aoiBbox[0]], [this.aoiBbox[3], this.aoiBbox[2]])
        : undefined;
      leafletLayer = L.tileLayer(detail.tile_url, {
        opacity: 0.75,
        ...(maxNativeZoom ? { maxNativeZoom } : {}),
        ...(bounds ? { bounds } : {}),
      });
    } else if (detail.layer_type === "vector" && detail.features_url) {
      const geojson = await api.getFeatures(layerId, this.aoiBbox ?? undefined);
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

  /** Same idea as refreshActiveRasterLayers, for the vector side — re-fetches
   * every currently-active vector layer's features scoped to the current
   * aoiBbox. Call this after setAoi() (done automatically by setAoi) so an
   * already-toggled-on vector layer narrows to the newly picked area
   * instead of only affecting layers toggled on afterwards. */
  async refreshActiveVectorLayers(): Promise<void> {
    const vectorIds = [...this.active.keys()].filter(
      (id) => this.details.get(id)?.layer_type === "vector"
    );
    for (const id of vectorIds) {
      const oldLayer = this.active.get(id)!;
      this.map.removeLayer(oldLayer);
      this.active.delete(id);
      this.details.delete(id);
      await this.activate(id);
    }
  }

  /** Turns off any active layer whose id isn't in allowedIds — used when the
   * hazard theme (and/or scenario) changes, so switching themes gives you a
   * clean map instead of the previous theme's layer lingering underneath
   * the new one. Returns true if anything was actually turned off. */
  deactivateLayersNotIn(allowedIds: Set<string>): boolean {
    const idsToRemove = [...this.active.keys()].filter((id) => !allowedIds.has(id));
    if (!idsToRemove.length) return false;
    for (const id of idsToRemove) {
      const layer = this.active.get(id)!;
      this.map.removeLayer(layer);
      this.active.delete(id);
      this.details.delete(id);
    }
    this.onLegendChange(this.getTopActiveDetail());
    return true;
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
