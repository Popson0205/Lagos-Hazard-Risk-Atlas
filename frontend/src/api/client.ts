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
  STACItem,
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

  getLayer: (layerId: string, sceneId?: string | null) => {
    const qs = sceneId ? `?scene_id=${encodeURIComponent(sceneId)}` : "";
    return getJSON<LayerDetail>(`${BASE}/layers/${layerId}${qs}`);
  },

  getFeatures: (layerId: string, bbox?: [number, number, number, number]) => {
    const qs = bbox ? `?bbox=${bbox.join(",")}` : "";
    return getJSON<GeoJSON.FeatureCollection>(`${BASE}/layers/${layerId}/features${qs}`);
  },

  identify: (layerId: string, lon: number, lat: number, sceneId?: string | null) => {
    const qs = new URLSearchParams({ lon: String(lon), lat: String(lat) });
    if (sceneId) qs.set("scene_id", sceneId);
    return getJSON<{ layer_id: string; value: unknown; properties: Record<string, unknown> | null }>(
      `${BASE}/layers/${layerId}/identify?${qs.toString()}`
    );
  },

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

  /** Browse real Planetary Computer scenes for a collection/date-range —
   * this is the FarmScan-style "search, then pick one" flow that replaced
   * the old single-date-anchor picker. Passing `bbox` (the current AOI's
   * extent, when one is selected) narrows results to scenes that actually
   * cover that area — see the note in main.ts on why this matters: Sentinel-2
   * granules are much smaller than Lagos State, so an unfiltered search can
   * return scenes from a neighbouring tile that don't cover the selected
   * ward at all. */
  searchScenes: (params: {
    collection: string;
    startDate: string;
    endDate: string;
    maxCloudCover?: number;
    bbox?: [number, number, number, number];
  }) => {
    const qs = new URLSearchParams({
      collection: params.collection,
      datetime: `${params.startDate}/${params.endDate}`,
      max_cloud_cover: String(params.maxCloudCover ?? 30),
      limit: "20",
    });
    if (params.bbox) qs.set("bbox", params.bbox.join(","));
    return getJSON<STACItem[]>(`${BASE}/imagery/search?${qs.toString()}`);
  },
};
