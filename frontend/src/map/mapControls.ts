import L from "leaflet";
import type { BasemapOption } from "./mapInit";

/** A fixed (non-rotating) north arrow — this map never rotates, so a
 * static "up is north" indicator is all that's needed; a compass that
 * tracks bearing would be over-engineering for a map with no rotation
 * control. */
export function addNorthArrow(map: L.Map): void {
  const NorthArrowControl = L.Control.extend({
    options: { position: "topleft" as L.ControlPosition },
    onAdd(): HTMLElement {
      const container = L.DomUtil.create("div", "map-control north-arrow-control");
      container.setAttribute("aria-label", "North");
      container.title = "North";
      container.innerHTML =
        '<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">' +
        '<polygon points="10,1 14,11 10,8.5 6,11" fill="#e5e7eb"/>' +
        '<polygon points="10,8.5 14,11 10,19 6,11" fill="#4b5563"/>' +
        '<text x="10" y="9" text-anchor="middle" font-size="6" font-family="system-ui, sans-serif" ' +
        'font-weight="700" fill="#0f172a">N</text>' +
        "</svg>";
      L.DomEvent.disableClickPropagation(container);
      return container;
    },
  });
  new NorthArrowControl().addTo(map);
}

/** Leaflet's built-in scale control — metric only, since this is a Lagos
 * State (Nigeria) tool and imperial units would be an odd default here. */
export function addScaleBar(map: L.Map): void {
  L.control.scale({ position: "bottomleft", metric: true, imperial: false, maxWidth: 140 }).addTo(map);
}

/** A small basemap switcher matching the app's own panel styling, rather
 * than Leaflet's default white L.control.layers box which would clash with
 * the dark theme. Swaps the active tile layer in place; the basemaps
 * themselves are already isolated on their own map pane (see mapInit.ts)
 * so this can never visually cover an active hazard layer. */
export function addBasemapSwitcher(map: L.Map, basemaps: BasemapOption[]): void {
  let activeId = basemaps[0]?.id;

  const BasemapSwitcherControl = L.Control.extend({
    options: { position: "topright" as L.ControlPosition },
    onAdd(): HTMLElement {
      const container = L.DomUtil.create("div", "map-control basemap-switcher");
      const list = L.DomUtil.create("div", "basemap-switcher-list", container);

      const buttons = basemaps.map((basemap) => {
        const btn = L.DomUtil.create("button", "basemap-switcher-btn", list) as HTMLButtonElement;
        btn.type = "button";
        btn.textContent = basemap.label;
        if (basemap.id === activeId) btn.classList.add("active");

        L.DomEvent.on(btn, "click", () => {
          if (basemap.id === activeId) return;
          for (const other of basemaps) {
            if (map.hasLayer(other.layer)) map.removeLayer(other.layer);
          }
          basemap.layer.addTo(map);
          activeId = basemap.id;
          buttons.forEach(([otherBtn, otherBasemap]) => {
            otherBtn.classList.toggle("active", otherBasemap.id === activeId);
          });
        });

        return [btn, basemap] as const;
      });

      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);
      return container;
    },
  });
  new BasemapSwitcherControl().addTo(map);
}
