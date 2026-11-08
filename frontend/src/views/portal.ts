import { getCatalogue, getLgas, hazardColor, hazardLabel } from "../catalogue";
import { onShow } from "../router";
import { records, session } from "../session";
import type { DatasetRecord, HazardTheme, RecordStatus } from "../types";
import { closeModal, confirmDialog, escapeHtml, fmtDate, openModal, setBusy, toast } from "../ui";

/* ==========================================================================
   Data Management Portal: stats, the records table (tabs, filter, paging),
   submissions, review and export.
   ========================================================================== */

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const PAGE_SIZE = 10;

const state = { tab: "all", q: "", hazard: "", region: "", page: 1 };
let hazards: HazardTheme[] = [];
let regions: string[] = [];
let lastItems: DatasetRecord[] = [];

const STATUS_LABEL: Record<RecordStatus, string> = {
  published: "Published",
  submitted: "Submitted",
  draft: "Draft",
  rejected: "Changes requested",
};
const STATUS_ICON: Record<RecordStatus, string> = {
  published: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>',
  submitted: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  draft: '<svg viewBox="0 0 24 24"><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/></svg>',
  rejected: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>',
};
const FORMATS = ["Cloud-Optimized GeoTIFF", "GeoTIFF", "GeoJSON", "Shapefile (zip)", "GeoPackage", "CSV", "Other"];

function statusPill(s: RecordStatus): string {
  return `<span class="status-pill status-${s}">${STATUS_ICON[s]}${STATUS_LABEL[s]}</span>`;
}

const ICONS = {
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20l4-1 11-11-3-3L5 16z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="12" cy="19" r="1.2"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M4 12l16-8-6 16-2-7z"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M9 14l-5-5 5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/></svg>',
};

function canDelete(r: DatasetRecord): boolean {
  return session.isAdmin || (r.owner_id === session.user?.id && r.status !== "published");
}

/* ---------- loading ---------- */

async function loadStats(): Promise<void> {
  try {
    const s = await records.stats();
    $("stat-total").textContent = String(s.total);
    $("stat-published").textContent = String(s.published);
    $("stat-pending").textContent = String(s.submitted);
    $("stat-drafts").textContent = String(s.draft);
  } catch {
    ["stat-total", "stat-published", "stat-pending", "stat-drafts"].forEach((id) => ($(id).textContent = "—"));
  }
}

async function loadRows(): Promise<void> {
  const tbody = $("portal-rows");
  tbody.innerHTML = Array.from({ length: 4 })
    .map(() => '<tr><td colspan="6"><div class="skeleton"></div></td></tr>')
    .join("");
  try {
    const page = await records.list({ ...state, pageSize: PAGE_SIZE });
    lastItems = page.items;
    if (!page.items.length) {
      const filtered = state.q || state.hazard || state.region || state.tab !== "all";
      tbody.innerHTML = `<tr class="empty-row"><td colspan="6"><strong>${filtered ? "No records match" : "No datasets yet"}</strong>${
        filtered ? "Try another tab or clear the filters." : "Start with <em>New Submission</em> to add the first dataset."
      }</td></tr>`;
    } else {
      tbody.innerHTML = page.items.map(rowHtml).join("");
    }
    const from = page.total ? (page.page - 1) * page.page_size + 1 : 0;
    const to = Math.min(page.total, page.page * page.page_size);
    $("portal-showing").innerHTML = page.total
      ? `Showing <b>${from}–${to}</b> of ${page.total} record${page.total === 1 ? "" : "s"}`
      : "Showing 0 records";
    renderPager(Math.max(1, Math.ceil(page.total / page.page_size)));
  } catch (err) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="6"><strong>Couldn't load records</strong>${escapeHtml((err as Error).message)}</td></tr>`;
    $("portal-pager").innerHTML = "";
  }
}

function refresh(): void {
  void loadStats();
  void loadRows();
}

