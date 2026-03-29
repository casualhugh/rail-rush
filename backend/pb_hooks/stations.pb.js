/// <reference path="../pb_data/types.d.ts" />

// POST /api/rr/station/{stationId}/stake
// Body: { teamId, stake } — unified claim/contest. Works for both unclaimed and claimed stations.
routerAdd("POST", "/api/rr/station/{stationId}/stake", (e) => {
  const { writeEvent } = require(`${__hooks}/shared.js`);
  const authRecord = e.auth;
  if (!authRecord) throw new UnauthorizedError("unauthenticated");

  const stationId = e.request.pathValue("stationId");
  const body = e.requestInfo().body;
  const teamId = body.teamId;
  const stake = parseInt(body.stake, 10);

  if (!teamId) throw new BadRequestError("teamId is required");
  if (isNaN(stake) || stake < 1) throw new BadRequestError("stake must be a positive integer");

  let station;
  try { station = e.app.findRecordById("stations", stationId); }
  catch (_) { throw new NotFoundError("station not found"); }

  const game = e.app.findRecordById("games", station.get("game_id"));
  if (game.get("status") !== "active") throw new BadRequestError("game is not active");

  const currentStake = station.get("current_stake") || 0;
  const currentOwnerTeamId = station.get("current_owner_team_id") || null;
  const maxStakeIncrement = game.get("max_stake_increment") || 5;

  // Owner cannot stake against their own station
  if (currentOwnerTeamId === teamId) throw new BadRequestError("you already own this station");

  // Unified validation: stake must be > currentStake and <= currentStake + maxStakeIncrement
  if (stake <= currentStake) throw new BadRequestError(`stake must be greater than current stake of ${currentStake}`);
  if (stake > currentStake + maxStakeIncrement) throw new BadRequestError(`stake cannot exceed ${currentStake + maxStakeIncrement}`);

  const team = e.app.findRecordById("teams", teamId);
  if (team.get("game_id") !== game.id) throw new BadRequestError("team does not belong to this game");
  if (team.get("coin_balance") < stake) throw new BadRequestError("insufficient coins");

  const _members = e.app.findRecordsByFilter(
    "team_members",
    "team_id = {:teamId} && user_id = {:userId} && approved_by_host = true",
    "", 1, 0, { teamId, userId: authRecord.id }
  );
  if (!_members || _members.length === 0) throw new ForbiddenError("you are not an approved member of this team");

  const prevTeamId = currentOwnerTeamId;
  const action = currentOwnerTeamId ? "contest_win" : "initial_claim";
  const eventType = currentOwnerTeamId ? "contest" : "claim";

  e.app.runInTransaction((txApp) => {
    team.set("coin_balance", team.get("coin_balance") - stake);
    txApp.save(team);

    const claimCol = txApp.findCollectionByNameOrId("station_claims");
    const claim = new Record(claimCol);
    claim.set("station_id", stationId);
    claim.set("game_id", game.id);
    claim.set("team_id", teamId);
    claim.set("coins_placed", stake);
    claim.set("action", action);
    claim.set("stake_ceiling", currentStake + maxStakeIncrement);
    claim.set("claimed_at", new Date().toISOString());
    txApp.save(claim);

    station.set("current_owner_team_id", teamId);
    station.set("current_stake", stake);
    station.set("stake_ceiling", currentStake + maxStakeIncrement);
    txApp.save(station);

    const eventData = { gameId: game.id, type: eventType, teamId, stationId, coinsInvolved: stake };
    if (prevTeamId) eventData.secondaryTeamId = prevTeamId;
    writeEvent(txApp, eventData);
  });

  const response = { ok: true, newBalance: team.get("coin_balance"), stake };
  if (prevTeamId) response.prevTeamId = prevTeamId;
  return e.json(200, response);
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



// POST /api/rr/station/{stationId}/reinforce
// Body: { teamId, coins }
// Owning team adds coins to their stake, up to the stake_ceiling.
routerAdd("POST", "/api/rr/station/{stationId}/reinforce", (e) => {
  const { writeEvent } = require(`${__hooks}/shared.js`);
  const authRecord = e.auth;
  if (!authRecord) throw new UnauthorizedError("unauthenticated");

  const stationId = e.request.pathValue("stationId");
  const body = e.requestInfo().body;
  const teamId = body.teamId;
  const coins = parseInt(body.coins, 10);

  if (!teamId) throw new BadRequestError("teamId is required");
  if (isNaN(coins) || coins < 1) throw new BadRequestError("coins must be a positive integer");

  let station;
  try { station = e.app.findRecordById("stations", stationId); }
  catch (_) { throw new NotFoundError("station not found"); }

  const game = e.app.findRecordById("games", station.get("game_id"));
  if (game.get("status") !== "active") throw new BadRequestError("game is not active");

  const team = e.app.findRecordById("teams", teamId);
  if (team.get("game_id") !== game.id) throw new BadRequestError("team does not belong to this game");

  const ownerTeamId = station.get("current_owner_team_id");
  if (!ownerTeamId) throw new BadRequestError("station is unclaimed");
  if (ownerTeamId !== teamId) throw new ForbiddenError("you do not own this station");

  const members = e.app.findRecordsByFilter(
    "team_members",
    "team_id = {:teamId} && user_id = {:userId} && approved_by_host = true",
    "", 1, 0,
    { teamId, userId: authRecord.id }
  );
  if (!members || members.length === 0) throw new ForbiddenError("you are not an approved member of this team");

  const stakeCeiling = station.get("stake_ceiling") || 0;
  const currentStake = station.get("current_stake") || 0;

  if (currentStake + coins > stakeCeiling) {
    throw new BadRequestError(`stake would exceed ceiling of ${stakeCeiling} (currently ${currentStake})`);
  }
  if (team.get("coin_balance") < coins) throw new BadRequestError("insufficient coins");

  e.app.runInTransaction((txApp) => {
    team.set("coin_balance", team.get("coin_balance") - coins);
    txApp.save(team);

    station.set("current_stake", currentStake + coins);
    txApp.save(station);

    const claimCol = txApp.findCollectionByNameOrId("station_claims");
    const claim = new Record(claimCol);
    claim.set("station_id", stationId);
    claim.set("game_id", game.id);
    claim.set("team_id", teamId);
    claim.set("coins_placed", coins);
    claim.set("action", "reinforce");
    claim.set("stake_ceiling", stakeCeiling);
    claim.set("claimed_at", new Date().toISOString());
    txApp.save(claim);

    writeEvent(txApp, { gameId: game.id, type: "reinforce", teamId, stationId, coinsInvolved: coins });
  });

  return e.json(200, {
    ok: true,
    newBalance: team.get("coin_balance"),
    newStake: currentStake + coins,
    stakeCeiling,
  });
});


// POST /api/rr/game/{gameId}/stations
// Body: { stations: [{name, lat, lng, tempId?}], connections?: [[tempId1, tempId2], ...] }
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
  const connectionPairs = Array.isArray(body.connections) ? body.connections : [];
  if (!items || items.length === 0) throw new BadRequestError("no stations provided");
  if (items.length > 500) throw new BadRequestError("cannot save more than 500 stations");
  for (const item of items) {
    const lat = parseFloat(item.lat);
    const lng = parseFloat(item.lng);
    if (isNaN(lat) || lat < -90 || lat > 90) throw new BadRequestError(`station "${item.name}" has invalid lat (must be -90 to 90)`);
    if (isNaN(lng) || lng < -180 || lng > 180) throw new BadRequestError(`station "${item.name}" has invalid lng (must be -180 to 180)`);
  }

  // Delete existing stations for this game (allow re-submission)
  const created = [];
  e.app.runInTransaction((txApp) => {
    const existing = txApp.findRecordsByFilter("stations", "game_id = {:gameId}", "", 0, 0, { gameId });
    for (const s of existing) txApp.delete(s);

    const col = txApp.findCollectionByNameOrId("stations");

    // First pass: create all station records and build tempId → realId map
    const tempToReal = {};
    const recordById = {};
    for (const item of items) {
      const s = new Record(col);
      s.set("game_id", gameId);
      s.set("name", item.name);
      s.set("lat", item.lat);
      s.set("lng", item.lng);
      s.set("current_stake", 0);
      s.set("is_challenge_location", false);
      txApp.save(s);
      created.push({ id: s.id, name: item.name, lat: item.lat, lng: item.lng });
      if (item.tempId) tempToReal[item.tempId] = s.id;
      recordById[s.id] = s;
    }

    // Second pass: build adjacency map from connection pairs and save connected_to
    if (connectionPairs.length > 0) {
      const adjacency = {};
      for (const pair of connectionPairs) {
        const aReal = tempToReal[pair[0]] || pair[0];
        const bReal = tempToReal[pair[1]] || pair[1];
        if (!aReal || !bReal || aReal === bReal) continue;
        if (!adjacency[aReal]) adjacency[aReal] = [];
        if (!adjacency[bReal]) adjacency[bReal] = [];
        if (!adjacency[aReal].includes(bReal)) adjacency[aReal].push(bReal);
        if (!adjacency[bReal].includes(aReal)) adjacency[bReal].push(aReal);
      }
      for (const stationId of Object.keys(adjacency)) {
        const rec = recordById[stationId];
        if (!rec) continue;
        rec.set("connected_to", adjacency[stationId]);
        txApp.save(rec);
      }
    }
  });

  return e.json(201, { created: created.length, stations: created });
});


