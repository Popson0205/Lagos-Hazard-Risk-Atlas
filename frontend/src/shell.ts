import { api } from "./api/client";
import { emit } from "./bus";
import { getCatalogue, hazardLabel } from "./catalogue";
import { go } from "./router";
import { records, session } from "./session";
import type { User } from "./types";
import { escapeHtml, fmtDate, openModal, paintAvatar, showWelcome, toast } from "./ui";

/* ==========================================================================
   App chrome shared by every screen: navigation rail, top bar (search,
   notifications, user menu), the map status bar, help and policy dialogs.
   ========================================================================== */

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function roleLabel(u: User | null): string {
  if (!u) return "Not signed in";
  return u.role === "admin" ? "Reviewer" : "Contributor";
}

/* ---------- popovers ---------- */

function popover(btn: HTMLElement, pop: HTMLElement, onOpen?: () => void): (open?: boolean) => void {
  const set = (open: boolean) => {
    pop.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    if (open) onOpen?.();
  };
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    set(pop.hidden);
  });
  document.addEventListener("click", (e) => {
    if (!pop.hidden && !pop.contains(e.target as Node)) set(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !pop.hidden) {
      set(false);
      btn.focus();
    }
  });
  return (open = false) => set(open);
}

const ICON = {
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  map: '<svg viewBox="0 0 24 24"><path d="M3 6.5l6-2.5 6 2.5 6-2.5v13.5l-6 2.5-6-2.5-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/></svg>',
  db: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>',
  out: '<svg viewBox="0 0 24 24"><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/></svg>',
  in: '<svg viewBox="0 0 24 24"><path d="M15 4h4v16h-4M10 8l4 4-4 4M4 12h10"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  layers: '<svg viewBox="0 0 24 24"><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
};

function userMenuHtml(u: User | null): string {
  if (!u) {
    return `
      <div class="menu-head"><strong>Public access</strong><small>Sign in to manage datasets and save maps.</small></div>
      <a href="#/login" role="menuitem">${ICON.in}Sign in</a>
      <a href="#/login?mode=signup" role="menuitem">${ICON.plus}Create an account</a>`;
  }
  return `
    <div class="menu-head"><strong>${escapeHtml(u.full_name)}</strong><small>${escapeHtml(u.email)}</small></div>
    <a href="#/settings" role="menuitem">${ICON.user}Account settings</a>
    <a href="#/settings?tab=maps" role="menuitem">${ICON.map}Saved maps</a>
    <a href="#/portal" role="menuitem">${ICON.db}Data portal</a>
    <hr />
    <button type="button" role="menuitem" class="danger" data-signout>${ICON.out}Sign out</button>`;
}

function renderIdentity(u: User | null): void {
  const name = u ? u.full_name : "Sign in";
  const sub = u ? u.professional_role || roleLabel(u) : "Public access";
  $("user-chip-name").textContent = name;
  $("user-chip-role").textContent = sub;
  const chipAvatar = $("user-chip-avatar");
  if (u) paintAvatar(chipAvatar, u.full_name, u.avatar_url);
  else {
    chipAvatar.classList.remove("has-photo");
    chipAvatar.innerHTML = ICON.user;
  }

  $("nav-user-name").textContent = u ? "Authorized User" : "Public Visitor";
  $("nav-user-role").textContent = roleLabel(u);
  $("user-menu").innerHTML = userMenuHtml(u);
  navMenu.innerHTML = userMenuHtml(u);
  $("bell-btn").hidden = !u;
}

const navMenu = document.createElement("div");

function initMenus(): void {
  navMenu.className = "popover popover-menu";
  navMenu.setAttribute("role", "menu");
  navMenu.hidden = true;
  document.querySelector(".nav-foot")!.appendChild(navMenu);

  const closeUser = popover($("user-chip"), $("user-menu"));
  const closeNav = popover($("nav-user"), navMenu);
  for (const [menu, close] of [[$("user-menu"), closeUser], [navMenu, closeNav]] as const) {
    menu.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("[data-signout]")) {
        session.logout();
        toast("You've signed out.", "info", 2500);
        go("map");
      }
      if (t.closest("a, button")) close(false);
    });
  }
}

