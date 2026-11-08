import { emit, on } from "../bus";
import { onShow } from "../router";
import { confirmDialog, escapeHtml, modalFocus, toast } from "../ui";

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/* Reporting: every area analysis is kept in this browser (localStorage) so it
 * can be reopened, printed or copied later. Nothing is sent to the server. */

const KEY = "atlas-reports";
const MAX = 50;

export interface Report {
  id: string;
  title: string;
  eyebrow: string;
  layer: string;
  html: string;
  text: string;
  at: string;
}

function load(): Report[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Report[];
  } catch {
    return [];
  }
}

function persist(list: Report[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
    return true;
  } catch {
    return false;
  }
}

export function saveReport(r: Omit<Report, "id" | "at">): void {
  const list = load();
  list.unshift({ ...r, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: new Date().toISOString() });
  persist(list);
  emit("reports-changed", undefined);
}

function openReport(r: Report): void {
  const overlay = document.getElementById("analysis-modal-overlay")!;
  document.getElementById("analysis-modal-body")!.innerHTML =
    r.html + `<p class="modal-note">Saved report from ${escapeHtml(when(r.at))}.</p>`;
  overlay.hidden = false;
  modalFocus.open(overlay);
}

function render(): void {
  const body = document.getElementById("reports-body")!;
  const list = load();
  if (!list.length) {
    body.innerHTML = `<div class="empty-page"><strong>No reports yet</strong>
      Run <em>Analyse this area</em> in the map workspace and the summary will be kept here.
      <br /><a class="btn btn-primary" href="#/analysis">Start an analysis</a></div>`;
    return;
  }
  body.innerHTML = `<div class="report-list">${list
    .map(
      (r) => `<article class="report-card" data-id="${escapeHtml(r.id)}">
        <div>
          <p class="modal-eyebrow">${escapeHtml(r.eyebrow)}</p>
          <h3>${escapeHtml(r.title)}</h3>
          <div class="rec-meta">${escapeHtml(r.layer)} · ${escapeHtml(when(r.at))}</div>
          <p>${escapeHtml(r.text.slice(0, 280))}</p>
        </div>
        <div class="page-actions">
          <button type="button" class="btn btn-outline" data-act="open">Open</button>
          <button type="button" class="btn btn-ghost" data-act="delete" aria-label="Delete report">Delete</button>
        </div>
      </article>`
    )
    .join("")}</div>
    <p class="hint" style="margin-top:16px">Reports are stored in this browser only. Use <strong>Save as PDF</strong> inside a report to keep a copy elsewhere.</p>`;
}

export function initReports(): void {
  const body = document.getElementById("reports-body")!;
  body.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
    const card = btn?.closest<HTMLElement>(".report-card");
    if (!btn || !card) return;
    const list = load();
    const r = list.find((x) => x.id === card.dataset.id);
    if (!r) return;
    if (btn.dataset.act === "open") openReport(r);
    if (btn.dataset.act === "delete") {
      const ok = await confirmDialog({ title: "Delete this report?", text: `"${r.title}" will be removed from this browser.`, confirm: "Delete", danger: true });
      if (!ok) return;
      persist(list.filter((x) => x.id !== r.id));
      render();
      toast("Report deleted.", "info", 2000);
    }
  });
  onShow("reports", render);
  on("reports-changed", () => {
    if (!document.getElementById("view-reports")!.hidden) render();
  });
}
