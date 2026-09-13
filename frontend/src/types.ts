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
  breaks?: number[];
  colors?: string[];
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
}

export interface SearchResult {
  label: string;
  type: "administrative" | "asset" | "location";
  lat: number;
  lon: number;
}
