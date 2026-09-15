import L from "leaflet";
import type { BoundaryFeatureProperties, BoundaryLevel, BoundarySummary } from "../types";
import { api } from "../api/client";

export type { BoundaryLevel };

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

/** Static, non-interactive outline shown once for context before any state
 * is explicitly picked as the AOI. */
const STATE_CONTEXT_STYLE: L.PathOptions = {
  color: "#f97316",
  weight: 2,
  fill: false,
  dashArray: "6 4",
  interactive: false,
};

/** Light outline for the LGA currently narrowing the ward dropdown, before
 * (or instead of) a ward being picked within it. */
const LGA_CONTEXT_STYLE: L.PathOptions = {
  color: "#eab308",
  weight: 2,
  fill: true,
  fillOpacity: 0.03,
  dashArray: "4 3",
  interactive: false,
};

/** Whichever boundary (state, LGA, or ward) the user has actually picked —
 * this becomes the AOI for analysis, at whatever level they chose. */
const SELECTED_STYLE: L.PathOptions = {
  color: "#f472b6",
  weight: 3,
  fill: true,
  fillOpacity: 0.1,
};

/**
 * Drives the cascading State -> LGA -> Ward boundary selector. Any of the
 * three levels can be picked directly as the AOI — a state or an LGA run
 * doesn't require drilling all the way down to a ward. Picking a level
 * zooms the map to it, outlines it, and fires onSelect with it as the new
 * AOI so analysis can be run against it (zonal stats / area-by-class) and
 * so active layers get rescoped to it (see LayerManager.setAoi).
 */
export class BoundaryManager {
  private map: L.Map;
  private stateContextLayer: L.GeoJSON | null = null;
  private lgaContextLayer: L.GeoJSON | null = null;
  private selectedLayer: L.GeoJSON | null = null;
  onSelect: (aoi: AoiSelection) => void = () => {};

  constructor(map: L.Map) {
    this.map = map;
  }

  /** Draws the Lagos state outline once, for orientation, before the state
   * itself is picked as the AOI. */
  async loadStateContext(): Promise<void> {
    if (this.stateContextLayer) return;
    const geojson = await api.getBoundaryGeoJSON("state");
    this.stateContextLayer = L.geoJSON(geojson, { style: () => STATE_CONTEXT_STYLE }).addTo(this.map);
  }

  /** The one Lagos state record — used to populate the State dropdown with
   * its real boundary code instead of a guessed/hardcoded value. */
  async getState(): Promise<BoundarySummary | null> {
    const states = await api.listBoundaries("state");
    return states[0] ?? null;
  }

  listLgas(): Promise<BoundarySummary[]> {
    return api.listBoundaries("lga");
  }

  listWards(lgaCode: string): Promise<BoundarySummary[]> {
    return api.listBoundaries("ward", { parentCode: lgaCode });
  }

  /** Outlines the given LGA (or clears the outline if lgaCode is null).
   * Purely visual context for narrowing the ward dropdown — selectBoundary
   * is what actually sets the LGA as the AOI. */
  async showLgaContext(lgaCode: string | null): Promise<void> {
    if (this.lgaContextLayer) {
      this.map.removeLayer(this.lgaContextLayer);
      this.lgaContextLayer = null;
    }
    if (!lgaCode) return;
    const feature = await api.getBoundaryFeature("lga", lgaCode);
    this.lgaContextLayer = L.geoJSON(feature, { style: () => LGA_CONTEXT_STYLE }).addTo(this.map);
  }

  /** Loads a boundary's geometry at any level (state, LGA, or ward), zooms
   * to it, outlines it, and fires onSelect with it as the new AOI. This is
   * the single entry point for "run analysis at this level" — a state or
   * an LGA is just as valid an AOI as a ward. */
  async selectBoundary(level: BoundaryLevel, code: string): Promise<AoiSelection> {
    const feature = await api.getBoundaryFeature(level, code);
    this.clearSelection();

    this.selectedLayer = L.geoJSON(feature, { style: () => SELECTED_STYLE }).addTo(this.map);
    const maxZoom = level === "state" ? 11 : level === "lga" ? 13 : 16;
    this.map.fitBounds(this.selectedLayer.getBounds(), { maxZoom, padding: [24, 24] });

    const props = feature.properties as BoundaryFeatureProperties | undefined;
    const aoi: AoiSelection = {
      source: "boundary",
      level,
      code,
      name: props?.name ?? code,
      geometry: feature.geometry!,
    };
    this.onSelect(aoi);
    return aoi;
  }

  /** Removes just the selected-boundary highlight (keeps state/LGA context
   * outlines in place). */
  clearSelection(): void {
    if (this.selectedLayer) {
      this.map.removeLayer(this.selectedLayer);
      this.selectedLayer = null;
    }
  }

  /** Removes the selection highlight and the LGA context outline. */
  clearAll(): void {
    this.clearSelection();
    if (this.lgaContextLayer) {
      this.map.removeLayer(this.lgaContextLayer);
      this.lgaContextLayer = null;
    }
  }
}
