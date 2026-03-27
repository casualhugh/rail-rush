/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const col = app.findCollectionByNameOrId("team_members");
  col.fields.add(new TextField({ name: "host_user_id", required: false }));
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("team_members");
  col.fields.removeByName("host_user_id");
  app.save(col);
});
