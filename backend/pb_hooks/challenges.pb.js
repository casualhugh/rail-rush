/// <reference path="../pb_data/types.d.ts" />

function getFailedTeamIds(challenge) {
  const raw = challenge.get("failed_team_ids");
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string" && raw) { try { return JSON.parse(raw); } catch (_) {} }
  return [];
}

// POST /api/rr/challenge/{challengeId}/claim
// Body: { teamId }
routerAdd("POST", "/api/rr/challenge/{challengeId}/claim", (e) => {
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

  // Check team not blocked (in failed_team_ids)
  const failedTeams = getFailedTeamIds(challenge);
  if (failedTeams.includes(teamId)) {
    throw new ForbiddenError("your team failed this challenge — wait for another team to attempt it first");
  }

  // Check team doesn't already have an active challenge claimed
  const existingClaim = e.app.findRecordsByFilter(
    "challenges",
    "game_id = {:gameId} && attempting_team_id = {:teamId} && status = 'active'",
    "", 1, 0, { gameId: game.id, teamId }
  );
  if (existingClaim.length > 0) {
    throw new BadRequestError("your team is already attempting another challenge — complete or fail it first");
  }

  // Claim: set attempting_team_id, clear failed_team_ids (unblocks previously failed teams)
  challenge.set("attempting_team_id", teamId);
  challenge.set("failed_team_ids", "[]");
  e.app.save(challenge);

  writeEvent(e.app, {
    gameId: game.id, type: "challenge_claimed",
    teamId, challengeId, stationId: challenge.get("station_id") || "",
  });

  return e.json(200, { ok: true });
});


// POST /api/rr/challenge/{challengeId}/complete
// Body: { teamId }
routerAdd("POST", "/api/rr/challenge/{challengeId}/complete", (e) => {
  const { writeEvent, _completeChallengeAndDraw } = require(`${__hooks}/shared.js`);
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

  const attemptingTeamComplete = challenge.get("attempting_team_id");
  if (attemptingTeamComplete && attemptingTeamComplete !== teamId) {
    throw new ForbiddenError("another team is currently attempting this challenge");
  }

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
  const { writeEvent, _clearChallengeFromStation, _drawChallenges } = require(`${__hooks}/shared.js`);
  const authRecord = e.auth;
  if (!authRecord) throw new UnauthorizedError("unauthenticated");

  const challengeId = e.request.pathValue("challengeId");
  const { teamId } = e.requestInfo().body;
  if (!teamId) throw new BadRequestError("teamId is required");

  let challenge;
  try { challenge = e.app.findRecordById("challenges", challengeId); }
  catch (_) { throw new NotFoundError("challenge not found"); }

  if (challenge.get("status") !== "active") throw new BadRequestError("challenge is not active");

  // Guard: only the attempting team can fail
  const attemptingTeam = challenge.get("attempting_team_id");
  if (attemptingTeam && attemptingTeam !== teamId) {
    throw new ForbiddenError("another team is currently attempting this challenge");
  }

  const game = e.app.findRecordById("games", challenge.get("game_id"));
  if (game.get("status") !== "active") throw new BadRequestError("game is not active");

  // Escalate reward by 25%
  const currentReward = challenge.get("coin_reward") || 0;
  const newReward = Math.ceil(currentReward * 1.25);
  const failCount = (challenge.get("fail_count") || 0) + 1;

  // Track which teams have failed
  const failedTeams = getFailedTeamIds(challenge);
  if (!failedTeams.includes(teamId)) failedTeams.push(teamId);

  // Check if ALL teams in the game have failed → clear and redraw
  const gameTeams = e.app.findRecordsByFilter("teams", "game_id = {:gid}", "", 0, 0, { gid: game.id });
  const allFailed = gameTeams.every(t => failedTeams.includes(t.id));

  writeEvent(e.app, {
    gameId: game.id, type: "challenge_failed",
    teamId, challengeId, stationId: challenge.get("station_id") || "",
    meta: { newReward, failCount },
  });

  if (allFailed) {
    // Everyone has failed — clear and redraw
    _clearChallengeFromStation(e.app, challenge);
    challenge.set("status", "failed");
    challenge.set("completed_by_team_id", teamId);
    challenge.set("completed_at", new Date().toISOString());
    challenge.set("attempting_team_id", "");
    challenge.set("failed_team_ids", JSON.stringify(failedTeams));
    challenge.set("fail_count", failCount);
    e.app.save(challenge);
    _drawChallenges(e.app, game);
  } else {
    // Keep challenge active with escalated reward and blocked team
    challenge.set("coin_reward", newReward);
    challenge.set("fail_count", failCount);
    challenge.set("failed_team_ids", JSON.stringify(failedTeams));
    challenge.set("attempting_team_id", "");
    e.app.save(challenge);
  }

  return e.json(200, { ok: true, newReward: allFailed ? 0 : newReward, allFailed });
});


// POST /api/rr/challenge/{challengeId}/impossible  (host only)
routerAdd("POST", "/api/rr/challenge/{challengeId}/impossible", (e) => {
  const { writeEvent, _clearChallengeFromStation, _drawChallenges } = require(`${__hooks}/shared.js`);
  const authRecord = e.auth;
  if (!authRecord) throw new UnauthorizedError("unauthenticated");

  const challengeId = e.request.pathValue("challengeId");

  let challenge;
  try { challenge = e.app.findRecordById("challenges", challengeId); }
  catch (_) { throw new NotFoundError("challenge not found"); }

  const game = e.app.findRecordById("games", challenge.get("game_id"));
  if (game.get("host_user_id") !== authRecord.id) throw new ForbiddenError("only the host can mark challenges impossible");
  if (game.get("status") !== "active") throw new BadRequestError("game is not active");

  const stationId = challenge.get("station_id") || "";

  _clearChallengeFromStation(e.app, challenge);
  challenge.set("status", "impossible");
  challenge.set("attempting_team_id", "");
  challenge.set("completed_at", new Date().toISOString());
  e.app.save(challenge);

  writeEvent(e.app, {
    gameId: game.id, type: "challenge_impossible",
    challengeId, stationId,
  });

  _drawChallenges(e.app, game);
  return e.json(200, { ok: true });
});


// POST /api/rr/challenge/{challengeId}/approve  (host only)
routerAdd("POST", "/api/rr/challenge/{challengeId}/approve", (e) => {
  const { _completeChallengeAndDraw } = require(`${__hooks}/shared.js`);
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
