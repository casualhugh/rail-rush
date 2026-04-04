/// <reference path="../pb_data/types.d.ts" />

// GET /api/rr/maps
// Query params: search (optional), limit (default 20), offset (default 0)
routerAdd("GET", "/api/rr/maps", (e) => {
  const authRecord = e.auth;
  if (!authRecord) throw new UnauthorizedError("unauthenticated");

  const q = e.request.url.query();
  const search = q.get("search") || "";
  const limit = parseInt(q.get("limit") || "20", 10);
  const offset = parseInt(q.get("offset") || "0", 10);

  let filter = "is_public = true";
  const params = {};
  if (search) {
    filter += " && (name ~ {:search} || city_name ~ {:search})";
    params.search = search;
  }

  const records = e.app.findRecordsByFilter(
    "map_templates",
    filter,
    "-times_used",
    limit,
    offset,
    params
  );

  return e.json(200, records.map(r => ({
    id: r.id,
    name: r.get("name"),
    cityName: r.get("city_name") || null,
    stationCount: r.get("station_count"),
    timesUsed: r.get("times_used"),
  })));
});


// GET /api/rr/maps/:id
routerAdd("GET", "/api/rr/maps/{id}", (e) => {
  const authRecord = e.auth;
  if (!authRecord) throw new UnauthorizedError("unauthenticated");

  const id = e.request.pathValue("id");
  let record;
  try { record = e.app.findRecordById("map_templates", id); }
  catch (_) { throw new NotFoundError("map template not found"); }

  const raw = record.get("stations");
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  const stations = (data && data.stations) ? data.stations : [];
  const connections = (data && data.connections) ? data.connections : [];

  const rawBounds = record.get("map_bounds");
  const mapBounds = typeof rawBounds === "string" ? JSON.parse(rawBounds) : rawBounds;

  return e.json(200, {
    id: record.id,
    name: record.get("name"),
    cityName: record.get("city_name") || null,
    mapBounds,
    stations,
    connections,
    stationCount: record.get("station_count"),
    timesUsed: record.get("times_used"),
  });
});


// POST /api/rr/maps
// Body: { name, cityName?, mapBounds, stations, connections }
routerAdd("POST", "/api/rr/maps", (e) => {
  const authRecord = e.auth;
  if (!authRecord) throw new UnauthorizedError("unauthenticated");

  const body = e.requestInfo().body;
  if (!body.name) throw new BadRequestError("name is required");
  if (!body.stations || !Array.isArray(body.stations)) throw new BadRequestError("stations is required");
  if (!body.mapBounds) throw new BadRequestError("mapBounds is required");

  const col = e.app.findCollectionByNameOrId("map_templates");
  const record = new Record(col);
  record.set("created_by_user_id", authRecord.id);
  record.set("name", body.name);
  record.set("city_name", body.cityName || "");
  record.set("map_bounds", JSON.stringify(body.mapBounds));
  record.set("stations", JSON.stringify({
    stations: body.stations,
    connections: body.connections || [],
  }));
  record.set("station_count", body.stations.length);
  record.set("is_public", true);
  record.set("times_used", 0);
  e.app.save(record);

  return e.json(201, { id: record.id });
});
