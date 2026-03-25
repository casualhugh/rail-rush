/// <reference path="../pb_data/types.d.ts" />

// Store the player's display name directly on team_members at join time,
// avoiding the need for relation-field expansion to show names in the lobby.

migrate((app) => {
  const col = app.findCollectionByNameOrId("team_members");
  col.fields.add(new TextField({ name: "display_name" }));
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("team_members");
  col.fields.removeByName("display_name");
  app.save(col);
});
