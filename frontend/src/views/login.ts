import { onShow, go, parseHash, type Route } from "../router";
import { session } from "../session";
import { firstName, setBusy, toast } from "../ui";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export function initLogin(): void {
  const form = $<HTMLFormElement>("auth-form");
  const tabLogin = $("auth-tab-login");
  const tabSignup = $("auth-tab-signup");
  const err = $("auth-error");
  const info = $("auth-info");
  const submit = $<HTMLButtonElement>("auth-submit");
  const pwd = $<HTMLInputElement>("auth-password");
  let mode: "login" | "signup" = "login";

  function setMode(m: "login" | "signup"): void {
    mode = m;
    tabLogin.setAttribute("aria-selected", String(m === "login"));
    tabSignup.setAttribute("aria-selected", String(m === "signup"));
    form.querySelectorAll<HTMLElement>(".signup-only").forEach((el) => (el.hidden = m !== "signup"));
    form.querySelectorAll<HTMLElement>(".login-only").forEach((el) => (el.hidden = m !== "login"));
    $("auth-title").textContent = m === "login" ? "Welcome to the Portal" : "Create your account";
    $("auth-sub").textContent =
      m === "login"
        ? "Please enter your credentials to access the Atlas management tools."
        : "Contributors can submit datasets, save map views and areas, and receive alerts.";
    submit.querySelector(".btn-label")!.textContent = m === "login" ? "Access Map Exploration" : "Create Account";
    pwd.autocomplete = m === "login" ? "current-password" : "new-password";
    err.hidden = true;
    info.hidden = true;
  }

  tabLogin.addEventListener("click", () => setMode("login"));
  tabSignup.addEventListener("click", () => setMode("signup"));

  $("auth-reveal").addEventListener("click", (e) => {
    const btn = e.currentTarget as HTMLButtonElement;
    const show = pwd.type === "password";
    pwd.type = show ? "text" : "password";
    btn.setAttribute("aria-pressed", String(show));
    btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
  });

  $("auth-forgot").addEventListener("click", () => {
    err.hidden = true;
    info.hidden = false;
    info.textContent =
      "Password resets are handled by the technical desk. Contact your Risk Atlas administrator with your work email and they'll reset it for you.";
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.hidden = true;
    info.hidden = true;
    const email = $<HTMLInputElement>("auth-email").value.trim();
    const password = pwd.value;
    const remember = $<HTMLInputElement>("auth-remember").checked;
    const fullName = $<HTMLInputElement>("auth-name").value.trim();

    const fail = (msg: string, field?: HTMLElement) => {
      err.textContent = msg;
      err.hidden = false;
      field?.focus();
    };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("Enter your work email address.", $("auth-email"));
    if (mode === "signup" && fullName.length < 2) return fail("Enter your full name.", $("auth-name"));
    if (!password) return fail("Enter your password.", pwd);
    if (mode === "signup" && password.length < 8) return fail("Use a password of at least 8 characters.", pwd);

    submit.disabled = true;
    setBusy(submit, true);
    try {
      if (mode === "login") {
        const u = await session.login(email, password, remember);
        toast(`Welcome back, ${firstName(u.full_name)}.`, "success", 3000);
      } else {
        const u = await session.signup({
          email,
          password,
          full_name: fullName,
          organization: $<HTMLInputElement>("auth-org").value.trim() || undefined,
          remember,
        });
        toast(`Account created. Welcome, ${firstName(u.full_name)}.`, "success", 3500);
      }
      pwd.value = "";
      const next = (parseHash().params.get("next") as Route | null) ?? "map";
      go(next === "login" ? "map" : next);
    } catch (ex) {
      fail((ex as Error).message);
    } finally {
      submit.disabled = false;
      setBusy(submit, false);
    }
  });

  onShow("login", (params) => {
    setMode(params.get("mode") === "signup" ? "signup" : "login");
    const next = params.get("next");
    if (next && next !== "map") {
      info.hidden = false;
      info.textContent = "Sign in to open the " + (next === "portal" ? "Data Portal." : "account settings.");
    }
    window.setTimeout(() => $<HTMLInputElement>(mode === "signup" ? "auth-name" : "auth-email").focus(), 30);
  });
}