/* ---------- mobile nav ---------- */

function initNavToggle(): void {
  const shell = $("app-shell");
  const scrim = $("nav-scrim");
  const btn = $("nav-toggle");
  const set = (open: boolean) => {
    shell.classList.toggle("nav-open", open);
    scrim.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
  };
  btn.addEventListener("click", () => set(!shell.classList.contains("nav-open")));
  scrim.addEventListener("click", () => set(false));
}

/* ---------- notifications ---------- */

const SEEN_KEY = "atlas-bell-seen";

async function loadNotifications(markSeen: boolean): Promise<void> {
  const list = $("bell-list");
  const dot = $("bell-dot");
  const u = session.user;
  if (!u) return;
  type Note = { html: string; at: string; href: string };
  const notes: Note[] = [];
  try {
    const { hazards } = await getCatalogue().catch(() => ({ hazards: [] as never[] }));
    if (session.isAdmin) {
      const pending = await records.list({ tab: "reviewing", pageSize: 5 });
      const waiting = pending.items.filter((r) => r.status === "submitted");
      if (waiting.length) {
        notes.push({
          html: `<strong>${pending.items.filter((r) => r.status === "submitted").length} submission${waiting.length === 1 ? "" : "s"}</strong> waiting for your review`,
          at: waiting[0].updated_at,
          href: "#/portal?tab=reviewing",
        });
      }
    }
    const mine = await records.list({ pageSize: 20 });
    const cutoff = Date.now() - 30 * 86400000;
    for (const r of mine.items) {
      if (new Date(r.updated_at).getTime() < cutoff) continue;
      if (r.owner_id === u.id && (r.status === "published" || r.status === "rejected")) {
        notes.push({
          html: `<strong>${escapeHtml(r.title)}</strong> was ${r.status === "published" ? "published" : "returned for changes"}`,
          at: r.updated_at,
          href: `#/portal?record=${r.id}`,
        });
      } else if (r.owner_id !== u.id && r.status === "published") {
        notes.push({
          html: `New ${escapeHtml(hazardLabel(r.hazard_theme_id, hazards))} dataset: <strong>${escapeHtml(r.title)}</strong>`,
          at: r.updated_at,
          href: `#/portal?record=${r.id}`,
        });
      }
    }
  } catch {
    list.innerHTML = '<li>Couldn\'t load notifications right now.</li>';
    return;
  }
  notes.sort((a, b) => b.at.localeCompare(a.at));
  list.innerHTML = notes.length
    ? notes
        .slice(0, 8)
        .map((n) => `<li><a href="${n.href}">${n.html}<small>${fmtDate(n.at)}</small></a></li>`)
        .join("")
    : "<li>You're all caught up. Updates on your datasets will appear here.</li>";
  let seen = "";
  try {
    seen = localStorage.getItem(SEEN_KEY) ?? "";
  } catch {
    /* ignore */
  }
  const newest = notes[0]?.at ?? "";
  dot.hidden = !newest || newest <= seen;
  if (markSeen && newest) {
    try {
      localStorage.setItem(SEEN_KEY, newest);
    } catch {
      /* ignore */
    }
    dot.hidden = true;
  }
}

function initBell(): void {
  const pop = $("bell-pop");
  popover($("bell-btn"), pop, () => void loadNotifications(true));
  pop.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("a")) pop.hidden = true;
  });
}

/* ---------- global search: places + layers ---------- */

