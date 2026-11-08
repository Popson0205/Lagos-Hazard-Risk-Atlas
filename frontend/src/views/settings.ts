import { emit } from "../bus";
import { getCatalogue, hazardLabel } from "../catalogue";
import { go, onShow } from "../router";
import { records, savedItems, session } from "../session";
import type { SavedAoiPayload, SavedItem, SavedMapPayload, User } from "../types";
import { closeModal, confirmDialog, escapeHtml, fmtDate, openModal, paintAvatar, resizeImage, setBusy, toast } from "../ui";

/* ==========================================================================
   Account Settings: Profile, Saved Maps, Areas of Interest, Alerts, Security,
   plus the Access Level and "New Data Available" side cards.
   ========================================================================== */

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
type Tab = "profile" | "maps" | "aois" | "alerts" | "security";
let tab: Tab = "profile";

const ALERTS: { key: string; title: string; text: string; adminOnly?: boolean }[] = [
  { key: "record_status", title: "Status of my submissions", text: "When a reviewer publishes your dataset or asks for changes." },
  { key: "new_published", title: "Newly published datasets", text: "When a new dataset is published to the atlas." },
  { key: "review_queue", title: "Review queue", text: "When a contributor submits a dataset for review.", adminOnly: true },
  { key: "weekly_digest", title: "Weekly digest", text: "A summary of hazard layer and dataset changes each week." },
];

function card(title: string, sub: string, body: string, foot = ""): string {
  return `<section class="settings-card">
    <header class="settings-card-head"><h2>${title}</h2><p>${sub}</p></header>
    <div class="settings-card-body">${body}</div>
    ${foot ? `<footer class="settings-card-foot">${foot}</footer>` : ""}
  </section>`;
}

function field(id: string, label: string, icon: string, value: string, opts: { readonly?: boolean; type?: string; placeholder?: string } = {}): string {
  return `<div class="field"><label for="${id}">${label}</label><div class="input-icon">${icon}
    <input id="${id}" type="${opts.type ?? "text"}" value="${escapeHtml(value)}" ${opts.readonly ? "readonly" : ""} placeholder="${escapeHtml(opts.placeholder ?? "")}" /></div></div>`;
}

const I = {
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  case: '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5h6v2M3 12h18"/></svg>',
  org: '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  map: '<svg viewBox="0 0 24 24"><path d="M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
};

/* ---------- tabs ---------- */

function renderProfile(u: User): void {
  const panel = $("settings-panel");
  panel.innerHTML = card(
    "Personal Information",
    "Update your professional details and contact information.",
    `<div class="profile-row">
      <div class="avatar-edit">
        <span class="avatar avatar-xl" id="pf-avatar" aria-hidden="true"></span>
        <label class="avatar-change" for="pf-photo" title="Change photo">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>
          <span class="sr-only">Change profile photo</span>
        </label>
        <input type="file" id="pf-photo" accept="image/jpeg,image/png,image/webp" hidden />
        <button type="button" class="link-btn" id="pf-photo-remove" ${u.avatar_url ? "" : "hidden"}>Remove photo</button>
      </div>
      <div class="form-grid">
        ${field("pf-name", "Full Name", I.user, u.full_name)}
        ${field("pf-email", "Email Address", I.mail, u.email, { readonly: true, type: "email" })}
        ${field("pf-role", "Professional Role", I.case, u.professional_role ?? "", { placeholder: "e.g. Senior Hydrologist" })}
        ${field("pf-org", "Organization", I.org, u.organization ?? "", { placeholder: "e.g. Lagos State Ministry of Environment" })}
      </div>
    </div>`,
    `<span class="status-msg" id="pf-msg" aria-live="polite"></span>
     <button type="button" class="btn" id="pf-cancel">Cancel Changes</button>
     <button type="button" class="btn btn-primary" id="pf-save">Save Information</button>`
  );
  paintAvatar($("pf-avatar"), u.full_name, u.avatar_url);
  const photoInput = $<HTMLInputElement>("pf-photo");
  photoInput.addEventListener("change", async () => {
    const file = photoInput.files?.[0];
    photoInput.value = "";
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      toast("Use a JPEG, PNG or WebP image.", "error");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      toast("That image is over 15 MB. Choose a smaller one.", "error");
      return;
    }
    const wrap = document.querySelector<HTMLElement>(".avatar-edit");
    wrap?.classList.add("busy");
    try {
      const updated = await session.uploadAvatar(await resizeImage(file));
      paintAvatar($("pf-avatar"), updated.full_name, updated.avatar_url);
      $("pf-photo-remove").hidden = false;
      toast("Profile photo updated.", "success", 2500);
    } catch (err) {
      toast((err as Error).message, "error", 6000);
    } finally {
      wrap?.classList.remove("busy");
    }
  });
  $("pf-photo-remove").addEventListener("click", async () => {
    try {
      const updated = await session.removeAvatar();
      paintAvatar($("pf-avatar"), updated.full_name, null);
      $("pf-photo-remove").hidden = true;
      toast("Profile photo removed.", "info", 2500);
    } catch (err) {
      toast((err as Error).message, "error");
    }
  });
  $("pf-cancel").addEventListener("click", () => renderProfile(session.user!));
  $("pf-save").addEventListener("click", async (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const name = $<HTMLInputElement>("pf-name").value.trim();
    const msg = $("pf-msg");
    if (name.length < 2) {
      msg.style.color = "var(--danger)";
      msg.textContent = "Enter your full name.";
      $("pf-name").focus();
      return;
    }
    btn.disabled = true;
    setBusy(btn, true);
    try {
      await session.updateProfile({
        full_name: name,
        professional_role: $<HTMLInputElement>("pf-role").value.trim(),
        organization: $<HTMLInputElement>("pf-org").value.trim(),
      });
      msg.style.color = "";
      msg.textContent = "Saved.";
      paintAvatar($("pf-avatar"), session.user!.full_name, session.user!.avatar_url);
      toast("Profile updated.", "success", 2500);
    } catch (err) {
      msg.style.color = "var(--danger)";
      msg.textContent = (err as Error).message;
    } finally {
      btn.disabled = false;
      setBusy(btn, false);
    }
  });
}

