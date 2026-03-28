/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const col = app.findCollectionByNameOrId("stations");
  col.fields.add(new JSONField({ name: "connected_to", required: false }));
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("stations");
  col.fields.removeByName("connected_to");
  app.save(col);
});
