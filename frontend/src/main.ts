import "./style.css";
import L from "leaflet";
import { createMap } from "./map/mapInit";
import { LayerManager } from "./map/layerControl";
import { renderLegend } from "./map/legend";
import { setupIdentify } from "./map/identify";
import { BoundaryManager, type AoiSelection } from "./map/boundaries";
import { PolygonDrawTool, type DrawnAoi } from "./map/draw";
import { api } from "./api/client";
import type { HazardTheme, Scenario, Layer } from "./types";

type Aoi = AoiSelection | DrawnAoi;

async function main() {
  const map = createMap("map");
  const layers = new LayerManager(map);
  const boundaryManager = new BoundaryManager(map);
  const drawTool = new PolygonDrawTool(map);

  const hazardSelect = document.getElementById("hazard-select") as HTMLSelectElement;
  const scenarioSelect = document.getElementById("scenario-select") as HTMLSelectElement;
  const sceneDateStart = document.getElementById("scene-date-start") as HTMLInputElement;
  const sceneDateEnd = document.getElementById("scene-date-end") as HTMLInputElement;
  const sceneMaxCloud = document.getElementById("scene-max-cloud") as HTMLInputElement;
  const searchScenesBtn = document.getElementById("search-scenes-btn") as HTMLButtonElement;
  const sceneSearchStatusEl = document.getElementById("scene-search-status") as HTMLDivElement;
  const sceneListEl = document.getElementById("scene-list") as HTMLUListElement;
  const layerListEl = document.getElementById("layer-list") as HTMLUListElement;
  const legendEl = document.getElementById("legend") as HTMLDivElement;
  const identifyResultEl = document.getElementById("identify-result") as HTMLDivElement;
  const searchInput = document.getElementById("search-input") as HTMLInputElement;
  const searchResultsEl = document.getElementById("search-results") as HTMLUListElement;

  const lgaSelect = document.getElementById("boundary-lga-select") as HTMLSelectElement;
  const wardSelect = document.getElementById("boundary-ward-select") as HTMLSelectElement;
  const aoiSummaryEl = document.getElementById("aoi-summary") as HTMLDivElement;
  const aoiResultEl = document.getElementById("aoi-result") as HTMLDivElement;
  const drawBtn = document.getElementById("aoi-draw-btn") as HTMLButtonElement;
  const finishBtn = document.getElementById("aoi-finish-btn") as HTMLButtonElement;
  const cancelBtn = document.getElementById("aoi-cancel-btn") as HTMLButtonElement;
  const clearBtn = document.getElementById("aoi-clear-btn") as HTMLButtonElement;
  const runAnalysisBtn = document.getElementById("aoi-run-analysis-btn") as HTMLButtonElement;

  layers.onLegendChange = (detail) => renderLegend(legendEl, detail);
  setupIdentify(map, layers, identifyResultEl);

  // --- Area of interest: pick a boundary, or draw a custom polygon ---
  let currentAoi: Aoi | null = null;
  let drawnAoiLayer: L.GeoJSON | null = null;

  function clearDrawnAoiLayer(): void {
    if (drawnAoiLayer) {
      map.removeLayer(drawnAoiLayer);
      drawnAoiLayer = null;
    }
  }

  function setAoi(aoi: Aoi): void {
    currentAoi = aoi;
    clearDrawnAoiLayer();

    if (aoi.source === "drawn") {
      // A custom polygon replaces any ward highlight — but selectWard()
      // already owns its own layer swap, so only clear here for the
      // "drawn" branch; clearing unconditionally would wipe out a ward
      // highlight the instant selectWard() just added it.
      boundaryManager.clearSelection();
      wardSelect.value = "";
      drawnAoiLayer = L.geoJSON(aoi.geometry, {
        style: { color: "#f472b6", weight: 2, fillOpacity: 0.1 },
      }).addTo(map);
      aoiSummaryEl.textContent = "Custom drawn area";
    } else {
      aoiSummaryEl.textContent = `${aoi.level.toUpperCase()}: ${aoi.name}`;
    }

    clearBtn.hidden = false;
    runAnalysisBtn.disabled = !layers.getTopActiveLayerId();
    aoiResultEl.textContent = "";
  }

  function clearAoi(): void {
    currentAoi = null;
    boundaryManager.clearSelection();
    clearDrawnAoiLayer();
    aoiSummaryEl.textContent = "No area selected. Pick a ward, or draw your own.";
    clearBtn.hidden = true;
    runAnalysisBtn.disabled = true;
    aoiResultEl.textContent = "";
  }

  boundaryManager.onSelect = (aoi) => setAoi(aoi);

  drawBtn.addEventListener("click", () => {
    drawTool.start();
    drawBtn.hidden = true;
    finishBtn.hidden = false;
    cancelBtn.hidden = false;
    aoiSummaryEl.textContent = "Click the map to place vertices (need at least 3).";
  });

  drawTool.onChange = (count) => {
    aoiSummaryEl.textContent = `Drawing your area — ${count} point${count === 1 ? "" : "s"} placed.`;
  };

  finishBtn.addEventListener("click", () => {
    const result = drawTool.finish();
    drawBtn.hidden = false;
    finishBtn.hidden = true;
    cancelBtn.hidden = true;
    if (!result) {
      alert("Place at least 3 points before finishing.");
      if (!currentAoi) aoiSummaryEl.textContent = "No area selected. Pick a ward, or draw your own.";
      return;
    }
    setAoi(result);
  });

  cancelBtn.addEventListener("click", () => {
    drawTool.cancel();
    drawBtn.hidden = false;
    finishBtn.hidden = true;
    cancelBtn.hidden = true;
    if (!currentAoi) aoiSummaryEl.textContent = "No area selected. Pick a ward, or draw your own.";
  });

  clearBtn.addEventListener("click", () => {
    wardSelect.value = "";
    clearAoi();
  });

  // --- Admin boundary cascade: State (Lagos, fixed) -> LGA -> Ward ---
  boundaryManager.loadStateContext().catch((err) => {
    console.error("Could not load the Lagos state outline:", err);
  });

  function resetWardOptions(placeholder: string, disabled: boolean): void {
    wardSelect.innerHTML = `<option value="">${placeholder}</option>`;
    wardSelect.disabled = disabled;
  }

  try {
    const lgas = await boundaryManager.listLgas();
    lgaSelect.innerHTML =
      `<option value="">Select LGA…</option>` +
      lgas.map((l) => `<option value="${l.code}">${l.name}</option>`).join("");
  } catch (err) {
    lgaSelect.innerHTML = `<option value="">Could not load LGAs</option>`;
  }

  lgaSelect.addEventListener("change", async () => {
    const lgaCode = lgaSelect.value;
    wardSelect.value = "";
    clearAoi();

    if (!lgaCode) {
      await boundaryManager.showLgaContext(null);
      resetWardOptions("Select an LGA first…", true);
      return;
    }

    lgaSelect.disabled = true;
    resetWardOptions("Loading wards…", true);
    try {
      const [wards] = await Promise.all([
        boundaryManager.listWards(lgaCode),
        boundaryManager.showLgaContext(lgaCode),
      ]);
      wardSelect.innerHTML =
        `<option value="">Select ward…</option>` +
        wards.map((w) => `<option value="${w.code}">${w.name}</option>`).join("");
      wardSelect.disabled = false;
    } catch (err) {
      resetWardOptions("Could not load wards", true);
      alert(`Could not load wards for this LGA: ${(err as Error).message}`);
    } finally {
      lgaSelect.disabled = false;
    }
  });

  wardSelect.addEventListener("change", async () => {
    const wardCode = wardSelect.value;
    if (!wardCode) {
      clearAoi();
      return;
    }
    wardSelect.disabled = true;
    try {
      await boundaryManager.selectWard(wardCode);
    } catch (err) {
      wardSelect.value = "";
      alert(`Could not load this ward's boundary: ${(err as Error).message}`);
    } finally {
      wardSelect.disabled = false;
    }
  });

  // --- Imagery scene browser (live STAC raster layers only) ---
  // Replaces the old single-date-anchor picker with a FarmScan-style flow:
  // search a date range, see every real scene that matched (date + cloud
  // cover), and pick exactly one rather than trusting an auto-pick.
  const todayStr = new Date().toISOString().slice(0, 10);
  sceneDateStart.max = todayStr;
  sceneDateEnd.max = todayStr;

  function formatSceneDate(iso: string | null | undefined): string {
    if (!iso) return "unknown date";
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function renderSceneList(scenes: { id: string; datetime?: string | null; cloud_cover?: number | null }[]): void {
    sceneListEl.innerHTML = "";
    for (const scene of scenes) {
      const li = document.createElement("li");
      const dateSpan = document.createElement("span");
      dateSpan.textContent = formatSceneDate(scene.datetime);
      const cloudSpan = document.createElement("span");
      cloudSpan.className = "scene-cloud";
      cloudSpan.textContent =
        scene.cloud_cover !== undefined && scene.cloud_cover !== null ? `☁ ${scene.cloud_cover.toFixed(0)}%` : "";
      li.appendChild(dateSpan);
      li.appendChild(cloudSpan);
      li.addEventListener("click", async () => {
        sceneListEl.querySelectorAll("li").forEach((x) => x.classList.remove("selected"));
        li.classList.add("selected");
        sceneSearchStatusEl.textContent = "Loading selected scene...";
        try {
          layers.setSceneId(scene.id);
          await layers.refreshActiveRasterLayers();
          sceneSearchStatusEl.textContent = `Showing ${formatSceneDate(scene.datetime)}.`;
          if (aoiResultEl.textContent) {
            aoiResultEl.textContent = "Imagery scene changed — click \u201cRun analysis\u201d again to refresh this result.";
          }
        } catch (err) {
          sceneSearchStatusEl.textContent = `Could not load that scene: ${(err as Error).message}`;
        }
      });
      sceneListEl.appendChild(li);
    }
  }

  searchScenesBtn.addEventListener("click", async () => {
    const activeDetail = layers.getTopActiveDetail();
    const collection = activeDetail?.style?.stac?.collection;
    if (!collection) {
      sceneSearchStatusEl.textContent =
        "Toggle on a live layer first (Extreme Heat, Coastal Flooding, or Drought) — this searches whichever one is active.";
      sceneListEl.innerHTML = "";
      return;
    }

    // Default to the last 90 days if the user hasn't picked a range —
    // matches the recipes' own default lookback window.
    const end = sceneDateEnd.value || todayStr;
    const start =
      sceneDateStart.value ||
      new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const maxCloudCover = Number(sceneMaxCloud.value) || 30;

    searchScenesBtn.disabled = true;
    sceneSearchStatusEl.textContent = "Searching the satellite catalog...";
    sceneListEl.innerHTML = "";
    try {
      const scenes = await api.searchScenes({ collection, startDate: start, endDate: end, maxCloudCover });
      if (scenes.length === 0) {
        sceneSearchStatusEl.textContent = "No scenes found for that range/cloud filter — try widening it.";
        return;
      }
      sceneSearchStatusEl.textContent = `Found ${scenes.length} scene(s) for ${activeDetail!.name} — pick one.`;
      renderSceneList(scenes);
    } catch (err) {
      sceneSearchStatusEl.textContent = `Search failed: ${(err as Error).message}`;
    } finally {
      searchScenesBtn.disabled = false;
    }
  });

  runAnalysisBtn.addEventListener("click", async () => {
    const layerId = layers.getTopActiveLayerId();
    if (!layerId || !currentAoi) return;
    const activeDetail = layers.getTopActiveDetail();
    // Vector layers carry a `risk_class` property per feature, so
    // "area by class" is meaningful; raster layers (continuous pixel
    // values like temperature or NDWI) have no such classes, so those
    // request a plain numeric zonal-stats summary instead.
    const operation = activeDetail?.layer_type === "vector" ? "area_by_class" : "zonal_stats";
    runAnalysisBtn.disabled = true;
    aoiResultEl.textContent = "Running analysis...";
    try {
      const result = await api.runAnalysis({
        layer_id: layerId,
        geometry: currentAoi.geometry,
        operation,
        scene_id: layers.getSceneId() ?? undefined,
      });
      const lines =
        operation === "zonal_stats"
          ? [`${result.feature_count} valid pixel(s) sampled in this area`, `Area: ${result.area_km2} km²`]
          : [`${result.feature_count} feature(s) intersect this area`, `Total area: ${result.area_km2} km²`];
      if (result.observed_at) {
        lines.push(`Imagery date: ${result.observed_at.slice(0, 10)}`);
      }
      if (result.relaxed_search) {
        lines.push("(No cloud-free scene near the requested date — widened the search window.)");
      }
      if (result.by_class) {
        lines.push("By class:");
        for (const [cls, area] of Object.entries(result.by_class)) {
          lines.push(`  ${cls}: ${area} km²`);
        }
      }
      if (result.values) {
        lines.push("Pixel value summary:");
        for (const [stat, val] of Object.entries(result.values)) {
          lines.push(`  ${stat}: ${val}`);
        }
      }
      aoiResultEl.textContent = lines.join("\n");
    } catch (err) {
      aoiResultEl.textContent = `Analysis unavailable: ${(err as Error).message}`;
    } finally {
      runAnalysisBtn.disabled = false;
    }
  });

  // --- Hazard & scenario selectors ---
  let hazards: HazardTheme[] = [];
  let scenarios: Scenario[] = [];

  try {
    [hazards, scenarios] = await Promise.all([api.listHazards(), api.listScenarios()]);
  } catch (err) {
    layerListEl.innerHTML = `<li style="color:#f87171">Could not reach the API (${(err as Error).message}). Is the backend running?</li>`;
    return;
  }

  hazardSelect.innerHTML = hazards
    .map((h) => `<option value="${h.id}">${h.name}</option>`)
    .join("");
  scenarioSelect.innerHTML =
    `<option value="">All scenarios</option>` +
    scenarios.map((s) => `<option value="${s.id}">${s.label}</option>`).join("");

  async function refreshLayerList() {
    const hazard = hazardSelect.value || undefined;
    const scenario = scenarioSelect.value || undefined;
    const layerCatalogue: Layer[] = await api.listLayers({ hazard, scenario });

    layerListEl.innerHTML = "";
    if (!layerCatalogue.length) {
      layerListEl.innerHTML = '<li style="color:#6b7280">No published layers for this selection yet.</li>';
      return;
    }

    for (const layer of layerCatalogue) {
      const li = document.createElement("li");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = layers.isActive(layer.id);
      checkbox.addEventListener("change", async () => {
        checkbox.disabled = true;
        // A pinned scene_id is only meaningful for the collection it was
        // searched against — toggling the layer selection at all resets it,
        // so a Sentinel-2 scene picked for Coastal Flooding can't get sent
        // to Landsat's collection when Extreme Heat becomes active instead
        // (that would 404: the id doesn't exist in that collection).
        layers.setSceneId(null);
        sceneListEl.innerHTML = "";
        sceneSearchStatusEl.textContent = "";
        try {
          await layers.toggle(layer.id);
        } catch (err) {
          checkbox.checked = false;
          alert((err as Error).message);
        } finally {
          checkbox.disabled = false;
          runAnalysisBtn.disabled = !currentAoi || !layers.getTopActiveLayerId();
        }
      });
      const label = document.createElement("span");
      label.textContent = `${layer.name} (${layer.layer_type})`;
      li.appendChild(checkbox);
      li.appendChild(label);
      layerListEl.appendChild(li);
    }
  }

  hazardSelect.addEventListener("change", refreshLayerList);
  scenarioSelect.addEventListener("change", refreshLayerList);
  await refreshLayerList();

  // --- Search / zoom-to-administrative-area (now covers state + all LGAs + wards) ---
  let searchTimeout: number | undefined;
  searchInput.addEventListener("input", () => {
    window.clearTimeout(searchTimeout);
    const q = searchInput.value.trim();
    if (q.length < 2) {
      searchResultsEl.innerHTML = "";
      return;
    }
    searchTimeout = window.setTimeout(async () => {
      const results = await api.search(q);
      searchResultsEl.innerHTML = "";
      for (const r of results) {
        const li = document.createElement("li");
        li.textContent = r.label;
        li.addEventListener("click", async () => {
          searchResultsEl.innerHTML = "";
          searchInput.value = r.label;
          if (r.bbox) {
            map.fitBounds([
              [r.bbox[1], r.bbox[0]],
              [r.bbox[3], r.bbox[2]],
            ]);
          } else {
            map.setView([r.lat, r.lon], 13);
          }
          if (r.level && r.code) {
            const feature = await api.getBoundaryFeature(r.level, r.code);
            setAoi({ source: "boundary", level: r.level, code: r.code, name: r.label, geometry: feature.geometry! });
          }
        });
        searchResultsEl.appendChild(li);
      }
    }, 250);
  });
}

main();
