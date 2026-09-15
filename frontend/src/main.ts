import "./style.css";
import L from "leaflet";
import { createMap } from "./map/mapInit";
import { LayerManager } from "./map/layerControl";
import { renderLegend } from "./map/legend";
import { setupIdentify } from "./map/identify";
import { BoundaryManager, type AoiSelection } from "./map/boundaries";
import { PolygonDrawTool, type DrawnAoi } from "./map/draw";
import { api } from "./api/client";
import type { HazardTheme, Scenario, Layer, StacItem } from "./types";

type Aoi = AoiSelection | DrawnAoi;

/** Bounding box [minLon, minLat, maxLon, maxLat] of any GeoJSON geometry —
 * used to scope the imagery search to the selected AOI rather than always
 * searching all of Lagos. */
function geometryBbox(geometry: GeoJSON.Geometry): [number, number, number, number] {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  const visit = (coords: any): void => {
    if (typeof coords[0] === "number") {
      const [lon, lat] = coords as [number, number];
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    } else {
      coords.forEach(visit);
    }
  };
  visit((geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon).coordinates);
  return [minLon, minLat, maxLon, maxLat];
}

async function main() {
  const map = createMap("map");
  const layers = new LayerManager(map);
  const boundaryManager = new BoundaryManager(map);
  const drawTool = new PolygonDrawTool(map);

  const hazardSelect = document.getElementById("hazard-select") as HTMLSelectElement;
  const scenarioSelect = document.getElementById("scenario-select") as HTMLSelectElement;
  const imageryDateStart = document.getElementById("imagery-date-start") as HTMLInputElement;
  const imageryDateEnd = document.getElementById("imagery-date-end") as HTMLInputElement;
  const imageryMaxCloud = document.getElementById("imagery-max-cloud") as HTMLInputElement;
  const imagerySearchBtn = document.getElementById("imagery-search-btn") as HTMLButtonElement;
  const imagerySearchStatusEl = document.getElementById("imagery-search-status") as HTMLDivElement;
  const imagerySceneListEl = document.getElementById("imagery-scene-list") as HTMLUListElement;
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

  // --- Imagery search-and-select (live STAC raster layers only) ---
  // Mirrors FarmScan's "search live scenes" flow: pick a date range + max
  // cloud cover, search Planetary Computer, then click a scene from the
  // results to pin the map to it (instead of always showing the
  // auto-picked least-cloudy "most recent" scene).
  imageryDateStart.max = new Date().toISOString().slice(0, 10);
  imageryDateEnd.max = new Date().toISOString().slice(0, 10);

  function showImageryStatus(msg: string, kind: "info" | "error" | "success"): void {
    imagerySearchStatusEl.textContent = msg;
    imagerySearchStatusEl.className = `status-msg show ${kind}`;
  }

  function clearImagerySelection(): void {
    layers.setItemId(null);
    imagerySceneListEl.querySelectorAll("li.selected").forEach((el) => el.classList.remove("selected"));
  }

  function activeStacCollection(): string | null {
    return layers.getTopActiveDetail()?.style?.stac?.collection ?? null;
  }

  function renderSceneList(items: StacItem[]): void {
    imagerySceneListEl.innerHTML = "";
    for (const item of items) {
      const li = document.createElement("li");
      const dateLabel = document.createElement("span");
      dateLabel.textContent = item.datetime ? item.datetime.slice(0, 10) : item.id;
      const cloudLabel = document.createElement("span");
      cloudLabel.className = "cloud";
      cloudLabel.textContent = item.cloud_cover != null ? `☁ ${item.cloud_cover.toFixed(0)}%` : "";
      li.appendChild(dateLabel);
      li.appendChild(cloudLabel);
      if (item.id === layers.getItemId()) li.classList.add("selected");
      li.addEventListener("click", async () => {
        imagerySceneListEl.querySelectorAll("li.selected").forEach((el) => el.classList.remove("selected"));
        li.classList.add("selected");
        layers.setItemId(item.id);
        try {
          await layers.refreshActiveRasterLayers();
          showImageryStatus(`Pinned to the ${dateLabel.textContent} scene.`, "success");
          if (aoiResultEl.textContent) {
            aoiResultEl.textContent = "Imagery scene changed — click \u201cRun analysis\u201d again to refresh this result.";
          }
        } catch (err) {
          showImageryStatus(`Could not load that scene: ${(err as Error).message}`, "error");
        }
      });
      imagerySceneListEl.appendChild(li);
    }
  }

  imagerySearchBtn.addEventListener("click", async () => {
    const collection = activeStacCollection();
    if (!collection) {
      showImageryStatus("Toggle on a live imagery layer (Extreme Heat, Coastal Flooding, or Drought) first.", "error");
      return;
    }
    const startDate = imageryDateStart.value || undefined;
    const endDate = imageryDateEnd.value || undefined;
    if ((startDate && !endDate) || (!startDate && endDate)) {
      showImageryStatus("Pick both a start and end date, or leave both blank for the last 90 days.", "error");
      return;
    }
    const maxCloudCover = Number(imageryMaxCloud.value) || 20;
    const bbox = currentAoi ? geometryBbox(currentAoi.geometry) : undefined;

    imagerySearchBtn.disabled = true;
    showImageryStatus("Searching Planetary Computer…", "info");
    imagerySceneListEl.innerHTML = "";
    try {
      const result = await api.searchImagery({ collection, bbox, startDate, endDate, maxCloudCover, limit: 20 });
      if (!result.items.length) {
        showImageryStatus(
          "No scenes found, even after widening the search window and dropping the cloud-cover filter.",
          "error"
        );
        return;
      }
      if (result.relaxed_search) {
        showImageryStatus(
          `No scenes in that range under ${maxCloudCover}% cloud cover \u2014 widened the search to ` +
            `${result.searched_start} \u2013 ${result.searched_end} with no cloud filter and found ${result.items.length} scene(s).`,
          "info"
        );
      } else {
        showImageryStatus(`Found ${result.items.length} scene(s).`, "success");
      }
      renderSceneList(result.items);
    } catch (err) {
      showImageryStatus(`${(err as Error).message} — the auto-picked most-recent scene is still used if you don't select one.`, "error");
    } finally {
      imagerySearchBtn.disabled = false;
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
        item_id: layers.getItemId() || undefined,
        date: layers.getItemId() ? undefined : layers.getDate() || undefined,
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

  hazardSelect.addEventListener("change", async () => {
    // A different hazard theme almost always means a different (or no)
    // STAC collection, so a previously-picked scene id no longer applies —
    // drop it and let any still-active raster layer fall back to auto-pick.
    clearImagerySelection();
    imagerySceneListEl.innerHTML = "";
    imagerySearchStatusEl.className = "status-msg";
    try {
      await layers.refreshActiveRasterLayers();
    } catch (err) {
      console.error("Could not refresh imagery after hazard change:", err);
    }
    await refreshLayerList();
  });
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
