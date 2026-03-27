/// <reference path="../pb_data/types.d.ts" />

function writeEvent(app, { gameId, type, teamId = "", secondaryTeamId = "", stationId = "", challengeId = "", coinsInvolved = null, wasPartial = null, meta = null }) {
  const col = app.findCollectionByNameOrId("events");
  const record = new Record(col);
  record.set("game_id", gameId);
  record.set("type", type);
  record.set("team_id", teamId);
  record.set("secondary_team_id", secondaryTeamId);
  record.set("station_id", stationId);
  record.set("challenge_id", challengeId);
  if (coinsInvolved !== null) record.set("coins_involved", coinsInvolved);
  if (wasPartial !== null) record.set("was_partial", wasPartial);
  if (meta !== null) record.set("meta", meta);
  app.save(record);
  return record;
}

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

function _drawChallenges(app, game, forceDraw) {
  const gameId = game.id;
  const maxActive = game.get("max_active_challenges") || 10;

  const activeCount = app.findRecordsByFilter(
    "challenges", "game_id = {:gameId} && status = 'active'", "", 0, 0, { gameId }
  ).length;

  const drawCount = forceDraw !== undefined ? forceDraw : (activeCount >= maxActive ? 1 : 2);

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
      if (idx !== -1) targetStation = availableStations.splice(idx, 1)[0];
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
  const baseCoinReward = challenge.get("coin_reward") || 0;

  // Count-based bonus: +5% per challenge already completed in this game, capped at +200%
  let coinReward = baseCoinReward;
  if (baseCoinReward > 0) {
    const completedCount = app.findRecordsByFilter(
      "challenges", "game_id = {:gameId} && status = 'completed'", "", 0, 0, { gameId: game.id }
    ).length;
    const bonusFraction = Math.min(completedCount * 0.05, 2.0);
    const bonus = Math.floor(baseCoinReward * bonusFraction);
    coinReward = baseCoinReward + bonus;
  }

  _clearChallengeFromStation(app, challenge);

  challenge.set("status", "completed");
  challenge.set("completed_by_team_id", teamId);
  challenge.set("completed_at", new Date().toISOString());
  challenge.set("attempting_team_id", "");
  app.save(challenge);

  if (coinReward > 0 && teamId) {
    const team = app.findRecordById("teams", teamId);
    team.set("coin_balance", (team.get("coin_balance") || 0) + coinReward);
    app.save(team);
  }

  writeEvent(app, {
    gameId: game.id, type: "challenge_completed",
    teamId, challengeId: challenge.id,
    stationId: challenge.get("station_id") || "",
    coinsInvolved: coinReward,
  });

  _drawChallenges(app, game);
  return coinReward;
}

function getFailedTeamIds(challenge) {
  try {
    const raw = challenge.get("failed_team_ids");
    if (raw === null || raw === undefined) return [];
    // Goja returns types.JsonRaw (Go []byte) as an array of byte integers
    // Convert bytes → string → JSON.parse
    let str;
    if (typeof raw === "string") {
      str = raw;
    } else if (Array.isArray(raw)) {
      str = String.fromCharCode(...raw.filter(b => b > 0));
    } else {
      return [];
    }
    str = str.trim();
    if (!str || str === "null" || str === "[]") return [];
    const parsed = JSON.parse(str);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(id => typeof id === "string");
  } catch (_) {}
  return [];
}

module.exports = { writeEvent, _clearChallengeFromStation, _drawChallenges, _completeChallengeAndDraw, getFailedTeamIds };
