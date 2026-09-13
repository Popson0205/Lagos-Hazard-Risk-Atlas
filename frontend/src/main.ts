import "./style.css";
import { createMap } from "./map/mapInit";
import { LayerManager } from "./map/layerControl";
import { renderLegend } from "./map/legend";
import { setupIdentify } from "./map/identify";
import { api } from "./api/client";
import type { HazardTheme, Scenario, Layer } from "./types";

async function main() {
  const map = createMap("map");
  const layers = new LayerManager(map);

  const hazardSelect = document.getElementById("hazard-select") as HTMLSelectElement;
  const scenarioSelect = document.getElementById("scenario-select") as HTMLSelectElement;
  const layerListEl = document.getElementById("layer-list") as HTMLUListElement;
  const legendEl = document.getElementById("legend") as HTMLDivElement;
  const identifyResultEl = document.getElementById("identify-result") as HTMLDivElement;
  const searchInput = document.getElementById("search-input") as HTMLInputElement;
  const searchResultsEl = document.getElementById("search-results") as HTMLUListElement;

  layers.onLegendChange = (detail) => renderLegend(legendEl, detail);
  setupIdentify(map, layers, identifyResultEl);

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

  // --- Search / zoom-to-administrative-area ---
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
        li.addEventListener("click", () => {
          map.setView([r.lat, r.lon], 13);
          searchResultsEl.innerHTML = "";
          searchInput.value = r.label;
        });
        searchResultsEl.appendChild(li);
      }
    }, 250);
  });
}

main();
