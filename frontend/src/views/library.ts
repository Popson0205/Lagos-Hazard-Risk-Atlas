import { emit } from "../bus";
import { getCatalogue } from "../catalogue";
import { go, onShow } from "../router";
import type { Layer } from "../types";
import { escapeHtml, renderState, showSkeleton } from "../ui";

/* Layer Library: the whole published catalogue, grouped by hazard theme,
 * with a one-click "Open in map". Themes without layers are listed as
 * "in preparation" so nobody hunts for data that doesn't exist yet. */

function unitLabel(u?: string | null): string {
  return u === "C" ? "°C" : u ?? "";
}

function card(l: Layer, hazardName: string): string {
  const rows = [
    ["Source", l.source],
    ["Resolution", l.resolution],
    ["Unit", unitLabel(l.unit)],
    ["Published", l.date_published ? new Date(l.date_published).toLocaleDateString(undefined, { year: "numeric", month: "short" }) : null],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(String(v))}</dd>`)
    .join("");
  return `<article class="lib-card" data-name="${escapeHtml(`${l.name} ${hazardName}`.toLowerCase())}">
    <p class="modal-eyebrow">${escapeHtml(hazardName)}</p>
    <h3>${escapeHtml(l.name)}</h3>
    <div class="layer-chips">
      <span class="chip">${l.layer_type === "raster" ? "Satellite imagery" : "Risk zones"}</span>
      ${l.style?.stac ? '<span class="chip live">Recent scene</span>' : ""}
    </div>
    ${rows ? `<dl>${rows}</dl>` : ""}
    ${l.methodology ? `<p title="${escapeHtml(l.methodology)}">${escapeHtml(l.methodology)}</p>` : ""}
    <button type="button" class="btn btn-outline" data-open="${escapeHtml(l.id)}" data-hazard="${escapeHtml(l.hazard_theme_id)}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/></svg>Open in map
    </button>
  </article>`;
}

async function render(): Promise<void> {
  const body = document.getElementById("library-body")!;
  if (body.dataset.loaded) return;
  showSkeleton(body, 4);
  try {
    const { hazards, layers } = await getCatalogue();
    const ready = hazards.filter((h) => layers.some((l) => l.hazard_theme_id === h.id));
    const pending = hazards.filter((h) => !ready.includes(h));
    body.innerHTML =
      `<section class="lib-group" data-group><div class="lib-group-head"><h2>Published layers</h2><span>${layers.length} across ${ready.length} hazard themes</span></div>
        <div class="lib-grid">${ready
          .flatMap((h) => layers.filter((l) => l.hazard_theme_id === h.id).map((l) => card(l, h.name)))
          .join("")}</div></section>` +
      (pending.length
        ? `<section class="lib-group" data-group><div class="lib-group-head"><h2>In preparation</h2><span>No published layer yet</span></div>
            <div class="lib-grid">${pending
              .map(
                (h) => `<article class="lib-card pending" data-name="${escapeHtml(h.name.toLowerCase())}"><p class="modal-eyebrow">${escapeHtml(
                  h.name
                )}</p><p>${escapeHtml(h.description ?? "This theme is still being prepared. Its data pipeline isn't published yet.")}</p></article>`
              )
              .join("")}</div></section>`
        : "");
    body.dataset.loaded = "1";
  } catch (err) {
    renderState(body, "error", "Couldn't load the layer catalogue", (err as Error).message, {
      label: "Try again",
      run: () => void render(),
    });
  }
}

export function initLibrary(): void {
  const body = document.getElementById("library-body")!;
  const filter = document.getElementById("library-filter") as HTMLInputElement;
  body.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-open]");
    if (!btn) return;
    go("map");
    emit("add-layer", { hazard: btn.dataset.hazard!, layerId: btn.dataset.open! });
  });
  filter.addEventListener("input", () => {
    const q = filter.value.trim().toLowerCase();
    body.querySelectorAll<HTMLElement>("[data-group]").forEach((group) => {
      let any = false;
      group.querySelectorAll<HTMLElement>(".lib-card").forEach((c) => {
        const show = !q || (c.dataset.name ?? "").includes(q);
        c.hidden = !show;
        any ||= show;
      });
      group.hidden = !any;
    });
  });
  onShow("library", () => void render());
}
