/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  // Add fields to challenges
  const challenges = app.findCollectionByNameOrId("challenges");
  challenges.fields.add(new TextField({ name: "attempting_team_id" }));
  challenges.fields.add(new JSONField({ name: "failed_team_ids" }));
  challenges.fields.add(new NumberField({ name: "fail_count" }));

  // Add 'impossible' to status enum
  const statusField = challenges.fields.getByName("status");
  statusField.values = ["undrawn", "active", "pending_approval", "completed", "failed", "impossible"];
  app.save(challenges);

  // Add 'challenge_impossible' and 'challenge_claimed' to events.type enum
  const events = app.findCollectionByNameOrId("events");
  const typeField = events.fields.getByName("type");
  typeField.values = [
    "claim", "contest", "toll_paid", "reinforce",
    "challenge_submitted", "challenge_approved",
    "challenge_rejected", "challenge_drawn",
    "challenge_failed", "challenge_impossible", "challenge_claimed",
    "player_joined", "game_started", "game_ended",
  ];
  app.save(events);
}, (app) => {
  const challenges = app.findCollectionByNameOrId("challenges");
  challenges.fields.removeByName("attempting_team_id");
  challenges.fields.removeByName("failed_team_ids");
  challenges.fields.removeByName("fail_count");
  const statusField = challenges.fields.getByName("status");
  statusField.values = ["undrawn", "active", "pending_approval", "completed", "failed"];
  app.save(challenges);

  const events = app.findCollectionByNameOrId("events");
  const typeField = events.fields.getByName("type");
  typeField.values = [
    "claim", "contest", "toll_paid", "reinforce",
    "challenge_submitted", "challenge_approved",
    "challenge_rejected", "challenge_drawn",
    "challenge_failed", "player_joined", "game_started", "game_ended",
  ];
  app.save(events);
});
