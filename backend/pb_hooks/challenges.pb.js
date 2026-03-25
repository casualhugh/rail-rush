/// <reference path="../pb_data/types.d.ts" />

function _clearChallengeFromStation(app, challenge) {
  const stationId = challenge.get("station_id");
  if (!stationId) return;
  try {
    const station = app.findRecordById("stations", stationId);
    station.set("is_challenge_location", false);
    station.set("active_challenge_id", "");
    app.save(station);
  } catch (_) {}
}

function _drawChallenges(app, game) {
  const { writeEvent } = require(`${__hooks}/shared.js`);
  const gameId = game.id;
  const maxActive = game.get("max_active_challenges") || 10;

  const activeCount = app.findRecordsByFilter(
    "challenges", "game_id = {:gameId} && status = 'active'", "", 0, 0, { gameId }
  ).length;

  const drawCount = activeCount >= maxActive ? 1 : 2;

  const pool = app.findRecordsByFilter(
    "challenges", "game_id = {:gameId} && status = 'undrawn'", "", 0, 0, { gameId }
  );
  if (pool.length === 0) return;

  const availableStations = app.findRecordsByFilter(
    "stations",
    "game_id = {:gameId} && (active_challenge_id = '' || active_challenge_id = null)",
    "", 0, 0, { gameId }
  );

  const shuffled = pool.slice().sort(() => Math.random() - 0.5);
  const toDraw = shuffled.slice(0, Math.min(drawCount, pool.length));

  for (const challenge of toDraw) {
    let targetStation = null;

    const pinnedStationId = challenge.get("station_id");
    if (pinnedStationId) {
      const idx = availableStations.findIndex(s => s.id === pinnedStationId);
      if (idx !== -1) {
        targetStation = availableStations.splice(idx, 1)[0];
      }
    }

    if (!targetStation && availableStations.length > 0) {
      const idx = Math.floor(Math.random() * availableStations.length);
      targetStation = availableStations.splice(idx, 1)[0];
    }

    challenge.set("status", "active");
    if (targetStation) {
      challenge.set("station_id", targetStation.id);
      app.save(challenge);
      targetStation.set("is_challenge_location", true);
      targetStation.set("active_challenge_id", challenge.id);
      app.save(targetStation);
    } else {
      app.save(challenge);
    }

    writeEvent(app, {
      gameId, type: "challenge_drawn",
      challengeId: challenge.id,
      stationId: targetStation ? targetStation.id : "",
    });
  }
}

function _completeChallengeAndDraw(app, challenge, game, teamId) {
  const { writeEvent } = require(`${__hooks}/shared.js`);
  const coinReward = challenge.get("coin_reward") || 0;

  _clearChallengeFromStation(app, challenge);

  challenge.set("status", "completed");
  challenge.set("completed_by_team_id", teamId);
  challenge.set("completed_at", new Date().toISOString());
  app.save(challenge);

  if (coinReward > 0 && teamId) {
    const team = app.findRecordById("teams", teamId);
    team.set("coin_balance", (team.get("coin_balance") || 0) + coinReward);
    app.save(team);
  }

  writeEvent(app, {
    gameId: game.id, type: "challenge_approved",
    teamId, challengeId: challenge.id,
    stationId: challenge.get("station_id") || "",
    coinsInvolved: coinReward,
  });

  _drawChallenges(app, game);
}


// POST /api/rr/challenge/{challengeId}/complete
// Body: { teamId }
routerAdd("POST", "/api/rr/challenge/{challengeId}/complete", (e) => {
  const { writeEvent } = require(`${__hooks}/shared.js`);
  const authRecord = e.auth;
  if (!authRecord) throw new UnauthorizedError("unauthenticated");

  const challengeId = e.request.pathValue("challengeId");
  const body = e.requestInfo().body;
  const teamId = body.teamId;
  if (!teamId) throw new BadRequestError("teamId is required");

  let challenge;
  try { challenge = e.app.findRecordById("challenges", challengeId); }
  catch (_) { throw new NotFoundError("challenge not found"); }

  if (challenge.get("status") !== "active") throw new BadRequestError("challenge is not active");

  const game = e.app.findRecordById("games", challenge.get("game_id"));
  if (game.get("status") !== "active") throw new BadRequestError("game is not active");

  if (game.get("require_host_approval")) {
    challenge.set("status", "pending_approval");
    challenge.set("completed_by_team_id", teamId);
    challenge.set("submitted_at", new Date().toISOString());
    e.app.save(challenge);

    writeEvent(e.app, {
      gameId: game.id, type: "challenge_submitted",
      teamId, challengeId, stationId: challenge.get("station_id") || "",
    });

    return e.json(200, { ok: true, status: "pending_approval" });
  }

  _completeChallengeAndDraw(e.app, challenge, game, teamId);
  return e.json(200, { ok: true, status: "completed", coinsAwarded: challenge.get("coin_reward") });
});


// POST /api/rr/challenge/{challengeId}/fail
// Body: { teamId }
routerAdd("POST", "/api/rr/challenge/{challengeId}/fail", (e) => {
  const { writeEvent } = require(`${__hooks}/shared.js`);
  const authRecord = e.auth;
  if (!authRecord) throw new UnauthorizedError("unauthenticated");

  const challengeId = e.request.pathValue("challengeId");
  const { teamId } = e.requestInfo().body;
  if (!teamId) throw new BadRequestError("teamId is required");

  let challenge;
  try { challenge = e.app.findRecordById("challenges", challengeId); }
  catch (_) { throw new NotFoundError("challenge not found"); }

  if (challenge.get("status") !== "active") throw new BadRequestError("challenge is not active");

  const game = e.app.findRecordById("games", challenge.get("game_id"));
  if (game.get("status") !== "active") throw new BadRequestError("game is not active");

  _clearChallengeFromStation(e.app, challenge);

  challenge.set("status", "failed");
  challenge.set("completed_by_team_id", teamId);
  challenge.set("completed_at", new Date().toISOString());
  e.app.save(challenge);

  writeEvent(e.app, {
    gameId: game.id, type: "challenge_failed",
    teamId, challengeId, stationId: challenge.get("station_id") || "",
  });

  _drawChallenges(e.app, game);
  return e.json(200, { ok: true });
});


