import { session } from "./session";

/* ==========================================================================
   Hash router. Every screen lives in index.html; routing just shows one,
   marks the nav, and calls that view's onShow. Hash routes need no server
   config, so the existing StaticFiles mount keeps working as-is.
   ========================================================================== */

export type Route = "login" | "map" | "analysis" | "library" | "portal" | "reports" | "settings";

const VIEW_FOR: Record<Route, string> = {
  login: "view-login",
  map: "view-map",
  analysis: "view-map",
  library: "view-library",
  portal: "view-portal",
  reports: "view-reports",
  settings: "view-settings",
};

const TITLES: Record<Route, string> = {
  login: "Sign in",
  map: "Map Workspace",
  analysis: "Hazard Analysis",
  library: "Layer Library",
  portal: "Data Portal",
  reports: "Reporting",
  settings: "Account Settings",
};

/** Routes that need a signed-in user. */
const PROTECTED = new Set<Route>(["portal", "settings"]);

type ShowHandler = (params: URLSearchParams, route: Route) => void;
const handlers = new Map<Route, ShowHandler[]>();
let current: Route | null = null;

export function parseHash(): { route: Route; params: URLSearchParams } {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, query] = raw.split("?");
  const route = (path in VIEW_FOR ? path : "map") as Route;
  return { route, params: new URLSearchParams(query ?? "") };
}

export function onShow(route: Route, fn: ShowHandler): void {
  handlers.set(route, [...(handlers.get(route) ?? []), fn]);
}

export function go(route: Route, params?: Record<string, string>): void {
  const qs = params && Object.keys(params).length ? `?${new URLSearchParams(params)}` : "";
  const next = `#/${route}${qs}`;
  if (location.hash === next) render();
  else location.hash = next;
}

export function currentRoute(): Route | null {
  return current;
}

function render(): void {
  const { route, params } = parseHash();
  if (PROTECTED.has(route) && !session.signedIn) {
    location.replace(`#/login?next=${route}`);
    return;
  }
  if (route === "login" && session.signedIn) {
    location.replace(`#/${params.get("next") ?? "map"}`);
    return;
  }

  const loginView = document.getElementById("view-login")!;
  const shell = document.getElementById("app-shell")!;
  loginView.hidden = route !== "login";
  shell.hidden = route === "login";

  const target = VIEW_FOR[route];
  document.querySelectorAll<HTMLElement>("#main-content > .view").forEach((v) => {
    v.hidden = v.id !== target;
  });

  document.querySelectorAll<HTMLElement>("[data-route]").forEach((el) => {
    const routes = (el.dataset.route ?? "").split(" ");
    const on = routes.includes(route);
    el.classList.toggle("active", on);
    if (on) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });

  document.title = `${TITLES[route]} · Lagos State Risk Atlas`;
  const changed = current !== route;
  current = route;
  document.getElementById("app-shell")?.classList.remove("nav-open");
  const scrim = document.getElementById("nav-scrim");
  if (scrim) scrim.hidden = true;
  if (changed && target !== "view-map") document.getElementById(target)?.scrollTo(0, 0);
  // Leaflet re-measures on window resize; the map may have been laid out
  // while hidden, so nudge it whenever its view is shown.
  if (target === "view-map") window.setTimeout(() => window.dispatchEvent(new Event("resize")), 0);
  (handlers.get(route) ?? []).forEach((fn) => fn(params, route));
}

export function startRouter(): void {
  window.addEventListener("hashchange", render);
  // Signing out while on a protected page sends you to the public map.
  session.onChange(() => {
    if (current && PROTECTED.has(current) && !session.signedIn) location.replace("#/login?next=" + current);
  });
  render();
}
