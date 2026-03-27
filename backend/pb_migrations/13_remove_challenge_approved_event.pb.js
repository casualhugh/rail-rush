/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  // Remove deprecated 'challenge_approved' event type (never written by any hook)
  const events = app.findCollectionByNameOrId("events");
  const typeField = events.fields.getByName("type");
  typeField.values = [
    "claim", "contest", "toll_paid", "reinforce",
    "challenge_submitted", "challenge_claimed",
    "challenge_rejected", "challenge_drawn",
    "challenge_failed", "challenge_impossible",
    "challenge_completed",
    "player_joined", "game_started", "game_ended",
  ];
  app.save(events);
}, (app) => {
  const events = app.findCollectionByNameOrId("events");
  const typeField = events.fields.getByName("type");
  typeField.values = [
    "claim", "contest", "toll_paid", "reinforce",
    "challenge_submitted", "challenge_approved",
    "challenge_rejected", "challenge_drawn",
    "challenge_failed", "challenge_impossible", "challenge_claimed",
    "challenge_completed",
    "player_joined", "game_started", "game_ended",
  ];
  app.save(events);
});
