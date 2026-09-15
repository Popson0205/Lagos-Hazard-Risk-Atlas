/** Bounding box [minLon, minLat, maxLon, maxLat] of any GeoJSON geometry —
 * used to scope requests (imagery search, vector feature fetches, raster
 * tile bounds) to the selected AOI instead of always covering all of Lagos. */
export function geometryBbox(geometry: GeoJSON.Geometry): [number, number, number, number] {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  const visit = (coords: any): void => {
    if (typeof coords[0] === "number") {
      const [lon, lat] = coords as [number, number];
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    } else {
      coords.forEach(visit);
    }
  };
  visit((geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon).coordinates);
  return [minLon, minLat, maxLon, maxLat];
}
