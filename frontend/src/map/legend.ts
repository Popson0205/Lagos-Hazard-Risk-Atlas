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
  jet: ["#00007f", "#0000ff", "#00ffff", "#ffff00", "#ff0000", "#7f0000"],
  gray: ["#000000", "#ffffff"],
  greys: ["#000000", "#ffffff"],
};

function gradientCss(colormapName: string): string | null {
  const stops = COLORMAP_GRADIENTS[colormapName.toLowerCase()];
  if (!stops) return null;
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

/** Renders the legend panel for the currently-selected layer, driven by
 * backend-supplied style/classification metadata (architecture doc section 8:
 * "Legend driven by backend metadata and classification rules"). */
export function renderLegend(container: HTMLElement, detail: LayerDetail | null): void {
  container.innerHTML = "";

  if (!detail) {
    container.innerHTML = '<span style="color:#6b7280">No active layer selected.</span>';
    return;
  }

  const title = document.createElement("div");
  title.textContent = detail.name;
  title.style.fontWeight = "600";
  title.style.marginBottom = "6px";
  container.appendChild(title);

  if (detail.unit) {
    const unit = document.createElement("div");
    unit.textContent = `Unit: ${detail.unit}`;
    unit.style.color = "#9ca3af";
    unit.style.marginBottom = "6px";
    container.appendChild(unit);
  }

  const style = detail.style;
  if (style?.breaks && style?.colors) {
    style.breaks.forEach((brk, i) => {
      const row = document.createElement("div");
      const swatch = document.createElement("span");
      swatch.className = "legend-swatch";
      swatch.style.background = style.colors![i] ?? "#666";
      row.appendChild(swatch);
      row.appendChild(document.createTextNode(`${brk}`));
      container.appendChild(row);
    });
  } else if (style?.colormap_name) {
    const gradient = gradientCss(style.colormap_name);
    if (gradient) {
      const [min, max] = (style.rescale ?? "").split(",");
      const bar = document.createElement("div");
      bar.style.height = "14px";
      bar.style.borderRadius = "3px";
      bar.style.background = gradient;
      bar.style.marginBottom = "4px";
      container.appendChild(bar);

      if (min !== undefined && max !== undefined) {
        const labels = document.createElement("div");
        labels.style.display = "flex";
        labels.style.justifyContent = "space-between";
        labels.style.fontSize = "0.85em";
        labels.style.color = "#9ca3af";
        labels.style.marginBottom = "6px";
        const minEl = document.createElement("span");
        minEl.textContent = min.trim();
        const maxEl = document.createElement("span");
        maxEl.textContent = max.trim();
        labels.appendChild(minEl);
        labels.appendChild(maxEl);
        container.appendChild(labels);
      }
    } else {
      const row = document.createElement("div");
      row.textContent = `Colormap: ${style.colormap_name}${style.rescale ? ` (range ${style.rescale})` : ""}`;
      container.appendChild(row);
    }
  }

  if (detail.observed_at) {
    const observed = document.createElement("div");
    observed.style.marginTop = "6px";
    observed.style.fontSize = "0.85em";
    observed.style.color = "#a3e635";
    const dateStr = detail.observed_at.slice(0, 10);
    const cloudStr =
      detail.cloud_cover !== undefined && detail.cloud_cover !== null
        ? ` · ${detail.cloud_cover.toFixed(0)}% cloud cover`
        : "";
    observed.textContent = `Imagery date: ${dateStr}${cloudStr}`;
    container.appendChild(observed);
  }

  if (detail.methodology) {
    const meth = document.createElement("div");
    meth.style.marginTop = "8px";
    meth.style.fontStyle = "italic";
    meth.style.color = "#9ca3af";
    meth.textContent = detail.methodology;
    container.appendChild(meth);
  }
}
