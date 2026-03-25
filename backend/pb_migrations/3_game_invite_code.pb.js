/// <reference path="../pb_data/types.d.ts" />

// Adds a single invite_code field to the games collection.
// Previously, each team had its own invite_code. Now there is one code per game.
migrate((app) => {
  const col = app.findCollectionByNameOrId("games");
  col.fields.add(new TextField({ name: "invite_code" }));
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("games");
  col.fields.removeByName("invite_code");
  app.save(col);
});
