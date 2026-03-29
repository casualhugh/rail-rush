/// <reference path="../pb_data/types.d.ts" />

// Migration 16: Remove required constraint from teams.coin_balance
// PocketBase treats 0 as "blank" for required number fields, causing a validation
// error when a team's balance reaches exactly 0 (e.g. spending their last coin).
migrate((app) => {
  const collection = app.findCollectionByNameOrId("teams");
  const field = collection.fields.getByName("coin_balance");
  field.required = false;
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("teams");
  const field = collection.fields.getByName("coin_balance");
  field.required = true;
  app.save(collection);
});