function rowHtml(r: DatasetRecord): string {
  const del = canDelete(r);
  return `<tr data-id="${r.id}">
    <td class="rec-id">${escapeHtml(r.code)}</td>
    <td><span class="rec-title"><button type="button" data-act="view">${escapeHtml(r.title)}</button></span>
        <span class="rec-meta">By ${escapeHtml(r.owner_name)} · ${escapeHtml(r.created_at.slice(0, 10))}</span></td>
    <td><span class="hz" style="--hz:${hazardColor(r.hazard_theme_id)}">${escapeHtml(hazardLabel(r.hazard_theme_id, hazards))}</span></td>
    <td>${statusPill(r.status)}</td>
    <td>${escapeHtml(r.region)}</td>
    <td class="ta-right"><div class="row-actions menu-wrap">
      <button type="button" class="icon-btn" data-act="edit" aria-label="Edit ${escapeHtml(r.title)}" ${r.can_edit ? "" : "disabled title=\"Only a reviewer can edit a published record\""}>${ICONS.edit}</button>
      <button type="button" class="icon-btn" data-act="delete" aria-label="Delete ${escapeHtml(r.title)}" ${del ? "" : "disabled title=\"Only a reviewer can delete a published record\""}>${ICONS.trash}</button>
      <button type="button" class="icon-btn" data-act="menu" aria-label="More actions" aria-haspopup="menu" aria-expanded="false">${ICONS.more}</button>
    </div></td>
  </tr>`;
}

function renderPager(pages: number): void {
  const pager = $("portal-pager");
  const p = state.page;
  const nums: number[] = [];
  const start = Math.max(1, Math.min(p - 2, pages - 4));
  for (let i = start; i <= Math.min(pages, start + 4); i++) nums.push(i);
  pager.innerHTML =
    `<button type="button" data-page="${p - 1}" ${p <= 1 ? "disabled" : ""}>Prev</button>` +
    nums
      .map((n) => `<button type="button" class="num${n === p ? " current" : ""}" data-page="${n}" ${n === p ? 'aria-current="page"' : ""}>${n}</button>`)
      .join("") +
    `<button type="button" data-page="${p + 1}" ${p >= pages ? "disabled" : ""}>Next</button>`;
}

/* ---------- row menu ---------- */

let openMenu: HTMLElement | null = null;
function closeRowMenu(): void {
  openMenu?.previousElementSibling?.setAttribute("aria-expanded", "false");
  openMenu?.remove();
  openMenu = null;
}

function showRowMenu(btn: HTMLElement, r: DatasetRecord): void {
  closeRowMenu();
  const mine = r.owner_id === session.user?.id;
  const items: string[] = [`<button type="button" data-menu="view">${ICONS.eye}View details</button>`];
  if (mine && (r.status === "draft" || r.status === "rejected")) items.push(`<button type="button" data-menu="submit">${ICONS.send}Submit for review</button>`);
  if (mine && r.status === "submitted") items.push(`<button type="button" data-menu="withdraw">${ICONS.undo}Withdraw to draft</button>`);
  if (session.isAdmin && r.status !== "published" && r.status !== "draft") items.push(`<button type="button" data-menu="review">${ICONS.check}Review submission</button>`);
  if (session.isAdmin && r.status === "published") items.push(`<button type="button" data-menu="unpublish">${ICONS.undo}Unpublish</button>`);
  if (r.data_url) items.push(`<a href="${escapeHtml(r.data_url)}" target="_blank" rel="noopener noreferrer">${ICONS.link}Open data source</a>`);
  const menu = document.createElement("div");
  menu.className = "popover popover-menu row-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = items.join("");
  btn.after(menu);
  btn.setAttribute("aria-expanded", "true");
  openMenu = menu;
  menu.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-menu]");
    closeRowMenu();
    if (t) void act(t.dataset.menu!, r);
  });
  (menu.querySelector("button, a") as HTMLElement | null)?.focus();
}

/* ---------- actions ---------- */

