/// <reference path="../pb_data/types.d.ts" />

// POST /api/rr/osm/stations
// Body: { polygon: [[lat, lng], ...] }
// Returns OSM railway stations within the polygon, with 1-hour caching.
routerAdd("POST", "/api/rr/osm/stations", (e) => {
  const authRecord = e.auth;
  if (!authRecord) throw new UnauthorizedError("unauthenticated");

  const body = e.requestInfo().body;
  const polygon = body.polygon; // array of [lat, lng] pairs
  if (!Array.isArray(polygon) || polygon.length < 3) {
    throw new BadRequestError("polygon must have at least 3 points");
  }

  // Build a hash key for caching
  const bboxKey = polygon.map(p => `${p[0].toFixed(4)},${p[1].toFixed(4)}`).join(';');

  // Check cache (1 hour TTL)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const cached = e.app.findRecordsByFilter(
    "osm_station_cache",
    "bbox_hash = {:key} && fetched_at > {:cutoff}",
    "", 1, 0, { key: bboxKey, cutoff: oneHourAgo }
  );
  if (cached.length > 0) {
    return e.json(200, { stations: cached[0].get("stations_json"), fromCache: true });
  }

  // Build Overpass query using the polygon
  const polyStr = polygon.map(p => `${p[0]} ${p[1]}`).join(' ');
  const query = `[out:json][timeout:10];(node["railway"="station"](poly:"${polyStr}");node["railway"="halt"](poly:"${polyStr}");node["railway"="tram_stop"](poly:"${polyStr}"););out;`;

  const MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
  ];

  let stations = [];
  let resp = null;
  for (const mirror of MIRRORS) {
    try {
      resp = $http.send({
        url: mirror + "?data=" + encodeURIComponent(query),
        method: "GET",
        timeout: 20,
      });
      if (resp.statusCode === 200 && resp.json) break;
      resp = null;
    } catch (_) {
      resp = null;
    }
  }
  if (!resp) {
    throw new BadRequestError("All Overpass mirrors failed — try again later");
  }
  try {
    stations = (resp.json.elements || []).map(n => ({
      id: `osm:${n.id}`,
      name: n.tags?.name || n.tags?.["name:en"] || "Unnamed Station",
      lat: n.lat,
      lng: n.lon,
    }));
  } catch (err) {
    throw new BadRequestError("Failed to parse OSM response: " + err.message);
  }

  // Cache the result
  const col = e.app.findCollectionByNameOrId("osm_station_cache");
  const rec = new Record(col);
  rec.set("bbox_hash", bboxKey);
  rec.set("stations_json", stations);
  rec.set("fetched_at", new Date().toISOString());
  e.app.save(rec);

  return e.json(200, { stations, fromCache: false });
});
