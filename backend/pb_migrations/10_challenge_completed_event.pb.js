/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  // Add 'challenge_completed' to events.type enum
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
}, (app) => {
  // Remove 'challenge_completed' from events.type enum
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
});
