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
  li.dataset.id = layer.id;

  const row = document.createElement("div");
  row.className = "layer-row";

  const label = document.createElement("label");
  label.className = "switch-row";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "check";
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
  range.style.setProperty("--fill", `${((Number(range.value) - 20) / 80) * 100}%`);
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

/* ---------- Action context ---------- */

export function setActionContext(layerName?: string | null, aoiName?: string | null): void {
  const el = $("action-context");
  if (!el) return;
  el.textContent = layerName && aoiName ? `${layerName} in ${aoiName}` : "";
}

/* ---------- Generic modal (forms, confirmations, documents) ---------- */

let genericOnClose: (() => void) | null = null;

export function openModal(content: string | HTMLElement, opts: { wide?: boolean; onClose?: () => void } = {}): HTMLElement {
  const overlay = $("generic-modal-overlay")!;
  const body = $("generic-modal-body")!;
  const card = overlay.querySelector<HTMLElement>(".modal-card")!;
  card.style.width = opts.wide ? "min(720px, 100%)" : "";
  body.innerHTML = "";
  if (typeof content === "string") body.innerHTML = content;
  else body.appendChild(content);
  overlay.hidden = false;
  genericOnClose = opts.onClose ?? null;
  modalFocus.open(overlay);
  const firstField = body.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea");
  firstField?.focus();
  return body;
}

export function closeModal(): void {
  const overlay = $("generic-modal-overlay");
  if (!overlay || overlay.hidden) return;
  overlay.hidden = true;
  modalFocus.close();
  const cb = genericOnClose;
  genericOnClose = null;
  cb?.();
}

export function confirmDialog(opts: { title: string; text: string; confirm: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: boolean) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const body = openModal(
      `<div class="modal-form"><h2 id="generic-modal-title">${escapeHtml(opts.title)}</h2><p>${escapeHtml(opts.text)}</p>
       <div class="modal-actions"><button type="button" data-v="0">Cancel</button>
       <button type="button" data-v="1" class="${opts.danger ? "btn-danger" : "primary"}">${escapeHtml(opts.confirm)}</button></div></div>`,
      { onClose: () => done(false) }
    );
    body.querySelectorAll<HTMLButtonElement>("button[data-v]").forEach((b) =>
      b.addEventListener("click", () => {
        done(b.dataset.v === "1");
        closeModal();
      })
    );
    body.querySelector<HTMLButtonElement>("button[data-v='1']")?.focus();
  });
}

/** Prompt for a short name (saving a map view / area). */
export function promptName(title: string, label: string, initial: string): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: string | null) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const body = openModal(
      `<form class="modal-form"><h2 id="generic-modal-title">${escapeHtml(title)}</h2>
        <div class="field" style="margin-top:14px"><label for="prompt-name">${escapeHtml(label)}</label>
        <input id="prompt-name" type="text" maxlength="160" required value="${escapeHtml(initial)}" /></div>
        <div class="modal-actions"><button type="button" data-cancel>Cancel</button><button type="submit" class="primary">Save</button></div></form>`,
      { onClose: () => done(null) }
    );
    const form = body.querySelector("form")!;
    const input = body.querySelector<HTMLInputElement>("#prompt-name")!;
    input.select();
    body.querySelector("[data-cancel]")!.addEventListener("click", () => closeModal());
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return;
      done(v);
      closeModal();
    });
  });
}

/* ---------- Small formatting helpers shared by the views ---------- */

const HONORIFIC = /^(dr|mr|mrs|ms|miss|prof|engr|arc|chief|hon)\.?\s+/i;

/** "Dr. Adebayo Ogunlewe" -> "Adebayo" (for greetings). */
export function firstName(name: string): string {
  return name.replace(HONORIFIC, "").trim().split(/\s+/)[0] || name;
}

/** Fill an avatar element with the user's picture, falling back to initials
 * if there's no picture or it fails to load. */
export function paintAvatar(el: HTMLElement, name: string, url?: string | null): void {
  el.textContent = initials(name);
  el.classList.remove("has-photo");
  if (!url) return;
  const img = new Image();
  img.alt = "";
  img.decoding = "async";
  img.onload = () => {
    el.textContent = "";
    el.appendChild(img);
    el.classList.add("has-photo");
  };
  img.src = url;
}

/** Read an image file, centre-crop it to a square and scale it to `size`px,
 * returning a JPEG data URL. Keeps uploads small whatever the camera made. */
