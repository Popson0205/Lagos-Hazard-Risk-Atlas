import type { Layer } from "./types";

/* ==========================================================================
   UI layer: everything about how the atlas *feels* that isn't map logic.
   main.ts keeps the data flow; this file owns states, feedback, a11y,
   the mobile sheet, theme and the layer cards.
   ========================================================================== */

const $ = <T extends HTMLElement = HTMLElement>(id: string): T | null => document.getElementById(id) as T | null;

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode or storage disabled: fine, it only skips remembering */
    }
  },
};

export function escapeHtml(s: string): string {
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(s).replace(/[&<>"']/g, (c) => map[c]);
}

/* ---------- Feedback: toasts, states, spinners, skeletons ---------- */

export function toast(message: string, kind: "info" | "success" | "error" = "info", ms = 4500): () => void {
  const host = $("toast-host");
  if (!host) return () => {};
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  el.setAttribute("role", kind === "error" ? "alert" : "status");
  const text = document.createElement("span");
  text.textContent = message;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "toast-close";
  close.setAttribute("aria-label", "Dismiss message");
  close.textContent = "\u00d7";
  const dismiss = () => {
    if (!el.isConnected) return;
    el.classList.add("leaving");
    window.setTimeout(() => el.remove(), 160);
  };
  close.addEventListener("click", dismiss);
  el.append(text, close);
  host.appendChild(el);
  if (ms > 0) window.setTimeout(dismiss, ms);
  return dismiss;
}

export function renderState(
  container: HTMLElement,
  kind: "empty" | "error" | "info",
  title: string,
  text: string,
  action?: { label: string; run: () => void }
): void {
  container.innerHTML = "";
  const wrap = document.createElement(container.tagName === "UL" ? "li" : "div");
  wrap.className = `state state-${kind}`;
  if (kind === "error") wrap.setAttribute("role", "alert");
  const h = document.createElement("strong");
  h.textContent = title;
  const p = document.createElement("span");
  p.textContent = text;
  wrap.append(h, p);
  if (action) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn-quiet";
    b.textContent = action.label;
    b.addEventListener("click", action.run);
    wrap.appendChild(b);
  }
  container.appendChild(wrap);
}

export function showSkeleton(container: HTMLElement, rows = 3): void {
  container.innerHTML = "";
  for (let i = 0; i < rows; i++) {
    const el = document.createElement(container.tagName === "UL" ? "li" : "div");
    el.className = "skeleton";
    el.setAttribute("aria-hidden", "true");
    container.appendChild(el);
  }
}

export function spinnerHtml(label: string): string {
  return `<div class="inline-status" role="status"><span class="spinner" aria-hidden="true"></span><span>${escapeHtml(label)}</span></div>`;
}

export function setBusy(button: HTMLButtonElement, busy: boolean): void {
  button.setAttribute("aria-busy", busy ? "true" : "false");
}

/* ---------- Layer cards ---------- */

export interface LayerCard {
  li: HTMLLIElement;
  checkbox: HTMLInputElement;
  /** Re-sync the "on" styling with the checkbox (after a failed toggle). */
  sync(): void;
  setLoading(loading: boolean): void;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function buildLayerCard(
  layer: Layer,
  checked: boolean,
  opacity: number,
  onOpacity: (value: number) => void
): LayerCard {
  const li = document.createElement("li");
  li.className = "layer-card";
  li.dataset.name = layer.name;

  const row = document.createElement("div");
  row.className = "layer-row";

  const label = document.createElement("label");
  label.className = "switch-row";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "switch";
  checkbox.checked = checked;
  const name = document.createElement("span");
  name.className = "layer-name";
  name.textContent = layer.name;
  label.append(checkbox, name);

  const infoId = `layer-info-${layer.id}`;
  const infoBtn = document.createElement("button");
  infoBtn.type = "button";
  infoBtn.className = "layer-info-btn";
  infoBtn.textContent = "i";
  infoBtn.setAttribute("aria-label", `About ${layer.name}`);
  infoBtn.setAttribute("aria-expanded", "false");
  infoBtn.setAttribute("aria-controls", infoId);
  row.append(label, infoBtn);

  const chips = document.createElement("div");
  chips.className = "layer-chips";
  const kind = document.createElement("span");
  kind.className = "chip";
  kind.textContent = layer.layer_type === "raster" ? "Satellite imagery" : "Risk zones";
  chips.appendChild(kind);
  if (layer.style?.stac) {
    const live = document.createElement("span");
    live.className = "chip live";
    live.textContent = "Recent scene";
    chips.appendChild(live);
  }

  const info = document.createElement("div");
  info.className = "layer-info";
  info.id = infoId;
  info.hidden = true;
  const dl = document.createElement("dl");
  const addRow = (k: string, v?: string | null) => {
    if (!v) return;
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    dl.append(dt, dd);
  };
  addRow("Source", layer.source);
  addRow("Detail", layer.resolution ? `${layer.resolution} per pixel` : null);
  addRow("Unit", layer.unit);
  info.appendChild(dl);
  if (layer.methodology) {
    const about = document.createElement("p");
    about.className = "layer-about";
    about.textContent = layer.methodology;
    info.appendChild(about);
  }
  infoBtn.addEventListener("click", () => {
    const open = infoBtn.getAttribute("aria-expanded") !== "true";
    infoBtn.setAttribute("aria-expanded", String(open));
    info.hidden = !open;
  });

  const opacityRow = document.createElement("div");
  opacityRow.className = "layer-opacity";
  const opId = `opacity-${layer.id}`;
  const opLabel = document.createElement("label");
  opLabel.htmlFor = opId;
  opLabel.textContent = "Opacity";
  const range = document.createElement("input");
  range.type = "range";
  range.id = opId;
  range.min = "20";
  range.max = "100";
  range.step = "5";
  range.value = String(Math.round(opacity * 100));
  range.addEventListener("input", () => onOpacity(Number(range.value) / 100));
  opacityRow.append(opLabel, range);

  li.append(row, chips, info, opacityRow);

  const sync = () => li.classList.toggle("on", checkbox.checked);
  checkbox.addEventListener("change", sync);
  sync();

  return {
    li,
    checkbox,
    sync,
    setLoading(loading: boolean) {
      li.classList.toggle("busy", loading);
      li.setAttribute("aria-busy", String(loading));
    },
  };
}

/** Marks hazard themes that have no published layers as "(coming soon)" so
 * nobody picks one and lands on an empty list. Returns the ids that do. */
export async function markHazardAvailability(
  select: HTMLSelectElement,
  hazards: { id: string; name: string }[],
  countLayers: (hazardId: string) => Promise<number>
): Promise<Set<string>> {
  const results = await Promise.allSettled(hazards.map((h) => countLayers(h.id)));
  const available = new Set<string>();
  results.forEach((r, i) => {
    const h = hazards[i];
    if (r.status !== "fulfilled") {
      available.add(h.id); // unknown: don't hide anything we can't prove is empty
      return;
    }
    if (r.value > 0) {
      available.add(h.id);
      return;
    }
    const opt = Array.from(select.options).find((o) => o.value === h.id);
    if (opt) opt.textContent = `${h.name} (coming soon)`;
  });
  return available;
}

/* ---------- Analysis modal helpers ---------- */

function classColor(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("very high") || n.includes("severe")) return "#9a1c1c";
  if (n.includes("high")) return "#c2410c";
  if (n.includes("moderate") || n.includes("medium")) return "#d98a0b";
  if (n.includes("low")) return "#2f8f5b";
  return "var(--accent)";
}

export function areaChartHtml(figures: Record<string, number>, unit: string): string {
  const entries = Object.entries(figures).filter(([, v]) => Number.isFinite(v));
  if (!entries.length) return "";
  const max = Math.max(...entries.map(([, v]) => v), 0.000001);
  const rows = entries
    .map(([k, v]) => {
      const label = escapeHtml(k.replace(/_/g, " "));
      const pct = Math.max(2, Math.round((v / max) * 100));
      return `<div class="bar-row"><span class="bar-label" title="${label}">${label}</span><span class="bar-track" aria-hidden="true"><span class="bar-fill" style="display:block;width:${pct}%;background:${classColor(
        k
      )}"></span></span><span class="bar-value">${Number(v.toFixed(2))} ${escapeHtml(unit)}</span></div>`;
    })
    .join("");
  return `<div class="area-chart"><h3>Area by risk class</h3>${rows}</div>`;
}

let lastFocus: HTMLElement | null = null;
let trapHandler: ((e: KeyboardEvent) => void) | null = null;
let trapTarget: HTMLElement | null = null;

export const modalFocus = {
  open(overlay: HTMLElement): void {
    lastFocus = document.activeElement as HTMLElement | null;
    const card = overlay.querySelector<HTMLElement>(".modal-card");
    const close = overlay.querySelector<HTMLElement>(".modal-close");
    if (!card) return;
    trapTarget = overlay;
    trapHandler = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusable = Array.from(
        card.querySelectorAll<HTMLElement>("button, [href], input, select, summary, [tabindex]:not([tabindex='-1'])")
      ).filter((el) => !el.hasAttribute("disabled"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    overlay.addEventListener("keydown", trapHandler);
    close?.focus();
  },
  close(): void {
    if (trapTarget && trapHandler) trapTarget.removeEventListener("keydown", trapHandler);
    trapTarget = null;
    trapHandler = null;
    lastFocus?.focus();
    lastFocus = null;
  },
};

/* ---------- Step summaries and action context ---------- */

function setStep(id: string, status: string, done: boolean): void {
  const section = $(id);
  if (!section) return;
  const el = section.querySelector<HTMLElement>(".step-status");
  if (el) {
    el.textContent = status;
    el.title = status;
  }
  section.classList.toggle("done", done);
}

export function refreshSummaries(): void {
  const hazardSel = $<HTMLSelectElement>("hazard-select");
  const hazardName = (hazardSel?.selectedOptions[0]?.textContent ?? "").replace(/\s*\(coming soon\)$/, "");
  setStep("step-hazard", hazardName, !!hazardName);

  const names = Array.from(document.querySelectorAll<HTMLLIElement>("#layer-list li.layer-card"))
    .filter((li) => li.querySelector<HTMLInputElement>("input.switch")?.checked)
    .map((li) => li.dataset.name ?? "");
  setStep("layer-list-section", names.length === 0 ? "None on" : names.length === 1 ? names[0] : `${names.length} layers on`, names.length > 0);

  const clearBtn = $<HTMLButtonElement>("aoi-clear-btn");
  const hasAoi = !!clearBtn && !clearBtn.hidden;
  const aoiText = ($("aoi-summary")?.textContent ?? "").trim();
  setStep("aoi-section", hasAoi ? aoiText : "Not set", hasAoi);

  const scene = $("scene-search-section");
  if (scene) setStep("scene-search-section", scene.classList.contains("locked") ? "Needs a recent-scene layer" : "Optional", false);
}

export function setActionContext(layerName?: string | null, aoiName?: string | null): void {
  const el = $("action-context");
  if (!el) return;
  el.textContent = layerName && aoiName ? `${layerName} in ${aoiName}` : "";
}

/* ---------- initUI: wire everything that doesn't need map state ---------- */

type SheetState = "peek" | "half" | "full";
const SHEET_ORDER: SheetState[] = ["peek", "half", "full"];

function initTheme(): void {
  const btn = $<HTMLButtonElement>("theme-toggle");
  const root = document.documentElement;
  const apply = (theme: "light" | "dark") => {
    root.dataset.theme = theme;
    btn?.setAttribute("aria-pressed", String(theme === "dark"));
    btn?.setAttribute("aria-label", theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
  };
  apply(store.get("atlas-theme") === "dark" ? "dark" : "light");
  btn?.addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    apply(next);
    store.set("atlas-theme", next);
  });
}

function initAccordion(): void {
  document.querySelectorAll<HTMLElement>(".step").forEach((section) => {
    const head = section.querySelector<HTMLButtonElement>(".step-head");
    head?.addEventListener("click", () => {
      const collapsed = section.classList.toggle("collapsed");
      head.setAttribute("aria-expanded", String(!collapsed));
    });
  });
}

function initSheet(): void {
  const app = $("app");
  const handle = $<HTMLButtonElement>("sheet-handle");
  if (!app || !handle) return;
  const mobile = window.matchMedia("(max-width: 760px)");
  const get = (): SheetState => (app.dataset.sheet as SheetState) || "half";
  const set = (s: SheetState) => {
    app.dataset.sheet = s;
    handle.setAttribute("aria-expanded", String(s !== "peek"));
  };
  set("half");

  handle.addEventListener("click", () => {
    if (!mobile.matches) return;
    const i = SHEET_ORDER.indexOf(get());
    set(SHEET_ORDER[(i + 1) % SHEET_ORDER.length]);
  });

  // Swipe up/down on the handle or header.
  let startY: number | null = null;
  const brand = document.querySelector<HTMLElement>(".brand");
  for (const el of [handle, brand]) {
    el?.addEventListener("pointerdown", (e) => {
      if (mobile.matches) startY = e.clientY;
    });
  }
  window.addEventListener("pointerup", (e) => {
    if (startY === null) return;
    const dy = e.clientY - startY;
    startY = null;
    if (Math.abs(dy) < 40) return;
    const i = SHEET_ORDER.indexOf(get());
    set(SHEET_ORDER[Math.max(0, Math.min(SHEET_ORDER.length - 1, i + (dy < 0 ? 1 : -1)))]);
  });

  // Once an area is chosen on a phone, get the panel out of the way of the map.
  $("aoi-summary") &&
    new MutationObserver(() => {
      const clearBtn = $<HTMLButtonElement>("aoi-clear-btn");
      if (mobile.matches && clearBtn && !clearBtn.hidden && get() === "full") set("half");
    }).observe($("aoi-summary")!, { childList: true, characterData: true, subtree: true });
}

function initWelcome(): void {
  const card = $("welcome");
  if (!card) return;
  const hide = () => {
    card.hidden = true;
    store.set("atlas-welcome-seen", "1");
  };
  $("welcome-close")?.addEventListener("click", hide);
  $("welcome-start")?.addEventListener("click", hide);
  $("help-btn")?.addEventListener("click", () => {
    card.hidden = !card.hidden;
    if (!card.hidden) card.querySelector<HTMLElement>("button")?.focus();
  });
  card.hidden = store.get("atlas-welcome-seen") === "1";
  card.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
}

function initSearchKeyboard(): void {
  const input = $<HTMLInputElement>("search-input");
  const list = $<HTMLUListElement>("search-results");
  if (!input || !list) return;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-controls", "search-results");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Search results");

  new MutationObserver(() => {
    const items = Array.from(list.querySelectorAll<HTMLLIElement>("li"));
    input.setAttribute("aria-expanded", String(items.length > 0));
    items.forEach((li) => {
      if (li.classList.contains("state-inline")) return;
      li.setAttribute("role", "option");
      li.tabIndex = 0;
    });
  }).observe(list, { childList: true });

  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      const first = list.querySelector<HTMLElement>("li[role='option']");
      if (first) {
        e.preventDefault();
        first.focus();
      }
    }
  });
  list.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      (target.nextElementSibling as HTMLElement | null)?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = target.previousElementSibling as HTMLElement | null;
      (prev ?? input).focus();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      target.click();
    } else if (e.key === "Escape") {
      input.focus();
    }
  });
}