async function renderItems(kind: "map" | "aoi"): Promise<void> {
  const panel = $("settings-panel");
  const isMap = kind === "map";
  const title = isMap ? "Saved Maps" : "Areas of Interest";
  const sub = isMap
    ? "Map views you've saved: hazard theme, layers, area and zoom. Open one to pick up where you left off."
    : "Wards, LGAs and drawn areas you've saved for quick analysis.";
  panel.innerHTML = card(title, sub, `<div class="skeleton"></div><div class="skeleton"></div>`);
  const body = panel.querySelector(".settings-card-body")!;
  let items: SavedItem[] = [];
  let hazardsList: Awaited<ReturnType<typeof getCatalogue>>["hazards"] = [];
  try {
    [items, hazardsList] = await Promise.all([
      savedItems.list<SavedMapPayload | SavedAoiPayload>(kind),
      getCatalogue().then((c) => c.hazards).catch(() => []),
    ]);
  } catch (err) {
    body.innerHTML = `<div class="state state-error"><strong>Couldn't load your saved ${isMap ? "maps" : "areas"}</strong><span>${escapeHtml((err as Error).message)}</span></div>`;
    return;
  }
  if (tab !== (isMap ? "maps" : "aois")) return;
  if (!items.length) {
    body.innerHTML = `<div class="empty-page" style="padding:40px 16px"><strong>Nothing saved yet</strong>
      ${isMap ? "In the map workspace, use the bookmark button at the top of the explorer panel to save a view." : "Pick or draw an area in the map workspace, then select Save area."}
      <br /><a class="btn btn-primary" href="#/map">Go to the map</a></div>`;
    return;
  }
  body.innerHTML = `<div class="item-list">${items
    .map((it) => {
      let meta = fmtDate(it.created_at);
      if (isMap) {
        const p = it.payload as SavedMapPayload;
        meta = `${hazardLabel(p.hazard, hazardsList)} · ${p.layers.length} layer${p.layers.length === 1 ? "" : "s"}${p.aoi ? ` · ${p.aoi.name}` : ""} · ${meta}`;
      } else {
        const p = it.payload as SavedAoiPayload;
        meta = `${p.source === "drawn" ? "Drawn area" : p.level === "lga" ? "LGA" : p.level === "ward" ? "Ward" : "Boundary"} · ${meta}`;
      }
      return `<div class="item-row" data-id="${it.id}">
        <span class="item-icon">${isMap ? I.map : I.pin}</span>
        <div><strong>${escapeHtml(it.name)}</strong><small>${escapeHtml(meta)}</small></div>
        <button type="button" class="btn btn-outline" data-act="open">Open${isMap ? "" : " on map"}</button>
        <button type="button" class="btn btn-ghost" data-act="delete" aria-label="Delete ${escapeHtml(it.name)}">Delete</button>
      </div>`;
    })
    .join("")}</div>`;
  body.addEventListener("click", async (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
    const row = btn?.closest<HTMLElement>(".item-row");
    const it = items.find((x) => x.id === Number(row?.dataset.id));
    if (!btn || !it) return;
    if (btn.dataset.act === "open") {
      go("map");
      if (isMap) emit("open-saved-map", it.payload as SavedMapPayload);
      else emit("open-saved-aoi", it.payload as SavedAoiPayload);
    } else {
      const ok = await confirmDialog({ title: `Delete "${it.name}"?`, text: "This removes it from your saved items.", confirm: "Delete", danger: true });
      if (!ok) return;
      try {
        await savedItems.remove(it.id);
        toast("Deleted.", "info", 2000);
        void renderItems(kind);
      } catch (err) {
        toast((err as Error).message, "error");
      }
    }
  });
}

