export interface HazardTheme {
  id: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  display_order: number;
}

export interface Scenario {
  id: string;
  label: string;
  time_period?: string | null;
  description?: string | null;
}

export interface LayerStyle {
  colormap_name?: string;
  rescale?: string;
  classification?: string;
  breaks?: (number | string)[];
  colors?: string[];
  /** A plain public XYZ tile template (e.g. JRC Global Surface Water) —
   * served directly, bypassing TiTiler/STAC entirely. */
  xyz_url?: string;
  max_native_zoom?: number;
  /** Present only on live STAC-recipe raster layers — which Planetary
   * Computer collection this layer's imagery comes from, e.g.
   * "sentinel-2-l2a" or "landsat-c2-l2". Drives which collection the
   * imagery search-and-select panel searches for this layer. */
  stac?: {
    collection: string;
    max_cloud_cover?: number;
    lookback_days?: number;
  };
}

export interface Layer {
  id: string;
  hazard_theme_id: string;
  scenario_id?: string | null;
  name: string;
  layer_type: "raster" | "vector";
  source?: string | null;
  date_published?: string | null;
  unit?: string | null;
  resolution?: string | null;
  methodology?: string | null;
  style?: LayerStyle | null;
  is_public: boolean;
}

export interface LayerDetail extends Layer {
  tile_url?: string | null;
  features_url?: string | null;
  /** Which actual scene this is, for live STAC layers — the requested date
   * and the scene found can differ, since search picks the least-cloudy
   * item in the window, not necessarily that exact day. */
  observed_at?: string | null;
  cloud_cover?: number | null;
  relaxed_search?: boolean;
}

/** One Planetary Computer STAC item from the manual imagery search panel
 * (GET /imagery/search) — a candidate scene the user can pick to pin a live
 * raster layer to, instead of always showing the auto-picked "most recent"
 * scene. */
export interface StacItem {
  id: string;
  collection: string;
  datetime?: string | null;
  cloud_cover?: number | null;
  assets: Record<string, string>;
}

export interface ImagerySearchResult {
  items: StacItem[];
  relaxed_search: boolean;
  searched_start: string;
  searched_end: string;
}

export interface SearchResult {
  label: string;
  type: "administrative" | "asset" | "location";
  lat: number;
  lon: number;
  level?: BoundaryLevel | null;
  code?: string | null;
  bbox?: [number, number, number, number] | null;
}

export type BoundaryLevel = "state" | "lga" | "ward";

export interface BoundaryLevelInfo {
  level: BoundaryLevel;
  label: string;
  parent_level: BoundaryLevel | null;
  feature_count: number;
}

export interface BoundarySummary {
  level: BoundaryLevel;
  code: string;
  name: string;
  parent_code: string | null;
  parent_name: string | null;
  centroid: [number, number]; // [lon, lat]
  bbox: [number, number, number, number];
}

export interface BoundaryFeatureProperties {
  level: BoundaryLevel;
  code: string;
  name: string;
  parent_code: string | null;
  parent_name: string | null;
}

export interface AnalysisRequest {
  layer_id: string;
  geometry: GeoJSON.Geometry;
  operation: "zonal_stats" | "area_by_class";
  /** Same historical-date anchor as api.getLayer's date param. Ignored if
   * item_id is also given. */
  date?: string;
  /** Same manually-picked-scene pin as api.getLayer's itemId param. */
  item_id?: string;
}

export interface AnalysisResult {
  layer_id: string;
  operation: "zonal_stats" | "area_by_class";
  feature_count: number;
  area_km2: number;
  by_class?: Record<string, number> | null;
  values?: Record<string, number> | null;
  observed_at?: string | null;
  relaxed_search?: boolean;
}
