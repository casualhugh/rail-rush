/// <reference path="../pb_data/types.d.ts" />

// PATCH /api/rr/team/{teamId}/location
// Body: { lat: number, lng: number }
// Rate-limited: max 1 update per 8 seconds per team.
routerAdd("PATCH", "/api/rr/team/{teamId}/location", (e) => {
  const authRecord = e.auth;
  if (!authRecord) throw new UnauthorizedError("unauthenticated");

  const teamId = e.request.pathValue("teamId");
  const body = e.requestInfo().body;
  const lat = parseFloat(body.lat);
  const lng = parseFloat(body.lng);

  if (isNaN(lat) || isNaN(lng)) throw new BadRequestError("lat and lng are required numbers");
  if (lat < -90 || lat > 90) throw new BadRequestError("lat must be between -90 and 90");
  if (lng < -180 || lng > 180) throw new BadRequestError("lng must be between -180 and 180");

  let team;
  try { team = e.app.findRecordById("teams", teamId); }
  catch (_) { throw new NotFoundError("team not found"); }

  // Verify caller is an approved member of this team
  const members = e.app.findRecordsByFilter(
    "team_members",
    "team_id = {:teamId} && user_id = {:userId} && approved_by_host = true",
    "", 1, 0, { teamId, userId: authRecord.id }
  );
  if (!members || members.length === 0) throw new ForbiddenError("not a member of this team");

  // Rate limit: reject if last update was < 8 seconds ago
  const lastUpdated = team.get("location_updated_at");
  if (lastUpdated) {
    const lastMs = new Date(lastUpdated).getTime();
    if (Date.now() - lastMs < 8000) {
      return e.json(429, { error: "rate limited — location updates max once per 8 seconds" });
    }
  }

  team.set("current_lat", lat);
  team.set("current_lng", lng);
  team.set("location_updated_at", new Date().toISOString());
  e.app.save(team);
  // PocketBase's native SSE subscription on the `teams` collection broadcasts
  // this change to all subscribed clients automatically.

  return e.json(200, { ok: true });
});