// POST /api/rr/game/{gameId}/station/add
// Body: { name, lat, lng }
// Host-only, active game. Adds a single new station mid-game.
routerAdd("POST", "/api/rr/game/{gameId}/station/add", (e) => {
  const authRecord = e.auth;
  if (!authRecord) throw new UnauthorizedError("unauthenticated");

  const gameId = e.request.pathValue("gameId");

  let game;
  try { game = e.app.findRecordById("games", gameId); }
  catch (_) { throw new NotFoundError("game not found"); }

  if (game.get("host_user_id") !== authRecord.id) throw new ForbiddenError("only the host can add stations");
  if (game.get("status") !== "active") throw new BadRequestError("game is not active");

  const body = e.requestInfo().body;
  const name = body.name;
  const lat  = parseFloat(body.lat);
  const lng  = parseFloat(body.lng);

  if (!name || typeof name !== "string" || name.trim() === "") throw new BadRequestError("name is required");
  if (isNaN(lat) || lat < -90  || lat > 90)   throw new BadRequestError("invalid lat");
  if (isNaN(lng) || lng < -180 || lng > 180)  throw new BadRequestError("invalid lng");

  const existing = e.app.findRecordsByFilter("stations", "game_id = {:gameId}", "", 0, 0, { gameId });
  if (existing.length >= 500) throw new BadRequestError("station limit of 500 reached");

  const col = e.app.findCollectionByNameOrId("stations");
  const station = new Record(col);
  station.set("game_id",            gameId);
  station.set("name",               name.trim());
  station.set("lat",                lat);
  station.set("lng",                lng);
  station.set("current_stake",      0);
  station.set("is_challenge_location", false);
  station.set("connected_to",       []);
  e.app.save(station);

  return e.json(201, { id: station.id, name: station.get("name"), lat, lng });
});


