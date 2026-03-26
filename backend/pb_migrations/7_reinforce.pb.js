/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  // ── station_claims: add stake_ceiling (nullable number) + reinforce action ─
  const claimsCol = app.findCollectionByNameOrId("station_claims");

  claimsCol.fields.add(new NumberField({ name: "stake_ceiling", required: false }));

  const actionField = claimsCol.fields.getByName("action");
  actionField.values = ["initial_claim", "contest_win", "reinforce"];

  app.save(claimsCol);

  // ── events: add reinforce to type enum ───────────────────────────────────
  const eventsCol = app.findCollectionByNameOrId("events");

  const typeField = eventsCol.fields.getByName("type");
  typeField.values = [
    "claim", "contest", "toll_paid",
    "challenge_submitted", "challenge_approved",
    "challenge_rejected", "challenge_drawn",
    "challenge_failed", "player_joined",
    "game_started", "game_ended", "reinforce",
  ];

  app.save(eventsCol);

}, (app) => {
  // ── rollback: remove stake_ceiling, revert enum values ───────────────────
  const claimsCol = app.findCollectionByNameOrId("station_claims");
  claimsCol.fields.removeByName("stake_ceiling");
  const actionField = claimsCol.fields.getByName("action");
  actionField.values = ["initial_claim", "contest_win"];
  app.save(claimsCol);

  const eventsCol = app.findCollectionByNameOrId("events");
  const typeField = eventsCol.fields.getByName("type");
  typeField.values = [
    "claim", "contest", "toll_paid",
    "challenge_submitted", "challenge_approved",
    "challenge_rejected", "challenge_drawn",
    "challenge_failed", "player_joined",
    "game_started", "game_ended",
  ];
  app.save(eventsCol);
});
