import type { LayerDetail } from "../types";

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
    const row = document.createElement("div");
    row.textContent = `Colormap: ${style.colormap_name}${style.rescale ? ` (range ${style.rescale})` : ""}`;
    container.appendChild(row);
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