export function resizeImage(file: File, size = 320): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      if (!side) return reject(new Error("That image appears to be empty."));
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = Math.min(size, side);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff"; // transparent PNGs get a white background in JPEG
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.88));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This browser can't open that image. Use a JPEG, PNG or WebP file."));
    };
    img.src = url;
  });
}

export function initials(name: string): string {
  const parts = name.replace(HONORIFIC, "").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

export function fmtDate(iso: string | Date, opts: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" }): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, opts);
}

export function isoDay(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/* ---------- initUI: wire everything that doesn't need map state ---------- */

function initAccordion(): void {
  document.querySelectorAll<HTMLElement>(".acc").forEach((section) => {
    const head = section.querySelector<HTMLButtonElement>(".acc-head");
    head?.addEventListener("click", () => {
      const collapsed = section.classList.toggle("collapsed");
      head.setAttribute("aria-expanded", String(!collapsed));
    });
  });
}

export function expandSection(id: string): void {
  const section = $(id);
  if (!section) return;
  section.classList.remove("collapsed");
  section.querySelector(".acc-head")?.setAttribute("aria-expanded", "true");
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
  card.hidden = store.get("atlas-welcome-seen") === "1";
  card.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hide();
  });
}

export function showWelcome(): void {
  const card = $("welcome");
  if (!card) return;
  card.hidden = false;
  card.querySelector<HTMLElement>("button")?.focus();
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
    list.hidden = items.length === 0;
    input.setAttribute("aria-expanded", String(items.length > 0));
    items.forEach((li) => {
      if (li.classList.contains("state-inline") || li.classList.contains("sr-heading")) return;
      li.setAttribute("role", "option");
      li.tabIndex = 0;
    });
  }).observe(list, { childList: true });

  const options = () => Array.from(list.querySelectorAll<HTMLElement>("li[role='option']"));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      const first = options()[0];
      if (first) {
        e.preventDefault();
        first.focus();
      }
    } else if (e.key === "Enter") {
      const first = options()[0];
      if (first) {
        e.preventDefault();
        first.click();
      }
    } else if (e.key === "Escape") {
      list.innerHTML = "";
    }
  });
  list.addEventListener("keydown", (e) => {
    const all = options();
    const i = all.indexOf(e.target as HTMLElement);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      all[Math.min(all.length - 1, i + 1)]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      (i <= 0 ? input : all[i - 1]).focus();
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      (e.target as HTMLElement).click();
    } else if (e.key === "Escape") {
      list.innerHTML = "";
      input.focus();
    }
  });
  document.addEventListener("click", (e) => {
    if (!list.contains(e.target as Node) && e.target !== input) list.innerHTML = "";
  });
}

function initModalActions(): void {
  const overlay = $("analysis-modal-overlay");
  if (overlay) {
    overlay.addEventListener("click", async (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
      if (!btn) return;
      if (btn.dataset.act === "print") {
        window.print();
      } else if (btn.dataset.act === "copy") {
        const title = overlay.querySelector(".modal-title")?.textContent ?? "";
        const layer = overlay.querySelector(".modal-subtitle")?.textContent ?? "";
        const summary = (overlay.querySelector(".modal-summary") as HTMLElement | null)?.innerText ?? "";
        const text = `${title} | ${layer}\n\n${summary}\n\nSource: Lagos State Risk Atlas (open satellite data).`;
        try {
          await navigator.clipboard.writeText(text);
          toast("Summary copied.", "success", 2500);
        } catch {
          toast("Couldn't copy automatically. Select the text and copy it instead.", "error");
        }
      }
    });
  }
  const generic = $("generic-modal-overlay");
  $("generic-modal-close")?.addEventListener("click", closeModal);
  generic?.addEventListener("mousedown", (e) => {
    if (e.target === generic) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && generic && !generic.hidden) closeModal();
  });
}

function initRangeFill(): void {
  const paint = (r: HTMLInputElement) => {
    const pct = ((Number(r.value) - Number(r.min || 0)) / (Number(r.max || 100) - Number(r.min || 0))) * 100;
    r.style.setProperty("--fill", `${pct}%`);
  };
  document.addEventListener("input", (e) => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLInputElement && t.type === "range") paint(t);
  });
  document.querySelectorAll<HTMLInputElement>("input[type=range]").forEach(paint);
}

export function initUI(): void {
  initAccordion();
  initWelcome();
  initSearchKeyboard();
  initModalActions();
  initRangeFill();
  document.querySelectorAll(".js-year").forEach((el) => (el.textContent = String(new Date().getFullYear())));
}
