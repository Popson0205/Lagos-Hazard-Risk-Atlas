import type {
  HazardTheme,
  Scenario,
  Layer,
  LayerDetail,
  SearchResult,
  BoundaryLevel,
  BoundaryLevelInfo,
  BoundarySummary,
  AnalysisRequest,
  AnalysisResult,
  ImagerySearchResult,
} from "../types";

const BASE = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status} ${res.statusText} (${url})`);
  }
  return res.json() as Promise<T>;
}

async function postJSON<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail ?? `Request failed: ${res.status} ${res.statusText} (${url})`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listHazards: () => getJSON<HazardTheme[]>(`${BASE}/hazards`),

  listScenarios: () => getJSON<Scenario[]>(`${BASE}/scenarios`),

  listLayers: (params: { hazard?: string; scenario?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.hazard) qs.set("hazard", params.hazard);
    if (params.scenario) qs.set("scenario", params.scenario);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return getJSON<Layer[]>(`${BASE}/layers${suffix}`);
  },

  getLayer: (layerId: string, opts: { date?: string | null; itemId?: string | null } = {}) => {
    const qs = new URLSearchParams();
    if (opts.itemId) qs.set("item_id", opts.itemId);
    else if (opts.date) qs.set("date", opts.date);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return getJSON<LayerDetail>(`${BASE}/layers/${layerId}${suffix}`);
  },

  /** Manual imagery search-and-select panel (mirrors FarmScan's "search
   * live scenes" flow): browse Planetary Computer scenes over a bbox/date
   * range/cloud-cover filter and let the user pick one, rather than only
   * ever seeing the auto-picked least-cloudy scene. Falls back server-side
   * to a widened window with no cloud filter if the search is empty. */
  searchImagery: (params: {
    collection: string;
    bbox?: [number, number, number, number];
    startDate?: string;
    endDate?: string;
    maxCloudCover?: number;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    qs.set("collection", params.collection);
    if (params.bbox) qs.set("bbox", params.bbox.join(","));
    if (params.startDate && params.endDate) {
      qs.set("datetime", `${params.startDate}/${params.endDate}`);
    }
    if (params.maxCloudCover != null) qs.set("max_cloud_cover", String(params.maxCloudCover));
    if (params.limit != null) qs.set("limit", String(params.limit));
    return getJSON<ImagerySearchResult>(`${BASE}/imagery/search?${qs.toString()}`);
  },

  getFeatures: (layerId: string, bbox?: [number, number, number, number]) => {
    const qs = bbox ? `?bbox=${bbox.join(",")}` : "";
    return getJSON<GeoJSON.FeatureCollection>(`${BASE}/layers/${layerId}/features${qs}`);
  },

  identify: (layerId: string, lon: number, lat: number) =>
    getJSON<{ layer_id: string; value: unknown; properties: Record<string, unknown> | null }>(
      `${BASE}/layers/${layerId}/identify?lon=${lon}&lat=${lat}`
    ),

  search: (q: string) => getJSON<SearchResult[]>(`${BASE}/search?q=${encodeURIComponent(q)}`),

  listBoundaryLevels: () => getJSON<BoundaryLevelInfo[]>(`${BASE}/boundaries`),

  listBoundaries: (level: BoundaryLevel, params: { parentCode?: string; q?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.parentCode) qs.set("parent_code", params.parentCode);
    if (params.q) qs.set("q", params.q);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return getJSON<BoundarySummary[]>(`${BASE}/boundaries/${level}${suffix}`);
  },

  getBoundaryGeoJSON: (level: BoundaryLevel, parentCode?: string) => {
    const qs = parentCode ? `?parent_code=${encodeURIComponent(parentCode)}` : "";
    return getJSON<GeoJSON.FeatureCollection>(`${BASE}/boundaries/${level}/geojson${qs}`);
  },

  getBoundaryFeature: (level: BoundaryLevel, code: string) =>
    getJSON<GeoJSON.Feature>(`${BASE}/boundaries/${level}/${encodeURIComponent(code)}`),

  runAnalysis: (request: AnalysisRequest) => postJSON<AnalysisResult>(`${BASE}/analysis`, request),
};
