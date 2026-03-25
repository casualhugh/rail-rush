/// <reference path="../pb_data/types.d.ts" />

// Convert team_members.team_id and team_members.user_id from plain text fields
// to proper relation fields so that:
//   - expand: 'user_id' works in the lobby member list
//   - expand: 'team_id' works in the dashboard joined-games list
//   - filter traversal like team_id.game_id = "..." works in GameMap

migrate((app) => {
  const col      = app.findCollectionByNameOrId("team_members");
  const teamsCol = app.findCollectionByNameOrId("teams");
  const usersCol = app.findCollectionByNameOrId("users");

  // team_id: text → relation to teams
  col.fields.removeByName("team_id");
  col.fields.add(new RelationField({
    name:            "team_id",
    required:        true,
    collectionId:    teamsCol.id,
    maxSelect:       1,
    cascadeDelete:   false,
  }));

  // user_id: text → relation to users
  col.fields.removeByName("user_id");
  col.fields.add(new RelationField({
    name:            "user_id",
    required:        true,
    collectionId:    usersCol.id,
    maxSelect:       1,
    cascadeDelete:   false,
  }));

  app.save(col);
}, (app) => {
  // Rollback: revert both fields back to plain text
  const col = app.findCollectionByNameOrId("team_members");

  col.fields.removeByName("team_id");
  col.fields.add(new TextField({
    name:     "team_id",
    required: true,
  }));

  col.fields.removeByName("user_id");
  col.fields.add(new TextField({
    name:     "user_id",
    required: true,
  }));

  app.save(col);
});