function renderAlerts(u: User): void {
  const prefs = (u.preferences.alerts ?? {}) as Record<string, boolean>;
  const rows = ALERTS.filter((a) => !a.adminOnly || u.role === "admin")
    .map(
      (a) => `<label class="toggle-row"><span><strong>${a.title}</strong><small>${a.text}</small></span>
        <input type="checkbox" class="switch" data-key="${a.key}" ${prefs[a.key] ?? a.key !== "weekly_digest" ? "checked" : ""} /></label>`
    )
    .join("");
  $("settings-panel").innerHTML = card(
    "Alerts",
    "Choose what shows up in your notifications (the bell in the top bar).",
    rows,
    `<span class="status-msg" id="al-msg" aria-live="polite"></span>`
  );
  $("settings-panel").addEventListener(
    "change",
    async (e) => {
      const input = e.target as HTMLInputElement;
      if (!input.dataset.key) return;
      const next: Record<string, boolean> = {};
      $("settings-panel").querySelectorAll<HTMLInputElement>("input[data-key]").forEach((i) => (next[i.dataset.key!] = i.checked));
      try {
        await session.updateProfile({ preferences: { ...session.user!.preferences, alerts: next } });
        $("al-msg").textContent = "Saved.";
      } catch (err) {
        input.checked = !input.checked;
        toast((err as Error).message, "error");
      }
    },
    { once: false }
  );
}

function renderSecurity(u: User): void {
  $("settings-panel").innerHTML =
    card(
      "Change password",
      "Use at least 8 characters. You'll stay signed in on this device.",
      `<form id="pw-form" class="form-grid" novalidate>
        ${field("pw-current", "Current password", I.lock, "", { type: "password" })}
        <div></div>
        ${field("pw-new", "New password", I.lock, "", { type: "password" })}
        ${field("pw-confirm", "Confirm new password", I.lock, "", { type: "password" })}
        <button type="submit" hidden></button>
      </form>
      <p class="form-error" id="pw-error" hidden></p>`,
      `<button type="button" class="btn btn-primary" id="pw-save">Update password</button>`
    ) +
    `<div style="height:18px"></div>` +
    card(
      "Session",
      `Signed in as ${escapeHtml(u.email)}.`,
      `<p class="muted" style="font-size:13px">Signing out removes your session from this browser. Saved maps, areas and submissions stay on your account.</p>`,
      `<button type="button" class="btn btn-danger" id="sign-out">Sign out</button>`
    );
  ["pw-current", "pw-new", "pw-confirm"].forEach((id) => {
    const i = $<HTMLInputElement>(id);
    i.autocomplete = id === "pw-current" ? "current-password" : "new-password";
  });
  const save = async () => {
    const err = $("pw-error");
    const cur = $<HTMLInputElement>("pw-current").value;
    const nw = $<HTMLInputElement>("pw-new").value;
    const cf = $<HTMLInputElement>("pw-confirm").value;
    const fail = (m: string, id: string) => {
      err.textContent = m;
      err.hidden = false;
      $(id).focus();
    };
    if (!cur) return fail("Enter your current password.", "pw-current");
    if (nw.length < 8) return fail("Use a new password of at least 8 characters.", "pw-new");
    if (nw !== cf) return fail("The new passwords don't match.", "pw-confirm");
    err.hidden = true;
    const btn = $<HTMLButtonElement>("pw-save");
    btn.disabled = true;
    setBusy(btn, true);
    try {
      await session.changePassword(cur, nw);
      toast("Password updated.", "success", 3000);
      (["pw-current", "pw-new", "pw-confirm"] as const).forEach((id) => ($<HTMLInputElement>(id).value = ""));
    } catch (ex) {
      fail((ex as Error).message, "pw-current");
    } finally {
      btn.disabled = false;
      setBusy(btn, false);
    }
  };
  $("pw-save").addEventListener("click", save);
  $("pw-form").addEventListener("submit", (e) => {
    e.preventDefault();
    void save();
  });
  $("sign-out").addEventListener("click", () => {
    session.logout();
    toast("You've signed out.", "info", 2500);
    go("map");
  });
}

