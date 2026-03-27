/// <reference path="../pb_data/types.d.ts" />

// POST /api/rr/game
// Body: { name, expectedEndTime, startingCoins, maxStakeIncrement, tollCost,
//         maxActiveChallenges, requireHostApproval, spectatorsAllowed, cityName,
//         teams: [{name, color}] }
routerAdd("POST", "/api/rr/game", (e) => {
  const authRecord = e.auth;
  if (!authRecord) throw new UnauthorizedError("unauthenticated");

  const body = e.requestInfo().body;
  if (!body.name) throw new BadRequestError("name is required");
  if (!body.startingCoins || body.startingCoins < 1) throw new BadRequestError("startingCoins must be ≥ 1");
  if (!body.teams || body.teams.length < 2) throw new BadRequestError("at least 2 teams required");

  const gameCol = e.app.findCollectionByNameOrId("games");
  const game = new Record(gameCol);
  game.set("host_user_id", authRecord.id);
  game.set("name", body.name);
  game.set("status", "lobby");
  game.set("city_name", body.cityName || "");
  game.set("starting_coins", body.startingCoins);
  game.set("max_stake_increment", body.maxStakeIncrement ?? 5);
  game.set("toll_cost", body.tollCost ?? 3);
  game.set("max_active_challenges", body.maxActiveChallenges ?? 10);
  game.set("require_host_approval", body.requireHostApproval ?? false);
  game.set("spectators_allowed", body.spectatorsAllowed ?? true);
  if (body.expectedEndTime) game.set("expected_end_time", body.expectedEndTime);
  const gameCode = $security.randomStringWithAlphabet(6, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
  game.set("invite_code", gameCode);
  e.app.save(game);

  const teamCol = e.app.findCollectionByNameOrId("teams");
  const createdTeams = [];
  for (const t of body.teams) {
    const team = new Record(teamCol);
    team.set("game_id", game.id);
    team.set("name", t.name);
    team.set("color", t.color);
    team.set("coin_balance", body.startingCoins);
    e.app.save(team);
    createdTeams.push({ id: team.id, name: t.name, color: t.color });
  }

  return e.json(201, { gameId: game.id, inviteCode: gameCode, teams: createdTeams });
});


// POST /api/rr/game/{gameId}/start
routerAdd("POST", "/api/rr/game/{gameId}/start", (e) => {
  const { writeEvent } = require(`${__hooks}/shared.js`);
  const authRecord = e.auth;
  if (!authRecord) throw new UnauthorizedError("unauthenticated");

  const gameId = e.request.pathValue("gameId");

  let game;
  try { game = e.app.findRecordById("games", gameId); }
  catch (_) { throw new NotFoundError("game not found"); }

  if (game.get("host_user_id") !== authRecord.id) throw new ForbiddenError("only the host can start the game");
  if (game.get("status") !== "lobby") throw new BadRequestError("game is not in lobby");

  // Validate ≥2 teams each with ≥1 approved member
  const teams = e.app.findRecordsByFilter("teams", "game_id = {:gameId}", "", 0, 0, { gameId });
  if (teams.length < 2) throw new BadRequestError("need at least 2 teams");

  let readyTeams = 0;
  for (const team of teams) {
    const members = e.app.findRecordsByFilter(
      "team_members",
      "team_id = {:teamId} && approved_by_host = true",
      "", 1, 0, { teamId: team.id }
    );
    if (members.length > 0) readyTeams++;
  }
  if (readyTeams < 2) throw new BadRequestError("need at least 2 teams with approved members");

  const stations = e.app.findRecordsByFilter("stations", "game_id = {:gameId}", "", 0, 0, { gameId });
  const allChallenges = e.app.findRecordsByFilter(
    "challenges", "game_id = {:gameId} && status = 'undrawn'", "", 0, 0, { gameId }
  );

  // Shuffle and draw up to 3
  const shuffled = allChallenges.slice().sort(() => Math.random() - 0.5);
  const toDraw = shuffled.slice(0, Math.min(3, shuffled.length));

  const availableStations = stations.filter(s => !s.get("active_challenge_id"));

  for (const challenge of toDraw) {
    let targetStation = null;

    const pinnedStationId = challenge.get("station_id");
    if (pinnedStationId) {
      try { targetStation = e.app.findRecordById("stations", pinnedStationId); } catch (_) {}
    }

    if (!targetStation && availableStations.length > 0) {
      const idx = Math.floor(Math.random() * availableStations.length);
      targetStation = availableStations.splice(idx, 1)[0];
    }

    challenge.set("status", "active");
    if (targetStation) {
      challenge.set("station_id", targetStation.id);
      e.app.save(challenge);
      targetStation.set("is_challenge_location", true);
      targetStation.set("active_challenge_id", challenge.id);
      e.app.save(targetStation);
    } else {
      e.app.save(challenge);
    }

    writeEvent(e.app, {
      gameId,
      type: "challenge_drawn",
      challengeId: challenge.id,
      stationId: targetStation ? targetStation.id : "",
    });
  }

  game.set("status", "active");
  game.set("started_at", new Date().toISOString());
  e.app.save(game);

  writeEvent(e.app, { gameId, type: "game_started" });

  return e.json(200, { ok: true, challengesDrawn: toDraw.length });
});


// POST /api/rr/game/{gameId}/end
routerAdd("POST", "/api/rr/game/{gameId}/end", (e) => {
  const { writeEvent } = require(`${__hooks}/shared.js`);
  const authRecord = e.auth;
  if (!authRecord) throw new UnauthorizedError("unauthenticated");

  const gameId = e.request.pathValue("gameId");

  let game;
  try { game = e.app.findRecordById("games", gameId); }
  catch (_) { throw new NotFoundError("game not found"); }

  if (game.get("host_user_id") !== authRecord.id) throw new ForbiddenError("only the host can end the game");
  if (game.get("status") !== "active") throw new BadRequestError("game is not active");

  const teams = e.app.findRecordsByFilter("teams", "game_id = {:gameId}", "", 0, 0, { gameId });

  const scores = teams.map(team => {
    const owned = e.app.findRecordsByFilter(
      "stations",
      "game_id = {:gameId} && current_owner_team_id = {:teamId}",
      "", 0, 0, { gameId, teamId: team.id }
    );
    const stationCount = owned.length;
    const totalStaked = owned.reduce((sum, s) => sum + (s.get("current_stake") || 0), 0);
    return {
      teamId: team.id,
      teamName: team.get("name"),
      color: team.get("color"),
      stationCount,
      totalStaked,
      coinBalance: team.get("coin_balance"),
    };
  });

  scores.sort((a, b) => b.stationCount !== a.stationCount
    ? b.stationCount - a.stationCount
    : b.totalStaked - a.totalStaked
  );
  scores.forEach((s, i) => { s.rank = i + 1; });

  game.set("status", "ended");
  game.set("ended_at", new Date().toISOString());
  e.app.save(game);

  writeEvent(e.app, { gameId, type: "game_ended", meta: { final_scores: scores } });

  return e.json(200, { scores });
});


// DELETE /api/rr/game/{gameId}
// Host deletes a game and all associated data.
routerAdd("DELETE", "/api/rr/game/{gameId}", (e) => {
  const authRecord = e.auth;
  if (!authRecord) throw new UnauthorizedError("unauthenticated");

  const gameId = e.request.pathValue("gameId");

  let game;
  try { game = e.app.findRecordById("games", gameId); }
  catch (_) { throw new NotFoundError("game not found"); }

  if (game.get("host_user_id") !== authRecord.id) {
    throw new ForbiddenError("only the host can delete the game");
  }

  // Delete team_members → teams → stations/challenges/events
  e.app.runInTransaction((txApp) => {
    const teams = txApp.findRecordsByFilter("teams", "game_id = {:gid}", "", 0, 0, { gid: gameId });
    for (const team of teams) {
      const members = txApp.findRecordsByFilter("team_members", "team_id = {:tid}", "", 0, 0, { tid: team.id });
      for (const m of members) txApp.delete(m);
      txApp.delete(team);
    }

    const stations = txApp.findRecordsByFilter("stations", "game_id = {:gid}", "", 0, 0, { gid: gameId });
    for (const s of stations) {
      const claims = txApp.findRecordsByFilter("station_claims", "station_id = {:sid}", "", 0, 0, { sid: s.id });
      for (const c of claims) txApp.delete(c);
      txApp.delete(s);
    }

    const challenges = txApp.findRecordsByFilter("challenges", "game_id = {:gid}", "", 0, 0, { gid: gameId });
    for (const c of challenges) txApp.delete(c);

    const events = txApp.findRecordsByFilter("events", "game_id = {:gid}", "", 0, 0, { gid: gameId });
    for (const ev of events) txApp.delete(ev);

    const tolls = txApp.findRecordsByFilter("toll_payments", "game_id = {:gid}", "", 0, 0, { gid: gameId });
    for (const t of tolls) txApp.delete(t);

    txApp.delete(game);
  });

  return e.json(200, { ok: true });
});


// GET /api/rr/game/{gameId}
// Full game state for initial load / refresh.
routerAdd("GET", "/api/rr/game/{gameId}", (e) => {
  const authRecord = e.auth;
  if (!authRecord) throw new UnauthorizedError("unauthenticated");

  const gameId = e.request.pathValue("gameId");

  let game;
  try { game = e.app.findRecordById("games", gameId); }
  catch (_) { throw new NotFoundError("game not found"); }

  const teams = e.app.findRecordsByFilter("teams", "game_id = {:gameId}", "", 0, 0, { gameId });
  const stations = e.app.findRecordsByFilter("stations", "game_id = {:gameId}", "", 0, 0, { gameId });
  const challenges = e.app.findRecordsByFilter(
    "challenges",
    "game_id = {:gameId} && (status = 'active' || status = 'pending_approval')",
    "", 0, 0, { gameId }
  );

  return e.json(200, {
    id: game.id,
    name: game.get("name"),
    status: game.get("status"),
    hostUserId: game.get("host_user_id"),
    inviteCode: game.get("invite_code"),
    startingCoins: game.get("starting_coins"),
    maxStakeIncrement: game.get("max_stake_increment"),
    tollCost: game.get("toll_cost"),
    maxActiveChallenges: game.get("max_active_challenges"),
    requireHostApproval: game.get("require_host_approval"),
    expectedEndTime: game.get("expected_end_time"),
    startedAt: game.get("started_at"),
    endedAt: game.get("ended_at"),
    teams: teams.map(t => ({
      id: t.id,
      name: t.get("name"),
      color: t.get("color"),
      coinBalance: t.get("coin_balance"),
      currentLat: t.get("current_lat"),
      currentLng: t.get("current_lng"),
    })),
    stations: stations.map(s => ({
      id: s.id,
      name: s.get("name"),
      lat: s.get("lat"),
      lng: s.get("lng"),
      ownerTeamId: s.get("current_owner_team_id"),
      currentStake: s.get("current_stake"),
      isChallengeLocation: s.get("is_challenge_location"),
      activeChallengeId: s.get("active_challenge_id"),
    })),
    challenges: challenges.map(c => ({
      id: c.id,
      stationId: c.get("station_id"),
      description: c.get("description"),
      coinReward: c.get("coin_reward"),
      difficulty: c.get("difficulty"),
      status: c.get("status"),
      completedByTeamId: c.get("completed_by_team_id"),
      attemptingTeamId: c.get("attempting_team_id") || null,
      failedTeamIds: c.get("failed_team_ids") || [],
    })),
  });
});