function initModalActions(): void {
  const overlay = $("analysis-modal-overlay");
  if (!overlay) return;
  overlay.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
    if (!btn) return;
    if (btn.dataset.act === "print") {
      window.print();
    } else if (btn.dataset.act === "copy") {
      const title = overlay.querySelector(".modal-title")?.textContent ?? "";
      const layer = overlay.querySelector(".modal-subtitle")?.textContent ?? "";
      const summary = (overlay.querySelector(".modal-summary") as HTMLElement | null)?.innerText ?? "";
      const text = `${title} | ${layer}\n\n${summary}\n\nSource: Lagos State Climate Hazard Risk Atlas (open satellite data).`;
      try {
        await navigator.clipboard.writeText(text);
        toast("Summary copied.", "success", 2500);
      } catch {
        toast("Couldn't copy automatically. Select the text and copy it instead.", "error");
      }
    }
  });
}

function initSummaryObservers(): void {
  const aoiSummary = $("aoi-summary");
  if (aoiSummary) new MutationObserver(refreshSummaries).observe(aoiSummary, { childList: true, characterData: true, subtree: true });
  const clearBtn = $("aoi-clear-btn");
  if (clearBtn) new MutationObserver(refreshSummaries).observe(clearBtn, { attributes: true, attributeFilter: ["hidden"] });
  const scene = $("scene-search-section");
  if (scene) new MutationObserver(refreshSummaries).observe(scene, { attributes: true, attributeFilter: ["class"] });
  $("hazard-select")?.addEventListener("change", refreshSummaries);
  $("layer-list")?.addEventListener("change", () => window.setTimeout(refreshSummaries, 0));
  refreshSummaries();
}

export function initUI(): void {
  initTheme();
  initAccordion();
  initSheet();
  initWelcome();
  initSearchKeyboard();
  initModalActions();
  initSummaryObservers();
}