function renderTab(): void {
  const u = session.user;
  if (!u) return;
  $("settings-tabs")
    .querySelectorAll<HTMLButtonElement>("button[data-tab]")
    .forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  // Fresh node each time so per-tab listeners don't pile up.
  const old = $("settings-panel");
  const fresh = old.cloneNode(false) as HTMLElement;
  old.replaceWith(fresh);
  if (tab === "profile") renderProfile(u);
  else if (tab === "maps") void renderItems("map");
  else if (tab === "aois") void renderItems("aoi");
  else if (tab === "alerts") renderAlerts(u);
  else renderSecurity(u);
}

/* ---------- side cards ---------- */

function renderSide(u: User): void {
  const admin = u.role === "admin";
  $("settings-badge").querySelector("span")!.textContent = admin ? "Verified Reviewer" : "Verified Contributor";
  $("settings-joined").textContent = `Joined ${fmtDate(u.created_at, { month: "long", year: "numeric" })}`;
  $("tier-name").textContent = admin ? "Reviewer" : "Contributor";
  $("tier-desc").textContent = admin
    ? "Your account can submit datasets and review, publish or return submissions from any contributor, across all LGAs."
    : "Your account can explore every public layer, save maps and areas, and submit datasets for review across all LGAs. Publishing is done by a reviewer.";
  const req = $<HTMLButtonElement>("request-access");
  const pending = u.preferences.access_request;
  req.hidden = admin;
  req.disabled = !!pending;
  req.innerHTML = pending
    ? `Request sent ${escapeHtml(fmtDate(pending.at))}`
    : `Request expanded permissions <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/></svg>`;
}

async function renderPromo(): Promise<void> {
  try {
    const page = await records.list({ tab: "published", pageSize: 1 });
    const latest = page.items[0];
    $("promo-text").textContent = latest
      ? `${latest.title} (${latest.region}) is now available in the Data Portal.`
      : "No datasets have been published yet. Yours could be the first.";
  } catch {
    /* keep default text */
  }
}

function requestAccessDialog(): void {
  const body = openModal(
    `<form class="modal-form">
      <h2 id="generic-modal-title">Request expanded permissions</h2>
      <p>Reviewers can publish and return dataset submissions. Tell the administrators why you need it.</p>
      <div class="field"><label for="ra-note">Reason</label><textarea id="ra-note" maxlength="1000" required placeholder="e.g. I coordinate flood datasets for the Ikeja and Eti-Osa divisions."></textarea></div>
      <div class="modal-actions"><button type="button" data-cancel>Cancel</button><button type="submit" class="primary">Send request</button></div>
    </form>`
  );
  body.querySelector("[data-cancel]")!.addEventListener("click", closeModal);
  body.querySelector("form")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    const note = body.querySelector<HTMLTextAreaElement>("#ra-note")!.value.trim();
    if (!note) return body.querySelector<HTMLTextAreaElement>("#ra-note")!.focus();
    try {
      await session.requestAccess(note);
      closeModal();
      toast("Request sent. An administrator will review it.", "success", 3500);
    } catch (err) {
      toast((err as Error).message, "error");
    }
  });
}

export function initSettings(): void {
  $("settings-tabs").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-tab]");
    if (!b) return;
    tab = b.dataset.tab as Tab;
    history.replaceState(null, "", `#/settings?tab=${tab}`);
    renderTab();
  });
  $("request-access").addEventListener("click", requestAccessDialog);
  session.onChange((u) => {
    if (u && !$("view-settings").hidden) renderSide(u);
  });
  onShow("settings", (params) => {
    const t = params.get("tab") as Tab | null;
    tab = t && ["profile", "maps", "aois", "alerts", "security"].includes(t) ? t : "profile";
    const u = session.user!;
    renderSide(u);
    renderTab();
    void renderPromo();
  });
}
