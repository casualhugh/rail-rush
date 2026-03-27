/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3980519374")

  // update collection data
  unmarshal({
    "listRule": "@request.auth.id = host_user_id || user_id = @request.auth.id || approved_by_host = true",
    "viewRule": "@request.auth.id = host_user_id || user_id = @request.auth.id || approved_by_host = true"
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3980519374")

  // update collection data
  unmarshal({
    "listRule": "@request.auth.id != ''",
    "viewRule": "@request.auth.id != ''"
  }, collection)

  return app.save(collection)
})
