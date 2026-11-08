import { api } from "./api/client";
import type { BoundarySummary, HazardTheme, Layer, Scenario } from "./types";

/* Shared, cached reference data: hazard themes, scenarios, every published
 * layer and the LGA list. Loaded once and reused by the map, search, the
 * layer library and the data portal. */

export interface Catalogue {
  hazards: HazardTheme[];
  scenarios: Scenario[];
  layers: Layer[];
}

let cataloguePromise: Promise<Catalogue> | null = null;
let lgaPromise: Promise<BoundarySummary[]> | null = null;

export function getCatalogue(): Promise<Catalogue> {
  if (!cataloguePromise) {
    cataloguePromise = Promise.all([api.listHazards(), api.listScenarios(), api.listLayers()])
      .then(([hazards, scenarios, layers]) => ({ hazards, scenarios, layers }))
      .catch((err) => {
        cataloguePromise = null; // allow a retry
        throw err;
      });
  }
  return cataloguePromise;
}

export function getLgas(): Promise<BoundarySummary[]> {
  if (!lgaPromise) {
    lgaPromise = api.listBoundaries("lga").catch((err) => {
      lgaPromise = null;
      throw err;
    });
  }
  return lgaPromise;
}

/** Friendly fallback name for a hazard id when the catalogue isn't loaded. */
export function hazardLabel(id: string, hazards?: HazardTheme[]): string {
  const found = hazards?.find((h) => h.id === id);
  if (found) return found.name;
  return id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const HAZARD_COLORS: Record<string, string> = {
  coastal_flooding: "#4fb3a5",
  riverine_flooding: "#5aa9e6",
  pluvial_flooding: "#7c9cf0",
  compound_flooding: "#9d8cf0",
  coastal_erosion: "#e6b35a",
  extreme_heat: "#f07167",
  drought_water_stress: "#d9a441",
  landslides: "#b98b6e",
  land_subsidence: "#a3a8b8",
};

export function hazardColor(id: string): string {
  return HAZARD_COLORS[id] ?? "#4fb3a5";
}