function initSearch(): void {
  const input = $<HTMLInputElement>("search-input");
  const list = $<HTMLUListElement>("search-results");
  let timer: number | undefined;
  let seq = 0;

  input.addEventListener("input", () => {
    window.clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) {
      list.innerHTML = "";
      return;
    }
    timer = window.setTimeout(async () => {
      const mySeq = ++seq;
      const ql = q.toLowerCase();
      const [placesRes, catRes] = await Promise.allSettled([api.search(q), getCatalogue()]);
      if (mySeq !== seq) return;
      list.innerHTML = "";
      const frag = document.createDocumentFragment();
      const heading = (t: string) => {
        const li = document.createElement("li");
        li.className = "sr-heading";
        li.textContent = t;
        frag.appendChild(li);
      };

      if (catRes.status === "fulfilled") {
        const { layers, hazards } = catRes.value;
        const hits = layers
          .filter((l) => `${l.name} ${hazardLabel(l.hazard_theme_id, hazards)}`.toLowerCase().includes(ql))
          .slice(0, 4);
        if (hits.length) heading("Layers");
        for (const l of hits) {
          const li = document.createElement("li");
          li.innerHTML = `${ICON.layers}<span>${escapeHtml(l.name)}</span><span class="sr-kind">${escapeHtml(hazardLabel(l.hazard_theme_id, hazards))}</span>`;
          li.querySelector("svg")!.setAttribute("style", "width:15px;height:15px;color:var(--accent)");
          li.addEventListener("click", () => {
            list.innerHTML = "";
            input.value = "";
            go("map");
            emit("add-layer", { hazard: l.hazard_theme_id, layerId: l.id });
          });
          frag.appendChild(li);
        }
      }

      if (placesRes.status === "fulfilled") {
        const places = placesRes.value.slice(0, 8);
        if (places.length) heading("Places");
        for (const r of places) {
          const li = document.createElement("li");
          const kind = r.level === "lga" ? "LGA" : r.level ? r.level : r.type;
          li.innerHTML = `${ICON.pin}<span>${escapeHtml(r.label)}</span><span class="sr-kind">${escapeHtml(kind)}</span>`;
          li.querySelector("svg")!.setAttribute("style", "width:15px;height:15px;color:var(--text-2)");
          li.addEventListener("click", () => {
            list.innerHTML = "";
            input.value = r.label;
            go("map");
            emit("select-place", r);
          });
          frag.appendChild(li);
        }
      }

      if (!frag.childNodes.length) {
        const li = document.createElement("li");
        li.className = "state-inline";
        li.textContent =
          placesRes.status === "rejected" ? "Place search isn't available right now. Use the boundary lists instead." : "No match. Try a ward, LGA or layer name.";
        frag.appendChild(li);
      }
      list.appendChild(frag);
    }, 250);
  });
}

/* ---------- status bar: system status, version, live weather ---------- */

async function loadStatus(): Promise<void> {
  const dot = $("status-dot");
  const text = $("status-text");
  const chip = $("auth-system-chip");
  try {
    const res = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? "/api/v1"}/status`);
    if (!res.ok) throw new Error();
    const data = (await res.json()) as { status: string; version: string; database?: string };
    $("version-pill").textContent = `v${data.version} Stable`;
    if (data.database === "unreachable") {
      text.textContent = "System status: database unreachable";
      dot.className = "dot warn";
      chip.innerHTML = '<span class="dot warn"></span>Database offline';
      $("support-status").innerHTML = '<span class="dot warn"></span>Database offline';
      return;
    }
    text.textContent = `System status: ${data.status}`;
    dot.className = "dot";
    chip.innerHTML = '<span class="dot"></span>System live';
    $("support-status").innerHTML = '<span class="dot"></span>Operational';
  } catch {
    text.textContent = "System status: unreachable";
    dot.className = "dot bad";
    chip.innerHTML = '<span class="dot bad"></span>Offline';
    $("support-status").innerHTML = '<span class="dot bad"></span>Unreachable';
  }
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

async function loadWeather(): Promise<void> {
  const el = $("status-weather");
  try {
    const url =
      "https://api.open-meteo.com/v1/forecast?latitude=6.5244&longitude=3.3792" +
      "&current=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m&timezone=Africa%2FLagos";
    const res = await fetch(url);
    if (!res.ok) throw new Error();
    const c = (await res.json()).current as Record<string, number>;
    // Open-Meteo reports where the wind comes FROM, like the mockup's "SW".
    const dir = COMPASS[Math.round(((c.wind_direction_10m % 360) / 45)) % 8];
    el.innerHTML =
      `<span><svg viewBox="0 0 24 24"><path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8"/></svg>Wind: <b>${Math.round(c.wind_speed_10m)} km/h ${dir}</b></span>` +
      `<span><svg viewBox="0 0 24 24"><path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/></svg>Humidity: <b>${Math.round(c.relative_humidity_2m)}%</b></span>` +
      `<span><svg viewBox="0 0 24 24"><path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z"/></svg>Temp: <b>${Math.round(c.temperature_2m)}°C</b></span>`;
  } catch {
    el.textContent = "";
  }
}

