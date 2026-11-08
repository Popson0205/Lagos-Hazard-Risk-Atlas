import "leaflet/dist/leaflet.css";
import "./style.css";
import { startRouter } from "./router";
import { session } from "./session";
import { initShell } from "./shell";
import { initUI } from "./ui";
import { initLibrary } from "./views/library";
import { initLogin } from "./views/login";
import { initMapWorkspace } from "./views/mapWorkspace";
import { initPortal } from "./views/portal";
import { initReports } from "./views/reports";
import { initSettings } from "./views/settings";

async function boot(): Promise<void> {
  initUI();
  initShell();
  initLogin();
  initLibrary();
  initPortal();
  initReports();
  initSettings();
  // Restore a remembered session before routing, so protected pages
  // (portal, settings) don't bounce a signed-in user to the login screen.
  await session.restore();
  startRouter();
  // The map loads its catalogue in the background; the router has already
  // shown whichever screen the URL asked for.
  await initMapWorkspace();
}

void boot();
