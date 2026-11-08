import type { Layer, SavedAoiPayload, SavedMapPayload, SearchResult } from "./types";

/* A tiny typed event bus so the shell (search, library, saved items) can ask
 * the map workspace to do things without importing it directly. */

export interface BusEvents {
  /** Zoom to a search result; boundary results also become the AOI. */
  "select-place": SearchResult;
  /** Switch to a layer's hazard and turn the layer on. */
  "add-layer": { hazard: string; layerId: string };
  "open-saved-map": SavedMapPayload;
  "open-saved-aoi": SavedAoiPayload;
  /** The layer catalogue finished loading (for search + library). */
  "catalogue": Layer[];
  /** Reports list changed (an analysis was saved). */
  "reports-changed": void;
}

const target = new EventTarget();

export function emit<K extends keyof BusEvents>(name: K, detail: BusEvents[K]): void {
  target.dispatchEvent(new CustomEvent(name, { detail }));
}

export function on<K extends keyof BusEvents>(name: K, fn: (detail: BusEvents[K]) => void): void {
  target.addEventListener(name, (e) => fn((e as CustomEvent<BusEvents[K]>).detail));
}
