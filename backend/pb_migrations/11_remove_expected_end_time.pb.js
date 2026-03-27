/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const games = app.findCollectionByNameOrId("games");
  games.fields.removeByName("expected_end_time");
  app.save(games);
}, (app) => {
  const games = app.findCollectionByNameOrId("games");
  games.fields.add(new DateField({ name: "expected_end_time" }));
  app.save(games);
});
