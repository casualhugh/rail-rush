/// <reference path="../pb_data/types.d.ts" />

// POST /api/rr/station/{stationId}/claim
// Body: { teamId, coins (1–5) }
routerAdd("POST", "/api/rr/station/{stationId}/claim", (e) => {
  const { writeEvent } = require(`${__hooks}/shared.js`);
  const authRecord = e.auth;
  if (!authRecord) throw new UnauthorizedError("unauthenticated");

  const stationId = e.request.pathValue("stationId");
  const body = e.requestInfo().body;
  const teamId = body.teamId;
  const coins = parseInt(body.coins, 10);

  if (!teamId) throw new BadRequestError("teamId is required");
  if (!coins || coins < 1 || coins > 5) throw new BadRequestError("coins must be between 1 and 5");

  let station;
  try { station = e.app.findRecordById("stations", stationId); }
  catch (_) { throw new NotFoundError("station not found"); }

  const game = e.app.findRecordById("games", station.get("game_id"));
  if (game.get("status") !== "active") throw new BadRequestError("game is not active");
  if (station.get("current_owner_team_id")) throw new BadRequestError("station is already claimed");

  const team = e.app.findRecordById("teams", teamId);
  if (team.get("game_id") !== game.id) throw new BadRequestError("team does not belong to this game");
  if (team.get("coin_balance") < coins) throw new BadRequestError("insufficient coins");

  const _claimMembers = e.app.findRecordsByFilter("team_members", "team_id = {:teamId} && user_id = {:userId} && approved_by_host = true", "", 1, 0, { teamId, userId: authRecord.id });
  if (!_claimMembers || _claimMembers.length === 0) throw new ForbiddenError("you are not an approved member of this team");

  e.app.runInTransaction((txApp) => {
    team.set("coin_balance", team.get("coin_balance") - coins);
    txApp.save(team);

    const claimCol = txApp.findCollectionByNameOrId("station_claims");
    const claim = new Record(claimCol);
    claim.set("station_id", stationId);
    claim.set("game_id", game.id);
    claim.set("team_id", teamId);
    claim.set("coins_placed", coins);
    claim.set("action", "initial_claim");
    claim.set("claimed_at", new Date().toISOString());
    txApp.save(claim);

    station.set("current_owner_team_id", teamId);
    station.set("current_stake", coins);
    txApp.save(station);

    writeEvent(txApp, { gameId: game.id, type: "claim", teamId, stationId, coinsInvolved: coins });
  });

  return e.json(200, { ok: true, newBalance: team.get("coin_balance"), stake: coins });
});


// POST /api/rr/station/{stationId}/contest
// Body: { teamId, newStake }
routerAdd("POST", "/api/rr/station/{stationId}/contest", (e) => {
  const { writeEvent } = require(`${__hooks}/shared.js`);
  const authRecord = e.auth;
  if (!authRecord) throw new UnauthorizedError("unauthenticated");

  const stationId = e.request.pathValue("stationId");
  const body = e.requestInfo().body;
  const teamId = body.teamId;
  const newStake = parseInt(body.newStake, 10);

  if (!teamId) throw new BadRequestError("teamId is required");
  if (!newStake || newStake < 1) throw new BadRequestError("newStake must be ≥ 1");

  let station;
  try { station = e.app.findRecordById("stations", stationId); }
  catch (_) { throw new NotFoundError("station not found"); }

  const game = e.app.findRecordById("games", station.get("game_id"));
  if (game.get("status") !== "active") throw new BadRequestError("game is not active");

  const currentOwnerTeamId = station.get("current_owner_team_id");
  if (!currentOwnerTeamId) throw new BadRequestError("station is unclaimed — use claim instead");
  if (currentOwnerTeamId === teamId) throw new BadRequestError("you already own this station");

  const currentStake = station.get("current_stake") || 0;
  const maxStakeIncrement = game.get("max_stake_increment") || 5;
  const maxAllowedStake = currentStake + maxStakeIncrement;

  if (newStake < currentStake + 1) throw new BadRequestError(`new stake must be at least ${currentStake + 1}`);
  if (newStake > maxAllowedStake) throw new BadRequestError(`new stake cannot exceed ${maxAllowedStake}`);

  const team = e.app.findRecordById("teams", teamId);
  if (team.get("game_id") !== game.id) throw new BadRequestError("team does not belong to this game");
  if (team.get("coin_balance") < newStake) throw new BadRequestError("insufficient coins");

  const _contestMembers = e.app.findRecordsByFilter("team_members", "team_id = {:teamId} && user_id = {:userId} && approved_by_host = true", "", 1, 0, { teamId, userId: authRecord.id });
  if (!_contestMembers || _contestMembers.length === 0) throw new ForbiddenError("you are not an approved member of this team");

  const prevTeamId = currentOwnerTeamId;

  e.app.runInTransaction((txApp) => {
    team.set("coin_balance", team.get("coin_balance") - newStake);
    txApp.save(team);

    const claimCol = txApp.findCollectionByNameOrId("station_claims");
    const claim = new Record(claimCol);
    claim.set("station_id", stationId);
    claim.set("game_id", game.id);
    claim.set("team_id", teamId);
    claim.set("coins_placed", newStake);
    claim.set("action", "contest_win");
    claim.set("claimed_at", new Date().toISOString());
    txApp.save(claim);

    station.set("current_owner_team_id", teamId);
    station.set("current_stake", newStake);
    txApp.save(station);

    writeEvent(txApp, {
      gameId: game.id, type: "contest",
      teamId, secondaryTeamId: prevTeamId,
      stationId, coinsInvolved: newStake,
    });
  });

  return e.json(200, { ok: true, newBalance: team.get("coin_balance"), newStake, prevTeamId });
});