// DELETE /api/rr/station/{stationId}
// Host-only, active game. Deletes a station with full cleanup:
//   - refunds current_stake to current owner
//   - fails any active/pending_approval challenge pinned to it
//   - removes station from all neighbours' connected_to
//   - calls _drawChallenges after deletion
routerAdd("DELETE", "/api/rr/station/{stationId}", (e) => {
  const { _drawChallenges } = require(`${__hooks}/shared.js`);
  const authRecord = e.auth;
  if (!authRecord) throw new UnauthorizedError("unauthenticated");

  const stationId = e.request.pathValue("stationId");

  let station;
  try { station = e.app.findRecordById("stations", stationId); }
  catch (_) { throw new NotFoundError("station not found"); }

  let game;
  try { game = e.app.findRecordById("games", station.get("game_id")); }
  catch (_) { throw new NotFoundError("game not found"); }
  if (game.get("host_user_id") !== authRecord.id) throw new ForbiddenError("only the host can delete stations");
  if (game.get("status") !== "active") throw new BadRequestError("game is not active");

  let coinsRefunded = 0;
  let refundedTeamId = null;

  e.app.runInTransaction((txApp) => {
    // 1. Refund current stake to current owner only
    const ownerTeamId = station.get("current_owner_team_id");
    const currentStake = station.get("current_stake") || 0;
    if (ownerTeamId && currentStake > 0) {
      const ownerTeam = txApp.findRecordById("teams", ownerTeamId);
      ownerTeam.set("coin_balance", (ownerTeam.get("coin_balance") || 0) + currentStake);
      txApp.save(ownerTeam);
      coinsRefunded = currentStake;
      refundedTeamId = ownerTeamId;
    }

    // 2. Fail any active or pending_approval challenge at this station
    const challenges = txApp.findRecordsByFilter(
      "challenges",
      "station_id = {:stationId} && (status = 'active' || status = 'pending_approval')",
      "", 0, 0, { stationId }
    );
    for (const challenge of challenges) {
      challenge.set("status",             "failed");
      challenge.set("attempting_team_id", "");
      challenge.set("completed_by_team_id", "");
      txApp.save(challenge);
    }

    // 3. Remove stationId from all neighbours' connected_to
    const neighbours = txApp.findRecordsByFilter(
      "stations",
      "game_id = {:gameId}",
      "", 0, 0, { gameId: game.id }
    );
    for (const nb of neighbours) {
      if (nb.id === stationId) continue;
      let connectedTo = nb.get("connected_to");
      if (!Array.isArray(connectedTo)) connectedTo = [];
      if (!connectedTo.includes(stationId)) continue;
      nb.set("connected_to", connectedTo.filter(id => id !== stationId));
      txApp.save(nb);
    }

    // 4. Delete the station
    txApp.delete(station);
  });

  // 5. Replenish challenge pool if a challenge was force-failed
  _drawChallenges(e.app, game);

  return e.json(200, { ok: true, coinsRefunded, refundedTeamId });
});


