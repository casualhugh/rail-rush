/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const col = app.findCollectionByNameOrId("stations");
  col.fields.add(new NumberField({ name: "stake_ceiling", required: false }));
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("stations");
  col.fields.removeByName("stake_ceiling");
  app.save(col);
});
