/// <reference path="../pb_data/types.d.ts" />

// Allow authenticated users to read the collections the frontend queries directly.
// Mutations all go through custom /api/rr/* hooks, so no createRule/updateRule/deleteRule needed.
migrate((app) => {
  const authRule = "@request.auth.id != ''";

  for (const name of ["games", "teams", "team_members", "stations", "challenges", "events"]) {
    const col = app.findCollectionByNameOrId(name);
    col.listRule = authRule;
    col.viewRule = authRule;
    app.save(col);
  }
}, (app) => {
  for (const name of ["games", "teams", "team_members", "stations", "challenges", "events"]) {
    const col = app.findCollectionByNameOrId(name);
    col.listRule = null;
    col.viewRule = null;
    app.save(col);
  }
});
