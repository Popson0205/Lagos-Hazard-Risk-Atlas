import L from "leaflet";
import type { BoundaryLevel, BoundaryFeatureProperties } from "../types";
import { api } from "../api/client";

export interface AoiSelection {
  source: "boundary";
  level: BoundaryLevel;
  code: string;
  name: string;
  geometry: GeoJSON.Geometry;
}

const LEVEL_STYLE: Record<BoundaryLevel, L.PathOptions> = {
  // fillOpacity is near-zero (not 0, and fill isn't `false`) so the whole
  // polygon area is click-target-able, not just the thin outline stroke —
  // with fill:false, Leaflet only registers clicks on the stroke itself,
  // which made picking a single LGA/ward practically impossible.
  state: { color: "#f97316", weight: 3, fill: true, fillOpacity: 0.02, dashArray: "6 4" },
  lga: { color: "#eab308", weight: 1.75, fill: true, fillOpacity: 0.02 },
  ward: { color: "#22d3ee", weight: 1, fill: true, fillOpacity: 0.02, opacity: 0.7 },
};

const SELECTED_STYLE: L.PathOptions = { color: "#f472b6", weight: 3, fill: true, fillOpacity: 0.08 };

/**
 * Manages the three admin-boundary overlay layers (state/LGA/ward) — lets
 * the sidebar toggle each on/off, and lets the user click a boundary to use
 * it as the current AOI for filtering hazard layers / running analysis.
 */
export class BoundaryManager {
  private map: L.Map;
  private overlays = new Map<BoundaryLevel, L.GeoJSON>();
  private selected: { layer: L.Path; original: L.PathOptions } | null = null;
  onSelect: (aoi: AoiSelection) => void = () => {};

  constructor(map: L.Map) {
    this.map = map;
  }

  isVisible(level: BoundaryLevel): boolean {
    const layer = this.overlays.get(level);
    return !!layer && this.map.hasLayer(layer);
  }

  async toggle(level: BoundaryLevel): Promise<void> {
    const existing = this.overlays.get(level);
    if (existing && this.map.hasLayer(existing)) {
      this.map.removeLayer(existing);
      return;
    }

    if (existing) {
      existing.addTo(this.map);
      return;
    }

    const geojson = await api.getBoundaryGeoJSON(level);
    const layer = L.geoJSON(geojson, {
      style: () => LEVEL_STYLE[level],
      onEachFeature: (feature, lyr) => {
        const props = feature.properties as BoundaryFeatureProperties;
        lyr.bindTooltip(props.name, { sticky: true });
        lyr.on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          this.select(lyr as L.Path, feature.geometry, props);
        });
      },
    });
    this.overlays.set(level, layer);
    layer.addTo(this.map);
  }

  private select(layer: L.Path, geometry: GeoJSON.Geometry, props: BoundaryFeatureProperties): void {
    this.clearSelectionStyle();
    const original = { ...(layer.options as L.PathOptions) };
    layer.setStyle(SELECTED_STYLE);
    layer.bringToFront();
    this.selected = { layer, original };

    this.onSelect({
      source: "boundary",
      level: props.level,
      code: props.code,
      name: props.name,
      geometry,
    });
  }

  private clearSelectionStyle(): void {
    if (this.selected) {
      this.selected.layer.setStyle(this.selected.original);
      this.selected = null;
    }
  }

  clearSelection(): void {
    this.clearSelectionStyle();
  }
}