// POST /api/rr/station/{stationId}/connect
// Body: { neighborId }
// Host-only, active game. Adds a bidirectional connection.
routerAdd("POST", "/api/rr/station/{stationId}/connect", (e) => {
  const authRecord = e.auth;
  if (!authRecord) throw new UnauthorizedError("unauthenticated");

  const stationId = e.request.pathValue("stationId");
  const body = e.requestInfo().body;
  const neighborId = body.neighborId;
  if (!neighborId) throw new BadRequestError("neighborId is required");
  if (neighborId === stationId) throw new BadRequestError("cannot connect a station to itself");

  let station;
  try { station = e.app.findRecordById("stations", stationId); }
  catch (_) { throw new NotFoundError("station not found"); }

  let neighbor;
  try { neighbor = e.app.findRecordById("stations", neighborId); }
  catch (_) { throw new NotFoundError("neighbor not found"); }

  const game = e.app.findRecordById("games", station.get("game_id"));
  if (game.get("host_user_id") !== authRecord.id) throw new ForbiddenError("only the host can edit connections");
  if (game.get("status") !== "active") throw new BadRequestError("game is not active");
  if (neighbor.get("game_id") !== game.id) throw new BadRequestError("stations belong to different games");

  let connA = station.get("connected_to"); if (!Array.isArray(connA)) connA = [];
  if (connA.includes(neighborId)) throw new BadRequestError("already connected");

  e.app.runInTransaction((txApp) => {
    station.set("connected_to", [...connA, neighborId]);
    txApp.save(station);

    let connB = neighbor.get("connected_to"); if (!Array.isArray(connB)) connB = [];
    if (!connB.includes(stationId)) { connB.push(stationId); }
    neighbor.set("connected_to", connB);
    txApp.save(neighbor);
  });

  return e.json(200, { ok: true });
});


// POST /api/rr/station/{stationId}/disconnect
// Body: { neighborId }
// Host-only, active game. Removes a bidirectional connection.
routerAdd("POST", "/api/rr/station/{stationId}/disconnect", (e) => {
  const authRecord = e.auth;
  if (!authRecord) throw new UnauthorizedError("unauthenticated");

  const stationId = e.request.pathValue("stationId");
  const body = e.requestInfo().body;
  const neighborId = body.neighborId;
  if (!neighborId) throw new BadRequestError("neighborId is required");

  let station;
  try { station = e.app.findRecordById("stations", stationId); }
  catch (_) { throw new NotFoundError("station not found"); }

  let neighbor;
  try { neighbor = e.app.findRecordById("stations", neighborId); }
  catch (_) { throw new NotFoundError("neighbor not found"); }

  const game = e.app.findRecordById("games", station.get("game_id"));
  if (game.get("host_user_id") !== authRecord.id) throw new ForbiddenError("only the host can edit connections");
  if (game.get("status") !== "active") throw new BadRequestError("game is not active");
  if (neighbor.get("game_id") !== game.id) throw new BadRequestError("stations belong to different games");

  e.app.runInTransaction((txApp) => {
    let connA = station.get("connected_to"); if (!Array.isArray(connA)) connA = [];
    station.set("connected_to", connA.filter(id => id !== neighborId));
    txApp.save(station);

    let connB = neighbor.get("connected_to"); if (!Array.isArray(connB)) connB = [];
    neighbor.set("connected_to", connB.filter(id => id !== stationId));
    txApp.save(neighbor);
  });

  return e.json(200, { ok: true });
});