async function act(action: string, r: DatasetRecord): Promise<void> {
  try {
    if (action === "view") return showDetail(r);
    if (action === "edit") return recordForm(r);
    if (action === "review") return reviewForm(r);
    if (action === "delete") {
      const ok = await confirmDialog({
        title: "Delete this record?",
        text: `${r.code} "${r.title}" will be permanently removed from the portal. This can't be undone.`,
        confirm: "Delete record",
        danger: true,
      });
      if (!ok) return;
      await records.remove(r.id);
      toast(`${r.code} deleted.`, "info", 2500);
      if (lastItems.length === 1 && state.page > 1) state.page--;
    } else if (action === "submit") {
      await records.setStatus(r.id, "submitted");
      toast(`${r.code} submitted for review.`, "success", 3000);
    } else if (action === "withdraw") {
      await records.setStatus(r.id, "draft");
      toast(`${r.code} moved back to drafts.`, "info", 3000);
    } else if (action === "unpublish") {
      const ok = await confirmDialog({ title: "Unpublish this dataset?", text: `${r.code} will go back to the submitter as a draft.`, confirm: "Unpublish" });
      if (!ok) return;
      await records.setStatus(r.id, "draft");
      toast(`${r.code} unpublished.`, "info", 3000);
    }
    refresh();
  } catch (err) {
    toast((err as Error).message, "error", 6000);
  }
}

function showDetail(r: DatasetRecord): void {
  const rows: [string, string][] = [
    ["Record ID", escapeHtml(r.code)],
    ["Status", statusPill(r.status)],
    ["Hazard type", escapeHtml(hazardLabel(r.hazard_theme_id, hazards))],
    ["Region", escapeHtml(r.region)],
    ["Submitted by", escapeHtml(r.owner_name)],
    ["Created", escapeHtml(fmtDate(r.created_at))],
    ["Last updated", escapeHtml(fmtDate(r.updated_at))],
  ];
  if (r.data_format) rows.push(["Format", escapeHtml(r.data_format)]);
  if (r.data_url) rows.push(["Data source", `<a href="${escapeHtml(r.data_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.data_url)}</a>`]);
  const body = openModal(
    `<div class="modal-form">
      <p class="modal-eyebrow">${escapeHtml(hazardLabel(r.hazard_theme_id, hazards))}</p>
      <h2 id="generic-modal-title" class="modal-title" style="font-size:21px">${escapeHtml(r.title)}</h2>
      ${r.description ? `<p style="margin-top:10px;color:var(--text-2)">${escapeHtml(r.description)}</p>` : ""}
      <dl class="detail-grid">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
      ${r.review_note ? `<p class="mini-label">Reviewer note</p><div class="review-note">${escapeHtml(r.review_note)}</div>` : ""}
      <div class="modal-actions">
        ${r.can_edit ? '<button type="button" data-d="edit">Edit</button>' : ""}
        ${session.isAdmin && r.status !== "draft" && r.status !== "published" ? '<button type="button" class="primary" data-d="review">Review</button>' : ""}
        <button type="button" data-d="close" ${r.can_edit || session.isAdmin ? "" : 'class="primary"'}>Close</button>
      </div>
    </div>`,
    { wide: true }
  );
  body.addEventListener("click", (e) => {
    const d = (e.target as HTMLElement).closest<HTMLElement>("[data-d]")?.dataset.d;
    if (!d) return;
    closeModal();
    if (d === "edit") recordForm(r);
    if (d === "review") reviewForm(r);
  });
}

function options(list: { value: string; label: string }[], selected?: string | null): string {
  return list
    .map((o) => `<option value="${escapeHtml(o.value)}" ${o.value === selected ? "selected" : ""}>${escapeHtml(o.label)}</option>`)
    .join("");
}

