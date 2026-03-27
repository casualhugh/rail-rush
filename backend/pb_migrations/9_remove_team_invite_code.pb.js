/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const teams = app.findCollectionByNameOrId("teams");
  teams.fields.removeByName("invite_code");
  app.save(teams);
}, (app) => {
  const teams = app.findCollectionByNameOrId("teams");
  teams.fields.add(new TextField({ name: "invite_code" }));
  app.save(teams);
});
