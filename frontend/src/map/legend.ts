import type { LayerDetail } from "../types";

/** CSS gradient stops approximating common matplotlib/TiTiler colormap names.
 * Browsers can't render a named colormap directly, so this is a close visual
 * stand-in for the same ramp TiTiler applies server-side to the tiles. */
const COLORMAP_GRADIENTS: Record<string, string[]> = {
  inferno: ["#000004", "#420a68", "#932667", "#dd513a", "#fca50a", "#fcffa4"],
  magma: ["#000004", "#3b0f70", "#8c2981", "#de4968", "#fe9f6d", "#fcfdbf"],
  plasma: ["#0d0887", "#6a00a8", "#b12a90", "#e16462", "#fca636", "#f0f921"],
  viridis: ["#440154", "#414487", "#2a788e", "#22a884", "#7ad151", "#fde725"],
  rdbu: ["#67001f", "#d6604d", "#f7f7f7", "#4393c3", "#053061"],
  rdylgn: ["#a50026", "#f46d43", "#ffffbf", "#a6d96a", "#006837"],
  coolwarm: ["#3b4cc0", "#93b5fe", "#f7f7f7", "#f6a385", "#b40426"],
  terrain: ["#333399", "#00994d", "#b3d96b", "#e6c35c", "#a0522d", "#ffffff"],
  jet: ["#00007f", "#0000ff", "#00ffff", "#ffff00", "#ff0000", "#7f0000"],
  bwr: ["#0000ff", "#ffffff", "#ff0000"],
  gray: ["#000000", "#ffffff"],
  greys: ["#000000", "#ffffff"],
};

function gradientCss(colormapName: string): string | null {
  const stops = COLORMAP_GRADIENTS[colormapName.toLowerCase()];
  if (!stops) return null;
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

function unitLabel(unit?: string | null): string {
  if (!unit) return "";
  if (unit === "C") return "\u00b0C";
  return unit;
}

function fmtValue(n: number): string {
  return Number(n.toFixed(2)).toString();
}

/** Legend = layer name + colour ramp + min and max value, nothing else (no
 * unit, date or notes). The min/max are the values calculated over the current
 * area (detail.value_range, set by LayerManager from /layers/{id}/range), so
 * the labels always match what the map is actually showing. */
export function renderLegend(container: HTMLElement, detail: LayerDetail | null): void {
  container.innerHTML = "";
  if (!detail) return;

  const style = detail.style;
  let gradient: string | null = null;
  let range: [number, number] | null = null;

  if (style?.breaks && style?.colors) {
    // Pre-rendered layers (JRC): ramp from the layer's own colours; labels
    // only where the catalogue gives a fixed numeric range.
    gradient = `linear-gradient(to right, ${style.colors.join(", ")})`;
    range = style.legend_range ?? null;
  } else if (style?.colormap_name) {
    gradient = gradientCss(style.colormap_name);
    if (detail.value_range) {
      range = detail.value_range;
    } else if (style.rescale) {
      // Fallback if the range couldn't be calculated.
      const [lo, hi] = style.rescale.split(",").map(Number);
      if (Number.isFinite(lo) && Number.isFinite(hi)) range = [lo, hi];
    }
  }
  if (!gradient) return;

  const title = document.createElement("div");
  title.className = "legend-title";
  title.textContent = detail.name;
  container.appendChild(title);

  const unit = unitLabel(detail.unit);
  if (unit) {
    const unitEl = document.createElement("div");
    unitEl.className = "legend-unit";
    unitEl.textContent = `Unit: ${unit}`;
    container.appendChild(unitEl);
  }

  const bar = document.createElement("div");
  bar.className = "legend-bar";
  bar.setAttribute("role", "img");
  bar.setAttribute("aria-label", `Colour ramp for ${detail.name}`);
  bar.style.background = gradient;
  container.appendChild(bar);

  if (range) {
    const labels = document.createElement("div");
    labels.className = "legend-labels";
    const minEl = document.createElement("span");
    minEl.textContent = fmtValue(range[0]);
    const maxEl = document.createElement("span");
    maxEl.textContent = fmtValue(range[1]);
    labels.appendChild(minEl);
    labels.appendChild(maxEl);
    container.appendChild(labels);
  }
}