function recordForm(existing?: DatasetRecord): void {
  const editing = !!existing;
  const body = openModal(
    `<form class="modal-form" novalidate>
      <h2 id="generic-modal-title">${editing ? `Edit ${escapeHtml(existing!.code)}` : "New dataset submission"}</h2>
      <p>${editing ? "Update the record's details." : "Describe the dataset and where it's hosted. Save it as a draft, or submit it for a reviewer to publish."}</p>
      <div class="form-grid">
        <div class="field full"><label for="rf-title">Title</label><input id="rf-title" name="title" type="text" maxlength="240" required placeholder="e.g. Ikeja Flood Depth Analysis 2026" value="${escapeHtml(existing?.title ?? "")}" /></div>
        <div class="field"><label for="rf-hazard">Hazard type</label><div class="select-wrap"><select id="rf-hazard" name="hazard_theme_id" required>
          <option value="">Choose a hazard…</option>${options(hazards.map((h) => ({ value: h.id, label: h.name })), existing?.hazard_theme_id)}</select></div></div>
        <div class="field"><label for="rf-region">Region</label><div class="select-wrap"><select id="rf-region" name="region" required>
          <option value="">Choose a region…</option>${options(
            ["Lagos State (all LGAs)", ...regions].map((r) => ({ value: r, label: r })).concat(
              existing && !regions.includes(existing.region) && existing.region !== "Lagos State (all LGAs)" ? [{ value: existing.region, label: existing.region }] : []
            ),
            existing?.region
          )}</select></div></div>
        <div class="field full"><label for="rf-desc">Description &amp; methodology <span class="optional">optional</span></label><textarea id="rf-desc" name="description" maxlength="5000" placeholder="Source data, processing steps, date range, known limitations…">${escapeHtml(existing?.description ?? "")}</textarea></div>
        <div class="field"><label for="rf-url">Data URL <span class="optional">optional</span></label><input id="rf-url" name="data_url" type="url" placeholder="https://…/dataset.tif" value="${escapeHtml(existing?.data_url ?? "")}" /></div>
        <div class="field"><label for="rf-format">Format</label><div class="select-wrap"><select id="rf-format" name="data_format">
          <option value="">Choose a format…</option>${options(FORMATS.map((f) => ({ value: f, label: f })), existing?.data_format)}</select></div></div>
      </div>
      <p class="form-error" id="rf-error" hidden></p>
      <div class="modal-actions">
        <button type="button" data-cancel>Cancel</button>
        ${editing ? "" : '<button type="submit" data-status="draft">Save as draft</button>'}
        <button type="submit" class="primary" data-status="${editing ? "keep" : "submitted"}">${editing ? "Save changes" : "Submit for review"}</button>
      </div>
    </form>`,
    { wide: true }
  );
  const form = body.querySelector("form")!;
  const errEl = body.querySelector<HTMLElement>("#rf-error")!;
  body.querySelector("[data-cancel]")!.addEventListener("click", closeModal);
  let intent = editing ? "keep" : "submitted";
  form.querySelectorAll<HTMLButtonElement>("button[type=submit]").forEach((b) => b.addEventListener("click", () => (intent = b.dataset.status!)));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const data = {
      title: String(fd.get("title") ?? "").trim(),
      hazard_theme_id: String(fd.get("hazard_theme_id") ?? ""),
      region: String(fd.get("region") ?? ""),
      description: String(fd.get("description") ?? "").trim(),
      data_url: String(fd.get("data_url") ?? "").trim(),
      data_format: String(fd.get("data_format") ?? "") || null,
    };
    const fail = (msg: string, id: string) => {
      errEl.textContent = msg;
      errEl.hidden = false;
      body.querySelector<HTMLElement>(`#${id}`)?.focus();
    };
    if (data.title.length < 3) return fail("Give the dataset a title (at least 3 characters).", "rf-title");
    if (!data.hazard_theme_id) return fail("Choose a hazard type.", "rf-hazard");
    if (!data.region) return fail("Choose a region.", "rf-region");
    if (data.data_url && !/^https?:\/\/\S+$/i.test(data.data_url)) return fail("The data URL should start with http:// or https://.", "rf-url");
    errEl.hidden = true;
    const submitBtns = form.querySelectorAll<HTMLButtonElement>("button[type=submit]");
    submitBtns.forEach((b) => (b.disabled = true));
    const active = form.querySelector<HTMLButtonElement>(`button[data-status="${intent}"]`);
    if (active) setBusy(active, true);
    try {
      if (editing) {
        await records.update(existing!.id, data);
        toast(`${existing!.code} updated.`, "success", 2500);
      } else {
        const rec = await records.create({ ...data, status: intent as "draft" | "submitted" });
        toast(intent === "draft" ? `${rec.code} saved as a draft.` : `${rec.code} submitted for review.`, "success", 3000);
        state.tab = intent === "draft" ? "drafts" : "reviewing";
        state.page = 1;
        syncTabs();
      }
      closeModal();
      refresh();
    } catch (err) {
      errEl.textContent = (err as Error).message;
      errEl.hidden = false;
    } finally {
      submitBtns.forEach((b) => (b.disabled = false));
      if (active) setBusy(active, false);
    }
  });
}

