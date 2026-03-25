/// <reference path="../pb_data/types.d.ts" />

// POST /api/rr/game/{gameId}/join
// Body: { teamId: string }
// Player requests to join a game on a specific team.
routerAdd("POST", "/api/rr/game/{gameId}/join", (e) => {
  const { writeEvent } = require(`${__hooks}/shared.js`);
  const authRecord = e.auth;
  if (!authRecord) throw new UnauthorizedError("unauthenticated");

  const gameId = e.request.pathValue("gameId");
  const body   = e.requestInfo().body;
  const teamId = body.teamId;

  if (!teamId) throw new BadRequestError("teamId is required");

  let game;
  try {
    game = e.app.findRecordById("games", gameId);
  } catch (_) {
    throw new NotFoundError("game not found");
  }
  if (game.get("status") !== "lobby") {
    throw new BadRequestError("game is not in lobby");
  }

  let team;
  try {
    team = e.app.findRecordById("teams", teamId);
  } catch (_) {
    throw new NotFoundError("team not found");
  }
  if (team.get("game_id") !== gameId) {
    throw new BadRequestError("team does not belong to this game");
  }

  // Check the user isn't already in this game on any team
  const gameTeams = e.app.findRecordsByFilter("teams", "game_id = {:gid}", "", 0, 0, { gid: gameId });
  for (const t of gameTeams) {
    const existing = e.app.findRecordsByFilter(
      "team_members",
      "team_id = {:tid} && user_id = {:uid}",
      "", 1, 0,
      { tid: t.id, uid: authRecord.id }
    );
    if (existing.length > 0) throw new BadRequestError("already joined this game");
  }

  const displayName = authRecord.getString("name") || authRecord.getString("email") || "Player";

  const col    = e.app.findCollectionByNameOrId("team_members");
  const member = new Record(col);
  member.set("team_id",          teamId);
  member.set("user_id",          authRecord.id);
  member.set("display_name",     displayName);
  member.set("role",             "member");
  member.set("approved_by_host", false);
  member.set("joined_at",        new Date().toISOString());
  e.app.save(member);

  writeEvent(e.app, {
    gameId,
    type:   "player_joined",
    teamId,
    meta:   { user_id: authRecord.id, member_id: member.id },
  });

  return e.json(200, { memberId: member.id });
});


// POST /api/rr/game/{gameId}/leave
// Player removes themselves from their current team in the lobby.
routerAdd("POST", "/api/rr/game/{gameId}/leave", (e) => {
  const authRecord = e.auth;
  if (!authRecord) throw new UnauthorizedError("unauthenticated");

  const gameId = e.request.pathValue("gameId");

  let game;
  try {
    game = e.app.findRecordById("games", gameId);
  } catch (_) {
    throw new NotFoundError("game not found");
  }
  if (game.get("status") !== "lobby") {
    throw new BadRequestError("can only leave during lobby");
  }

  // Find the player's team_member record for any team in this game
  const gameTeams = e.app.findRecordsByFilter("teams", "game_id = {:gid}", "", 0, 0, { gid: gameId });
  for (const team of gameTeams) {
    const members = e.app.findRecordsByFilter(
      "team_members",
      "team_id = {:tid} && user_id = {:uid}",
      "", 1, 0,
      { tid: team.id, uid: authRecord.id }
    );
    if (members.length > 0) {
      e.app.delete(members[0]);
      return e.json(200, { ok: true });
    }
  }

  throw new NotFoundError("not a member of this game");
});


// POST /api/rr/game/{gameId}/approve/{memberId}
// Host approves a pending join request.
routerAdd("POST", "/api/rr/game/{gameId}/approve/{memberId}", (e) => {
  const authRecord = e.auth;
  if (!authRecord) throw new UnauthorizedError("unauthenticated");

  const gameId   = e.request.pathValue("gameId");
  const memberId = e.request.pathValue("memberId");

  let game;
  try {
    game = e.app.findRecordById("games", gameId);
  } catch (_) {
    throw new NotFoundError("game not found");
  }
  if (game.get("host_user_id") !== authRecord.id) {
    throw new ForbiddenError("only the host can approve players");
  }

  let member;
  try {
    member = e.app.findRecordById("team_members", memberId);
  } catch (_) {
    throw new NotFoundError("member not found");
  }

  const team = e.app.findRecordById("teams", member.get("team_id"));
  if (team.get("game_id") !== gameId) {
    throw new BadRequestError("member does not belong to this game");
  }

  member.set("approved_by_host", true);
  e.app.save(member);

  return e.json(200, { ok: true });
});


// POST /api/rr/game/{gameId}/deny/{memberId}
// Host denies a pending join request — deletes the TeamMember record.
routerAdd("POST", "/api/rr/game/{gameId}/deny/{memberId}", (e) => {
  const authRecord = e.auth;
  if (!authRecord) throw new UnauthorizedError("unauthenticated");

  const gameId   = e.request.pathValue("gameId");
  const memberId = e.request.pathValue("memberId");

  let game;
  try {
    game = e.app.findRecordById("games", gameId);
  } catch (_) {
    throw new NotFoundError("game not found");
  }
  if (game.get("host_user_id") !== authRecord.id) {
    throw new ForbiddenError("only the host can deny players");
  }

  let member;
  try {
    member = e.app.findRecordById("team_members", memberId);
  } catch (_) {
    throw new NotFoundError("member not found");
  }

  e.app.delete(member);
  return e.json(200, { ok: true });
});