// POST /api/rr/challenge/{challengeId}/approve  (host only)
routerAdd("POST", "/api/rr/challenge/{challengeId}/approve", (e) => {
  const authRecord = e.auth;
  if (!authRecord) throw new UnauthorizedError("unauthenticated");

  const challengeId = e.request.pathValue("challengeId");

  let challenge;
  try { challenge = e.app.findRecordById("challenges", challengeId); }
  catch (_) { throw new NotFoundError("challenge not found"); }

  if (challenge.get("status") !== "pending_approval") throw new BadRequestError("challenge is not pending approval");

  const game = e.app.findRecordById("games", challenge.get("game_id"));
  if (game.get("host_user_id") !== authRecord.id) throw new ForbiddenError("only the host can approve challenges");

  _completeChallengeAndDraw(e.app, challenge, game, challenge.get("completed_by_team_id"));
  return e.json(200, { ok: true, coinsAwarded: challenge.get("coin_reward") });
});


// POST /api/rr/challenge/{challengeId}/reject  (host only)
// Body: { reason?: string }
routerAdd("POST", "/api/rr/challenge/{challengeId}/reject", (e) => {
  const { writeEvent } = require(`${__hooks}/shared.js`);
  const authRecord = e.auth;
  if (!authRecord) throw new UnauthorizedError("unauthenticated");

  const challengeId = e.request.pathValue("challengeId");
  const body = e.requestInfo().body;

  let challenge;
  try { challenge = e.app.findRecordById("challenges", challengeId); }
  catch (_) { throw new NotFoundError("challenge not found"); }

  if (challenge.get("status") !== "pending_approval") throw new BadRequestError("challenge is not pending approval");

  const game = e.app.findRecordById("games", challenge.get("game_id"));
  if (game.get("host_user_id") !== authRecord.id) throw new ForbiddenError("only the host can reject challenges");

  const teamId = challenge.get("completed_by_team_id");
  const reason = body.reason || "";

  challenge.set("status", "active");
  challenge.set("completed_by_team_id", "");
  challenge.set("submitted_at", "");
  challenge.set("rejected_reason", reason);
  e.app.save(challenge);

  writeEvent(e.app, {
    gameId: game.id, type: "challenge_rejected",
    teamId, challengeId, stationId: challenge.get("station_id") || "",
    meta: { reason },
  });

  return e.json(200, { ok: true });
});


// POST /api/rr/game/{gameId}/challenges
// Body: array of challenge definitions — saves the host's challenge list before game start.
routerAdd("POST", "/api/rr/game/{gameId}/challenges", (e) => {
  const authRecord = e.auth;
  if (!authRecord) throw new UnauthorizedError("unauthenticated");

  const gameId = e.request.pathValue("gameId");

  let game;
  try { game = e.app.findRecordById("games", gameId); }
  catch (_) { throw new NotFoundError("game not found"); }

  if (game.get("host_user_id") !== authRecord.id) throw new ForbiddenError("only the host can add challenges");
  if (game.get("status") !== "lobby") throw new BadRequestError("challenges can only be added in lobby");

  const body = e.requestInfo().body;
  const items = Array.isArray(body) ? body : body.challenges;
  if (!items || items.length === 0) throw new BadRequestError("no challenges provided");

  const existing = e.app.findRecordsByFilter(
    "challenges", "game_id = {:gameId} && status = 'undrawn'", "", 0, 0, { gameId }
  );
  for (const c of existing) e.app.delete(c);

  const col = e.app.findCollectionByNameOrId("challenges");
  const ids = [];
  for (const item of items) {
    const c = new Record(col);
    c.set("game_id", gameId);
    c.set("description", item.description);
    c.set("coin_reward", item.coinReward || 5);
    c.set("difficulty", item.difficulty || "medium");
    c.set("source", item.source || "host_authored");
    c.set("bank_source_id", item.bankSourceId || "");
    c.set("status", "undrawn");
    if (item.stationId) c.set("station_id", item.stationId);
    e.app.save(c);
    ids.push(c.id);
  }

  return e.json(201, { created: ids.length, ids });
});


// GET /api/rr/game/{gameId}/challenges/pending  (host only)
routerAdd("GET", "/api/rr/game/{gameId}/challenges/pending", (e) => {
  const authRecord = e.auth;
  if (!authRecord) throw new UnauthorizedError("unauthenticated");

  const gameId = e.request.pathValue("gameId");

  let game;
  try { game = e.app.findRecordById("games", gameId); }
  catch (_) { throw new NotFoundError("game not found"); }

  if (game.get("host_user_id") !== authRecord.id) throw new ForbiddenError("host only");

  const pending = e.app.findRecordsByFilter(
    "challenges", "game_id = {:gameId} && status = 'pending_approval'", "", 0, 0, { gameId }
  );

  return e.json(200, pending.map(c => ({
    id: c.id,
    description: c.get("description"),
    coinReward: c.get("coin_reward"),
    difficulty: c.get("difficulty"),
    submittedByTeamId: c.get("completed_by_team_id"),
    submittedAt: c.get("submitted_at"),
    stationId: c.get("station_id"),
  })));
});