/* ---------- help & policies ---------- */

function openHelp(): void {
  const body = openModal(
    `<div class="modal-form prose">
      <h2 id="generic-modal-title">Using the Risk Atlas</h2>
      <p>The map is open to everyone. Sign in to submit datasets, save map views and areas, and get alerts.</p>
      <h3>Explore a hazard</h3>
      <ul>
        <li>Choose a <strong>hazard theme</strong> and switch on a <strong>data layer</strong>.</li>
        <li>For satellite layers, use <strong>Satellite Imagery</strong> to pick an exact, low-cloud date.</li>
        <li>Click anywhere on the map to read the value at that point.</li>
      </ul>
      <h3>Analyse an area</h3>
      <ul>
        <li>Pick an LGA and ward under <strong>Administrative Boundaries</strong>, search a place, or draw your own polygon.</li>
        <li>Select <strong>Analyse this area</strong> for a plain-language summary. Results are kept under <strong>Reporting</strong>.</li>
      </ul>
      <h3>Contribute data</h3>
      <ul>
        <li>In the <strong>Data Portal</strong>, create a submission as a draft, then submit it for review. A reviewer publishes it or returns it with notes.</li>
      </ul>
      <p class="modal-note">Layers are derived from open satellite data. Treat them as indicators of conditions, not official risk ratings.</p>
      <div class="modal-actions"><button type="button" data-tour>Show the quick-start card</button><button type="button" class="primary" data-close>Got it</button></div>
    </div>`,
    { wide: true }
  );
  body.querySelector("[data-close]")!.addEventListener("click", () => $("generic-modal-close").click());
  body.querySelector("[data-tour]")!.addEventListener("click", () => {
    $("generic-modal-close").click();
    go("map");
    window.setTimeout(showWelcome, 50);
  });
}

const POLICIES: Record<string, string> = {
  privacy: `<h2 id="generic-modal-title">Privacy Policy</h2>
    <p>The public map needs no account and stores nothing about you on the server. Your browser keeps a few preferences (such as whether you've seen the quick-start card) and the analysis reports you run, which never leave your device.</p>
    <p>If you create an account, the atlas stores your name, work email, organization, role, a salted hash of your password (never the password itself), your saved map views and areas, and the datasets you submit. This is used only to run the portal and is visible to reviewers where it relates to a submission.</p>
    <p>To have your account removed, contact the technical desk.</p>`,
  terms: `<h2 id="generic-modal-title">Terms of Service</h2>
    <p>Hazard layers are derived from open satellite and elevation data and are provided as indicators of conditions, not official risk ratings or engineering assessments. Check them against local knowledge and official sources before acting on them.</p>
    <p>By submitting a dataset you confirm you have the right to share it and that its source and method are described accurately. Reviewers may decline or unpublish a dataset at any time.</p>
    <p>Imagery sources keep their own licences (Copernicus Sentinel-2, USGS Landsat, JRC Global Surface Water, OpenStreetMap, Esri basemaps).</p>`,
};

function initPolicies(): void {
  document.addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest<HTMLElement>("[data-open-policy]");
    if (!a) return;
    e.preventDefault();
    openModal(`<div class="modal-form prose">${POLICIES[a.dataset.openPolicy!] ?? ""}</div>`, { wide: true });
  });
}

/* ---------- init ---------- */

export function initShell(): void {
  initMenus();
  initNavToggle();
  initBell();
  initSearch();
  initPolicies();
  $("help-btn").addEventListener("click", openHelp);
  renderIdentity(session.user);
  session.onChange((u) => {
    renderIdentity(u);
    if (u) void loadNotifications(false);
  });
  void loadStatus();
  void loadWeather();
  window.setInterval(loadWeather, 15 * 60 * 1000);
  window.setInterval(loadStatus, 5 * 60 * 1000);
}