function reviewForm(r: DatasetRecord): void {
  const body = openModal(
    `<form class="modal-form">
      <h2 id="generic-modal-title">Review ${escapeHtml(r.code)}</h2>
      <p><strong>${escapeHtml(r.title)}</strong> · ${escapeHtml(hazardLabel(r.hazard_theme_id, hazards))} · ${escapeHtml(r.region)}<br/>Submitted by ${escapeHtml(r.owner_name)}</p>
      <div class="field"><label for="rv-note">Note to the submitter <span class="optional">optional</span></label>
        <textarea id="rv-note" maxlength="2000" placeholder="What's good, or what needs to change before it can be published">${escapeHtml(r.review_note ?? "")}</textarea></div>
      <div class="modal-actions">
        <button type="button" data-cancel>Cancel</button>
        <button type="button" data-s="rejected">Request changes</button>
        <button type="button" class="primary" data-s="published">Publish</button>
      </div>
    </form>`,
    { wide: true }
  );
  body.querySelector("[data-cancel]")!.addEventListener("click", closeModal);
  body.querySelectorAll<HTMLButtonElement>("button[data-s]").forEach((b) =>
    b.addEventListener("click", async () => {
      const note = body.querySelector<HTMLTextAreaElement>("#rv-note")!.value;
      b.disabled = true;
      setBusy(b, true);
      try {
        await records.setStatus(r.id, b.dataset.s!, note);
        toast(b.dataset.s === "published" ? `${r.code} published.` : `${r.code} returned with your note.`, "success", 3000);
        closeModal();
        refresh();
      } catch (err) {
        toast((err as Error).message, "error", 6000);
      } finally {
        b.disabled = false;
        setBusy(b, false);
      }
    })
  );
}

function syncTabs(): void {
  $("portal-tabs")
    .querySelectorAll<HTMLButtonElement>("button[data-tab]")
    .forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === state.tab)));
}

function standardsDoc(): void {
  openModal(
    `<div class="modal-form prose">
      <h2 id="generic-modal-title">GIS submission standards</h2>
      <p>These keep submitted datasets comparable with the layers already in the atlas.</p>
      <h3>Raster data</h3>
      <ul>
        <li>Cloud-Optimized GeoTIFF (COG), hosted at a public HTTPS URL so the tile server can read it directly.</li>
        <li>CRS: EPSG:4326 (WGS 84) or EPSG:32631 (UTM zone 31N).</li>
        <li>A declared unit (e.g. °C, m, index), nodata value, and pixel resolution.</li>
        <li>For imagery-derived products: sensor, acquisition date(s), and cloud-masking method.</li>
      </ul>
      <h3>Vector data</h3>
      <ul>
        <li>GeoJSON (or zipped Shapefile / GeoPackage) in EPSG:4326.</li>
        <li>A <code>risk_class</code> property on each feature (e.g. Low, Moderate, High, Very High) so area-by-class analysis works.</li>
      </ul>
      <h3>Metadata</h3>
      <ul>
        <li>Title, hazard theme, region, source, method, date range and known limitations in the description.</li>
        <li>Licence that allows the State to publish the data.</li>
      </ul>
      <div class="modal-actions"><button type="button" class="primary" data-close>Close</button></div>
    </div>`,
    { wide: true }
  ).querySelector("[data-close]")!.addEventListener("click", closeModal);
}

/* ---------- init ---------- */

