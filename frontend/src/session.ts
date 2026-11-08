import type { DatasetRecord, RecordPage, RecordStats, SavedItem, User } from "./types";

/* ==========================================================================
   Signed-in session + the authenticated API (accounts, Data Portal, saved
   items). The public map API stays in api/client.ts and needs no token.

   "Remember this device for 30 days" keeps the token in localStorage;
   otherwise it lives in sessionStorage and goes when the tab closes.
   ========================================================================== */

const BASE = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";
const KEY = "atlas-session";

type Listener = (user: User | null) => void;

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

let token: string | null = safe(() => localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY), null);
let user: User | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  listeners.forEach((l) => l(user));
}

function store(t: string | null, remember: boolean): void {
  token = t;
  safe(() => {
    localStorage.removeItem(KEY);
    sessionStorage.removeItem(KEY);
    if (t) (remember ? localStorage : sessionStorage).setItem(KEY, t);
  }, undefined);
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError("Can't reach the atlas server. Check your connection and try again.", 0);
  }
  if (res.status === 401 && token) {
    // Expired or revoked: drop the session so the UI shows signed-out state.
    store(null, false);
    user = null;
    emit();
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    let msg: string = `Request failed (${res.status}).`;
    if (typeof data?.detail === "string") msg = data.detail;
    else if (Array.isArray(data?.detail) && data.detail[0]?.msg) {
      const d = data.detail[0];
      const field = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : "";
      msg = `${String(field).replace(/_/g, " ")}: ${String(d.msg).replace(/^Value error, /, "")}`;
    }
    throw new ApiError(msg, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const session = {
  get user(): User | null {
    return user;
  },
  get signedIn(): boolean {
    return !!user;
  },
  get isAdmin(): boolean {
    return user?.role === "admin";
  },
  onChange(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /** Restore a remembered session on page load. */
  async restore(): Promise<User | null> {
    if (!token) return null;
    try {
      user = await request<User>("GET", "/auth/me");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) store(null, false);
      user = null;
    }
    emit();
    return user;
  },

  async login(email: string, password: string, remember: boolean): Promise<User> {
    const out = await request<{ token: string; user: User }>("POST", "/auth/login", { email, password, remember });
    store(out.token, remember);
    user = out.user;
    emit();
    return user;
  },

  async signup(body: { email: string; password: string; full_name: string; organization?: string; remember: boolean }): Promise<User> {
    const out = await request<{ token: string; user: User }>("POST", "/auth/signup", body);
    store(out.token, body.remember);
    user = out.user;
    emit();
    return user;
  },

  logout(): void {
    store(null, false);
    user = null;
    emit();
  },

  async updateProfile(patch: Partial<Pick<User, "full_name" | "professional_role" | "organization" | "preferences">>): Promise<User> {
    user = await request<User>("PATCH", "/auth/me", patch);
    emit();
    return user;
  },

  changePassword: (current_password: string, new_password: string) =>
    request<void>("POST", "/auth/password", { current_password, new_password }),

  async uploadAvatar(dataUrl: string): Promise<User> {
    user = await request<User>("PUT", "/auth/me/avatar", { image: dataUrl });
    emit();
    return user;
  },

  async removeAvatar(): Promise<User> {
    user = await request<User>("DELETE", "/auth/me/avatar");
    emit();
    return user;
  },

  async requestAccess(note: string): Promise<User> {
    user = await request<User>("POST", "/auth/request-access", { note });
    emit();
    return user;
  },

  /** Authenticated file download (CSV export) — fetch with the token, then
   * hand the browser a blob, since a plain link can't carry the header. */
  async download(path: string, fallbackName: string): Promise<void> {
    const res = await fetch(`${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new ApiError(`Export failed (${res.status}).`, res.status);
    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? fallbackName;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  },
};

export const records = {
  list(params: { tab?: string; q?: string; hazard?: string; region?: string; page?: number; pageSize?: number }) {
    const qs = new URLSearchParams();
    if (params.tab && params.tab !== "all") qs.set("tab", params.tab);
    if (params.q) qs.set("q", params.q);
    if (params.hazard) qs.set("hazard", params.hazard);
    if (params.region) qs.set("region", params.region);
    qs.set("page", String(params.page ?? 1));
    qs.set("page_size", String(params.pageSize ?? 10));
    return request<RecordPage>("GET", `/records?${qs}`);
  },
  stats: () => request<RecordStats>("GET", "/records/stats"),
  get: (id: number) => request<DatasetRecord>("GET", `/records/${id}`),
  create: (body: Partial<DatasetRecord> & { status: "draft" | "submitted" }) => request<DatasetRecord>("POST", "/records", body),
  update: (id: number, body: Partial<DatasetRecord>) => request<DatasetRecord>("PATCH", `/records/${id}`, body),
  setStatus: (id: number, status: string, note?: string) => request<DatasetRecord>("POST", `/records/${id}/status`, { status, note }),
  remove: (id: number) => request<void>("DELETE", `/records/${id}`),
  exportCsv(params: { tab?: string; q?: string; hazard?: string }) {
    const qs = new URLSearchParams();
    if (params.tab && params.tab !== "all") qs.set("tab", params.tab);
    if (params.q) qs.set("q", params.q);
    if (params.hazard) qs.set("hazard", params.hazard);
    return session.download(`/records/export.csv?${qs}`, "risk-atlas-inventory.csv");
  },
};

export const savedItems = {
  list: <P>(kind: "map" | "aoi") => request<SavedItem<P>[]>("GET", `/me/items?kind=${kind}`),
  create: <P>(kind: "map" | "aoi", name: string, payload: P) => request<SavedItem<P>>("POST", "/me/items", { kind, name, payload }),
  remove: (id: number) => request<void>("DELETE", `/me/items/${id}`),
};
