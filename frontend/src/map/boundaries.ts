import L from "leaflet";
import type { BoundaryFeatureProperties, BoundaryLevel, BoundarySummary } from "../types";
import { api } from "../api/client";

// `level` stays a general BoundaryLevel (not narrowed to "ward") so the
// search box — which can zoom straight to a state, LGA, or ward result —
// can keep building this same shape.
export interface AoiSelection {
  source: "boundary";
  level: BoundaryLevel;
  code: string;
  name: string;
  geometry: GeoJSON.Geometry;
}

/** Static, non-interactive outline shown once for context — Lagos is the only state. */
const STATE_STYLE: L.PathOptions = {
  color: "#f97316",
  weight: 2,
  fill: false,
  dashArray: "6 4",
  interactive: false,
};

/** Light outline for the LGA currently narrowing the ward dropdown. */
const LGA_CONTEXT_STYLE: L.PathOptions = {
  color: "#eab308",
  weight: 2,
  fill: true,
  fillOpacity: 0.03,
  dashArray: "4 3",
  interactive: false,
};

/** The ward the user has picked — this becomes the AOI for analysis. */
const WARD_SELECTED_STYLE: L.PathOptions = {
  color: "#f472b6",
  weight: 3,
  fill: true,
  fillOpacity: 0.1,
};

/**
 * Drives the cascading State -> LGA -> Ward boundary selector. Lagos is the
 * only state, so it's drawn once as static context. Picking an LGA narrows
 * the ward list to that LGA and outlines it lightly; picking a ward zooms
 * the map to it, outlines it, and becomes the current AOI so analysis can
 * be run against it via TiTiler/zonal stats.
 */
export class BoundaryManager {
  private map: L.Map;
  private stateLayer: L.GeoJSON | null = null;
  private lgaContextLayer: L.GeoJSON | null = null;
  private wardLayer: L.GeoJSON | null = null;
  onSelect: (aoi: AoiSelection) => void = () => {};

  constructor(map: L.Map) {
    this.map = map;
  }

  /** Draws the Lagos state outline once, for orientation. Not selectable. */
  async loadStateContext(): Promise<void> {
    if (this.stateLayer) return;
    const geojson = await api.getBoundaryGeoJSON("state");
    this.stateLayer = L.geoJSON(geojson, { style: () => STATE_STYLE }).addTo(this.map);
  }

  listLgas(): Promise<BoundarySummary[]> {
    return api.listBoundaries("lga");
  }

  listWards(lgaCode: string): Promise<BoundarySummary[]> {
    return api.listBoundaries("ward", { parentCode: lgaCode });
  }

  /** Outlines the given LGA (or clears the outline if lgaCode is null). */
  async showLgaContext(lgaCode: string | null): Promise<void> {
    if (this.lgaContextLayer) {
      this.map.removeLayer(this.lgaContextLayer);
      this.lgaContextLayer = null;
    }
    if (!lgaCode) return;
    const feature = await api.getBoundaryFeature("lga", lgaCode);
    this.lgaContextLayer = L.geoJSON(feature, { style: () => LGA_CONTEXT_STYLE }).addTo(this.map);
  }

  /** Loads a ward's geometry, zooms to it, outlines it, and fires onSelect
   * with it as the new AOI. */
  async selectWard(code: string): Promise<AoiSelection> {
    const feature = await api.getBoundaryFeature("ward", code);
    this.clearSelection();

    this.wardLayer = L.geoJSON(feature, { style: () => WARD_SELECTED_STYLE }).addTo(this.map);
    this.map.fitBounds(this.wardLayer.getBounds(), { maxZoom: 16, padding: [24, 24] });

    const props = feature.properties as BoundaryFeatureProperties | undefined;
    const aoi: AoiSelection = {
      source: "boundary",
      level: "ward",
      code,
      name: props?.name ?? code,
      geometry: feature.geometry!,
    };
    this.onSelect(aoi);
    return aoi;
  }

  /** Removes just the selected-ward highlight (keeps state/LGA context). */
  clearSelection(): void {
    if (this.wardLayer) {
      this.map.removeLayer(this.wardLayer);
      this.wardLayer = null;
    }
  }

  /** Removes the ward highlight and the LGA context outline. */
  clearAll(): void {
    this.clearSelection();
    if (this.lgaContextLayer) {
      this.map.removeLayer(this.lgaContextLayer);
      this.lgaContextLayer = null;
    }
  }
}
