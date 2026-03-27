/// <reference path="../pb_data/types.d.ts" />

function deleteGameCascade(app, game) {
  app.runInTransaction((txApp) => {
    const gameId = game.id;
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
}

cronAdd("cleanup_old_games", "0 2 * * *", () => {
  const app = $app;
  const now = new Date();

  // Delete ended games older than 30 days
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const endedGames = app.findRecordsByFilter(
    "games",
    "status = 'ended' && ended_at < {:cutoff}",
    "", 0, 0, { cutoff: thirtyDaysAgo }
  );
  for (const game of endedGames) {
    try { deleteGameCascade(app, game); } catch (err) { console.error("cleanup: failed to delete ended game", game.id, err); }
  }

  // Delete stale lobby games older than 7 days
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const lobbyGames = app.findRecordsByFilter(
    "games",
    "status = 'lobby' && created < {:cutoff}",
    "", 0, 0, { cutoff: sevenDaysAgo }
  );
  for (const game of lobbyGames) {
    try { deleteGameCascade(app, game); } catch (err) { console.error("cleanup: failed to delete stale lobby game", game.id, err); }
  }
});
