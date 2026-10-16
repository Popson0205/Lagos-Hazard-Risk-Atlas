import L from "leaflet";
import { api } from "../api/client";
import type { LayerManager } from "./layerControl";
import { escapeHtml } from "../ui";

function fmt(v: unknown): string {
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(3)));
  if (v === null || v === undefined) return "\u2014";
  return String(v);
}

function unitLabel(unit?: string | null): string {
  if (!unit) return "";
  return unit === "C" ? "\u00b0C" : unit;
}

/** Wires the "click map -> show value/metadata" identify tool. The answer
 * opens as a popup right where the user clicked (instead of far away in the
 * sidebar), and is mirrored in the sidebar's "Inspect a point" step.
 * Vector layers do an ST_Contains lookup; raster layers proxy to TiTiler's
 * /stac/point or /cog/point for a real pixel value (backend routers/features.py). */
export function setupIdentify(map: L.Map, layers: LayerManager, resultEl: HTMLElement): void {
  map.on("click", async (e: L.LeafletMouseEvent) => {
    const layerId = layers.getTopActiveLayerId();
    if (!layerId) {
      resultEl.textContent = "Switch on a map layer first, then click the map.";
      return;
    }
    const detail = layers.getTopActiveDetail();
    const name = detail?.name ?? "Selected layer";
    const unit = unitLabel(detail?.unit);

    const popup = L.popup({ maxWidth: 280 })
      .setLatLng(e.latlng)
      .setContent('<div class="identify-pop"><div class="inline-status"><span class="spinner"></span><span>Reading value\u2026</span></div></div>')
      .openOn(map);
    resultEl.textContent = "Reading value\u2026";

    try {
      // Pass the pinned scene (if any) so the value matches what is on screen.
      const result = await api.identify(layerId, e.latlng.lng, e.latlng.lat, layers.getSceneId());
      if (!result.properties && result.value === null) {
        popup.setContent(`<div class="identify-pop"><strong>${escapeHtml(name)}</strong>No data at this spot. Try a point inside the shaded area.</div>`);
        resultEl.textContent = "No data at this location.";
        return;
      }
      const v = result.properties ?? result.value;
      let body: string;
      let plain: string;
      if (v !== null && typeof v === "object") {
        const rows = Object.entries(v as Record<string, unknown>)
          .map(([k, val]) => `<dt>${escapeHtml(k.replace(/_/g, " "))}</dt><dd>${escapeHtml(fmt(val))}</dd>`)
          .join("");
        body = `<dl>${rows}</dl>`;
        plain = JSON.stringify(v);
      } else {
        body = `<span class="identify-value">${escapeHtml(fmt(v))}${unit ? " " + escapeHtml(unit) : ""}</span>`;
        plain = `${fmt(v)} ${unit}`.trim();
      }
      popup.setContent(
        `<div class="identify-pop"><strong>${escapeHtml(name)}</strong>${body}<div class="hint" style="margin:6px 0 0">${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}</div></div>`
      );
      resultEl.textContent = `${name}: ${plain}`;
    } catch (err) {
      popup.setContent(
        `<div class="identify-pop"><strong>Couldn't read this point</strong>${escapeHtml((err as Error).message)}. This layer may not support point lookups yet.</div>`
      );
      resultEl.textContent = "Point lookup isn't available for this layer yet.";
    }
  });
}
