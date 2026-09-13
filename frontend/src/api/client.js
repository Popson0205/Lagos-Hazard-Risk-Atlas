const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api/v1";

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, options);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${body}`);
  }
  return res.json();
}

export const api = {
  getHazards: () => request("/hazards"),
  getScenarios: () => request("/scenarios"),
  getLayers: ({ hazardId, scenarioId } = {}) => {
    const params = new URLSearchParams();
    if (hazardId) params.set("hazard_id", hazardId);
    if (scenarioId) params.set("scenario_id", scenarioId);
    const qs = params.toString();
    return request(`/layers${qs ? `?${qs}` : ""}`);
  },
  getLayerFeatures: (layerId, bbox) => {
    const params = new URLSearchParams();
    if (bbox) params.set("bbox", bbox);
    const qs = params.toString();
    return request(`/layers/${layerId}/features${qs ? `?${qs}` : ""}`);
  },
  identify: (layerId, lon, lat) =>
    request(`/layers/${layerId}/identify?lon=${lon}&lat=${lat}`),
  searchImagery: ({ bbox, collection = "sentinel-2-l2a", maxCloudCover = 20 } = {}) => {
    const params = new URLSearchParams({ collection, max_cloud_cover: maxCloudCover });
    if (bbox) params.set("bbox", bbox);
    return request(`/imagery/search?${params.toString()}`);
  },
};
