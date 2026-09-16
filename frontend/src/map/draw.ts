import L from "leaflet";

export interface DrawnAoi {
  source: "drawn";
  geometry: GeoJSON.Polygon;
}

/**
 * Minimal click-to-add-vertices polygon drawer. Deliberately avoids pulling
 * in leaflet-draw (one more dependency + CSS bundle) for a tool this small:
 * click the map to add points, "Finish drawing" closes the ring, "Cancel"
 * aborts. Good enough for "let the user plot their own boundary" without
 * extra plugin weight.
 */
export class PolygonDrawTool {
  private map: L.Map;
  private points: L.LatLng[] = [];
  private markers: L.CircleMarker[] = [];
  private guideLine: L.Polyline | null = null;
  private active = false;

  onChange: (pointCount: number) => void = () => {};

  constructor(map: L.Map) {
    this.map = map;
  }

  isActive(): boolean {
    return this.active;
  }

  start(): void {
    this.cancel(); // reset any previous in-progress drawing
    this.active = true;
    this.map.getContainer().style.cursor = "crosshair";
    this.map.on("click", this.handleClick);
  }

  private handleClick = (e: L.LeafletMouseEvent): void => {
    this.points.push(e.latlng);
    const marker = L.circleMarker(e.latlng, {
      radius: 4,
      color: "#f472b6",
      fillColor: "#f472b6",
      fillOpacity: 1,
    }).addTo(this.map);
    this.markers.push(marker);

    if (this.guideLine) {
      this.map.removeLayer(this.guideLine);
    }
    this.guideLine = L.polyline(this.points, { color: "#f472b6", weight: 2, dashArray: "4 4" }).addTo(this.map);

    this.onChange(this.points.length);
  };

  /** Closes the ring and returns the polygon, or null if fewer than 3 points were placed. */
  finish(): DrawnAoi | null {
    const result = this.points.length >= 3 ? this.buildGeometry() : null;
    this.cancel();
    return result;
  }

  private buildGeometry(): DrawnAoi {
    const ring = this.points.map((p) => [p.lng, p.lat] as [number, number]);
    ring.push(ring[0]); // close the ring
    return { source: "drawn", geometry: { type: "Polygon", coordinates: [ring] } };
  }

  cancel(): void {
    this.active = false;
    this.map.getContainer().style.cursor = "";
    this.map.off("click", this.handleClick);
    this.markers.forEach((m) => this.map.removeLayer(m));
    this.markers = [];
    if (this.guideLine) {
      this.map.removeLayer(this.guideLine);
      this.guideLine = null;
    }
    this.points = [];
  }
}
