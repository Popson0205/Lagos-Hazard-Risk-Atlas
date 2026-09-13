import "./style.css";
import L from "leaflet";
import { createMap } from "./map/mapInit";
import { LayerManager } from "./map/layerControl";
import { renderLegend } from "./map/legend";
import { setupIdentify } from "./map/identify";
import { BoundaryManager, type AoiSelection } from "./map/boundaries";
import { PolygonDrawTool, type DrawnAoi } from "./map/draw";
import { api } from "./api/client";
import type { HazardTheme, Scenario, Layer, BoundaryLevel } from "./types";

type Aoi = AoiSelection | DrawnAoi;

async function main() {
  const map = createMap("map");
  const layers = new LayerManager(map);
  const boundaryManager = new BoundaryManager(map);
  const drawTool = new PolygonDrawTool(map);

  const hazardSelect = document.getElementById("hazard-select") as HTMLSelectElement;
  const scenarioSelect = document.getElementById("scenario-select") as HTMLSelectElement;
  const layerListEl = document.getElementById("layer-list") as HTMLUListElement;
  const legendEl = document.getElementById("legend") as HTMLDivElement;
  const identifyResultEl = document.getElementById("identify-result") as HTMLDivElement;
  const searchInput = document.getElementById("search-input") as HTMLInputElement;
  const searchResultsEl = document.getElementById("search-results") as HTMLUListElement;

  const boundaryToggles: Record<BoundaryLevel, HTMLInputElement> = {
    state: document.getElementById("boundary-toggle-state") as HTMLInputElement,
    lga: document.getElementById("boundary-toggle-lga") as HTMLInputElement,
    ward: document.getElementById("boundary-toggle-ward") as HTMLInputElement,
  };
  const aoiSummaryEl = document.getElementById("aoi-summary") as HTMLDivElement;
  const aoiResultEl = document.getElementById("aoi-result") as HTMLDivElement;
  const drawBtn = document.getElementById("aoi-draw-btn") as HTMLButtonElement;
  const finishBtn = document.getElementById("aoi-finish-btn") as HTMLButtonElement;
  const cancelBtn = document.getElementById("aoi-cancel-btn") as HTMLButtonElement;
  const clearBtn = document.getElementById("aoi-clear-btn") as HTMLButtonElement;
  const runAnalysisBtn = document.getElementById("aoi-run-analysis-btn") as HTMLButtonElement;

  layers.onLegendChange = (detail) => renderLegend(legendEl, detail);
  setupIdentify(map, layers, identifyResultEl);

  // --- Admin boundary overlays (State / LGA / Ward) ---
  (Object.keys(boundaryToggles) as BoundaryLevel[]).forEach((level) => {
    boundaryToggles[level].addEventListener("change", async () => {
      const el = boundaryToggles[level];
      el.disabled = true;
      try {
        await boundaryManager.toggle(level);
      } catch (err) {
        el.checked = false;
        alert(`Could not load ${level} boundaries: ${(err as Error).message}`);
      } finally {
        el.disabled = false;
      }
    });
  });

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
    boundaryManager.clearSelection();
    clearDrawnAoiLayer();

    if (aoi.source === "drawn") {
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
    aoiSummaryEl.textContent = "No area selected. Click a boundary, or draw your own.";
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
      if (!currentAoi) aoiSummaryEl.textContent = "No area selected. Click a boundary, or draw your own.";
      return;
    }
    setAoi(result);
  });

  cancelBtn.addEventListener("click", () => {
    drawTool.cancel();
    drawBtn.hidden = false;
    finishBtn.hidden = true;
    cancelBtn.hidden = true;
    if (!currentAoi) aoiSummaryEl.textContent = "No area selected. Click a boundary, or draw your own.";
  });

  clearBtn.addEventListener("click", clearAoi);

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
      });
      const lines =
        operation === "zonal_stats"
          ? [`${result.feature_count} valid pixel(s) sampled in this area`, `Area: ${result.area_km2} km²`]
          : [`${result.feature_count} feature(s) intersect this area`, `Total area: ${result.area_km2} km²`];
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
