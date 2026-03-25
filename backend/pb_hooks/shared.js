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

module.exports = { writeEvent };