export function initPortal(): void {
  const tbody = $("portal-rows");
  const filter = $<HTMLInputElement>("portal-filter");
  const hazardSel = $<HTMLSelectElement>("portal-hazard-filter");
  const regionSel = $<HTMLSelectElement>("portal-region-filter");
  const filterPop = $("portal-filter-pop");
  const filterBtn = $("portal-filter-btn");

  $("portal-tabs").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-tab]");
    if (!b) return;
    state.tab = b.dataset.tab!;
    state.page = 1;
    syncTabs();
    void loadRows();
  });

  let t: number | undefined;
  filter.addEventListener("input", () => {
    window.clearTimeout(t);
    t = window.setTimeout(() => {
      state.q = filter.value.trim();
      state.page = 1;
      void loadRows();
    }, 250);
  });

  const applyFilters = () => {
    state.hazard = hazardSel.value;
    state.region = regionSel.value;
    state.page = 1;
    $("portal-filter-dot").hidden = !(state.hazard || state.region);
    void loadRows();
  };
  hazardSel.addEventListener("change", applyFilters);
  regionSel.addEventListener("change", applyFilters);
  $("portal-filter-reset").addEventListener("click", () => {
    hazardSel.value = "";
    regionSel.value = "";
    applyFilters();
  });
  filterBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    filterPop.hidden = !filterPop.hidden;
    filterBtn.setAttribute("aria-expanded", String(!filterPop.hidden));
  });
  document.addEventListener("click", (e) => {
    if (!filterPop.hidden && !filterPop.contains(e.target as Node)) {
      filterPop.hidden = true;
      filterBtn.setAttribute("aria-expanded", "false");
    }
    if (openMenu && !openMenu.contains(e.target as Node) && !(e.target as HTMLElement).closest("[data-act=menu]")) closeRowMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeRowMenu();
  });

  $("portal-pager").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-page]");
    if (!b || b.disabled) return;
    state.page = Number(b.dataset.page);
    void loadRows();
  });

  tbody.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
    const tr = btn?.closest<HTMLTableRowElement>("tr[data-id]");
    if (!btn || !tr) return;
    const r = lastItems.find((x) => x.id === Number(tr.dataset.id));
    if (!r) return;
    if (btn.dataset.act === "menu") {
      e.stopPropagation();
      if (openMenu && openMenu.previousElementSibling === btn) closeRowMenu();
      else showRowMenu(btn, r);
    } else void act(btn.dataset.act!, r);
  });

  $("portal-new").addEventListener("click", () => recordForm());
  $("portal-standards").addEventListener("click", standardsDoc);
  $("portal-export").addEventListener("click", async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    b.disabled = true;
    try {
      await records.exportCsv(state);
      toast("Inventory exported as CSV.", "success", 2500);
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      b.disabled = false;
    }
  });

  // Reference data for labels and the form's dropdowns.
  getCatalogue()
    .then((c) => {
      hazards = c.hazards;
      hazardSel.innerHTML = `<option value="">All hazards</option>${options(hazards.map((h) => ({ value: h.id, label: h.name })))}`;
      if (!$("view-portal").hidden && lastItems.length) $("portal-rows").innerHTML = lastItems.map(rowHtml).join("");
    })
    .catch(() => {});
  getLgas()
    .then((l) => {
      regions = l.map((x) => x.name).sort((a, b) => a.localeCompare(b));
      regionSel.innerHTML = `<option value="">All regions</option>${options(["Lagos State (all LGAs)", ...regions].map((r) => ({ value: r, label: r })))}`;
    })
    .catch(() => {});

  onShow("portal", async (params) => {
    const tab = params.get("tab");
    if (tab && ["all", "published", "reviewing", "drafts"].includes(tab) && tab !== state.tab) {
      state.tab = tab;
      state.page = 1;
    }
    syncTabs();
    $("support-role").textContent = session.isAdmin ? "Reviewer" : "Contributor";
    const contact = $<HTMLAnchorElement>("support-contact");
    contact.href = `mailto:?subject=${encodeURIComponent("Risk Atlas portal support")}&body=${encodeURIComponent(
      `Account: ${session.user?.email ?? ""}\n\nDescribe the issue:\n`
    )}`;
    refresh();
    const recId = Number(params.get("record"));
    if (recId) {
      try {
        showDetail(await records.get(recId));
      } catch {
        toast("That record isn't available any more.", "info");
      }
    }
  });
}