// POST /api/rr/station/{stationId}/toll
// Body: { teamId }
// Team pays toll to pass through an enemy station. Always succeeds.
routerAdd("POST", "/api/rr/station/{stationId}/toll", (e) => {
  const { writeEvent } = require(`${__hooks}/shared.js`);
  const authRecord = e.auth;
  if (!authRecord) throw new UnauthorizedError("unauthenticated");

  const stationId = e.request.pathValue("stationId");
  const body = e.requestInfo().body;
  const teamId = body.teamId;

  if (!teamId) throw new BadRequestError("teamId is required");

  let station;
  try { station = e.app.findRecordById("stations", stationId); }
  catch (_) { throw new NotFoundError("station not found"); }

  const game = e.app.findRecordById("games", station.get("game_id"));
  if (game.get("status") !== "active") throw new BadRequestError("game is not active");

  const receivingTeamId = station.get("current_owner_team_id");
  if (!receivingTeamId) throw new BadRequestError("station is unclaimed — no toll required");
  if (receivingTeamId === teamId) throw new BadRequestError("you own this station — free passage");

  const payingTeam = e.app.findRecordById("teams", teamId);
  if (payingTeam.get("game_id") !== game.id) throw new BadRequestError("team does not belong to this game");

  const _tollMembers = e.app.findRecordsByFilter("team_members", "team_id = {:teamId} && user_id = {:userId} && approved_by_host = true", "", 1, 0, { teamId, userId: authRecord.id });
  if (!_tollMembers || _tollMembers.length === 0) throw new ForbiddenError("you are not an approved member of this team");

  const receivingTeam = e.app.findRecordById("teams", receivingTeamId);
  const tollCost = game.get("toll_cost") || 3;
  const currentBalance = payingTeam.get("coin_balance") || 0;
  const coinsPaid = Math.min(tollCost, currentBalance);
  const wasPartial = coinsPaid < tollCost;

  e.app.runInTransaction((txApp) => {
    payingTeam.set("coin_balance", currentBalance - coinsPaid);
    txApp.save(payingTeam);

    receivingTeam.set("coin_balance", (receivingTeam.get("coin_balance") || 0) + coinsPaid);
    txApp.save(receivingTeam);

    const tollCol = txApp.findCollectionByNameOrId("toll_payments");
    const toll = new Record(tollCol);
    toll.set("game_id", game.id);
    toll.set("station_id", stationId);
    toll.set("paying_team_id", teamId);
    toll.set("receiving_team_id", receivingTeamId);
    toll.set("coins_requested", tollCost);
    toll.set("coins_paid", coinsPaid);
    toll.set("was_partial", wasPartial);
    toll.set("paid_at", new Date().toISOString());
    txApp.save(toll);

    writeEvent(txApp, {
      gameId: game.id, type: "toll_paid",
      teamId, secondaryTeamId: receivingTeamId,
      stationId, coinsInvolved: coinsPaid, wasPartial,
    });
  });

  return e.json(200, { ok: true, coinsPaid, wasPartial, newBalance: payingTeam.get("coin_balance") });
});


// POST /api/rr/game/{gameId}/stations
// Body: array of { name, lat, lng } — saves station pins for this game.
routerAdd("POST", "/api/rr/game/{gameId}/stations", (e) => {
  const authRecord = e.auth;
  if (!authRecord) throw new UnauthorizedError("unauthenticated");

  const gameId = e.request.pathValue("gameId");

  let game;
  try { game = e.app.findRecordById("games", gameId); }
  catch (_) { throw new NotFoundError("game not found"); }

  if (game.get("host_user_id") !== authRecord.id) throw new ForbiddenError("only the host can add stations");
  if (game.get("status") !== "lobby") throw new BadRequestError("stations can only be added in lobby");

  const body = e.requestInfo().body;
  const items = Array.isArray(body) ? body : body.stations;
  if (!items || items.length === 0) throw new BadRequestError("no stations provided");

  // Delete existing stations for this game (allow re-submission)
  const existing = e.app.findRecordsByFilter("stations", "game_id = {:gameId}", "", 0, 0, { gameId });
  for (const s of existing) e.app.delete(s);

  const col = e.app.findCollectionByNameOrId("stations");
  const created = [];
  for (const item of items) {
    const s = new Record(col);
    s.set("game_id", gameId);
    s.set("name", item.name);
    s.set("lat", item.lat);
    s.set("lng", item.lng);
    s.set("current_stake", 0);
    s.set("is_challenge_location", false);
    e.app.save(s);
    created.push({ id: s.id, name: item.name, lat: item.lat, lng: item.lng });
  }

  return e.json(201, { created: created.length, stations: created });
});
