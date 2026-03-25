/// <reference path="../pb_data/types.d.ts" />

// PocketBase v0.23+ requires created/updated to be declared explicitly as
// AutodateFields — they are no longer auto-added to base collections.

migrate((app) => {
  const names = [
    "games", "teams", "team_members", "stations",
    "station_claims", "toll_payments", "challenge_bank",
    "challenges", "events", "map_templates",
    "osm_station_cache", "spectator_access",
  ];

  for (const name of names) {
    const col = app.findCollectionByNameOrId(name);

    if (!col.fields.getByName("created")) {
      col.fields.add(new AutodateField({
        name:     "created",
        onCreate: true,
        onUpdate: false,
      }));
    }

    if (!col.fields.getByName("updated")) {
      col.fields.add(new AutodateField({
        name:     "updated",
        onCreate: true,
        onUpdate: true,
      }));
    }

    app.save(col);
  }
}, (app) => {
  const names = [
    "games", "teams", "team_members", "stations",
    "station_claims", "toll_payments", "challenge_bank",
    "challenges", "events", "map_templates",
    "osm_station_cache", "spectator_access",
  ];

  for (const name of names) {
    const col = app.findCollectionByNameOrId(name);
    col.fields.removeByName("created");
    col.fields.removeByName("updated");
    app.save(col);
  }
});
