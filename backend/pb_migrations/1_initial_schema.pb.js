/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  // ── games ──────────────────────────────────────────────────────────────────
  const games = new Collection({
    name: "games",
    type: "base",
    fields: [
      { name: "host_user_id",           type: "text",   required: true },
      { name: "name",                   type: "text",   required: true },
      { name: "status",                 type: "select", required: true,
        maxSelect: 1, values: ["lobby", "active", "ended"] },
      { name: "city_name",              type: "text" },
      { name: "map_bounds",             type: "json" },
      { name: "starting_coins",         type: "number", required: true },
      { name: "max_stake_increment",    type: "number", required: true },
      { name: "toll_cost",              type: "number", required: true },
      { name: "max_active_challenges",  type: "number", required: true },
      { name: "require_host_approval",  type: "bool" },
      { name: "spectators_allowed",     type: "bool" },
      { name: "expected_end_time",      type: "date" },
      { name: "started_at",             type: "date" },
      { name: "ended_at",               type: "date" },
    ],
  });
  app.save(games);

  // ── teams ──────────────────────────────────────────────────────────────────
  const teams = new Collection({
    name: "teams",
    type: "base",
    fields: [
      { name: "game_id",              type: "text",   required: true },
      { name: "name",                 type: "text",   required: true },
      { name: "color",                type: "text",   required: true },
      { name: "coin_balance",         type: "number", required: true },
      { name: "invite_code",          type: "text",   required: true },
      { name: "current_lat",          type: "number" },
      { name: "current_lng",          type: "number" },
      { name: "location_updated_at",  type: "date" },
    ],
  });
  app.save(teams);

  // ── team_members ───────────────────────────────────────────────────────────
  const teamMembers = new Collection({
    name: "team_members",
    type: "base",
    fields: [
      { name: "team_id",          type: "text",   required: true },
      { name: "user_id",          type: "text",   required: true },
      { name: "role",             type: "select", required: true,
        maxSelect: 1, values: ["captain", "member"] },
      { name: "approved_by_host", type: "bool" },
      { name: "joined_at",        type: "date" },
    ],
  });
  app.save(teamMembers);

  // ── stations ───────────────────────────────────────────────────────────────
  const stations = new Collection({
    name: "stations",
    type: "base",
    fields: [
      { name: "game_id",                type: "text",   required: true },
      { name: "map_template_id",        type: "text" },
      { name: "name",                   type: "text",   required: true },
      { name: "lat",                    type: "number", required: true },
      { name: "lng",                    type: "number", required: true },
      { name: "current_owner_team_id",  type: "text" },
      { name: "current_stake",          type: "number" },
      { name: "is_challenge_location",  type: "bool" },
      { name: "active_challenge_id",    type: "text" },
    ],
  });
  app.save(stations);

  // ── station_claims ─────────────────────────────────────────────────────────
  const stationClaims = new Collection({
    name: "station_claims",
    type: "base",
    fields: [
      { name: "station_id",   type: "text",   required: true },
      { name: "game_id",      type: "text",   required: true },
      { name: "team_id",      type: "text",   required: true },
      { name: "coins_placed", type: "number", required: true },
      { name: "action",       type: "select", required: true,
        maxSelect: 1, values: ["initial_claim", "contest_win"] },
      { name: "claimed_at",   type: "date",   required: true },
    ],
  });
  app.save(stationClaims);

  // ── toll_payments ──────────────────────────────────────────────────────────
  const tollPayments = new Collection({
    name: "toll_payments",
    type: "base",
    fields: [
      { name: "game_id",           type: "text",   required: true },
      { name: "station_id",        type: "text",   required: true },
      { name: "paying_team_id",    type: "text",   required: true },
      { name: "receiving_team_id", type: "text",   required: true },
      { name: "coins_requested",   type: "number", required: true },
      { name: "coins_paid",        type: "number", required: true },
      { name: "was_partial",       type: "bool" },
      { name: "paid_at",           type: "date",   required: true },
    ],
  });
  app.save(tollPayments);

  // ── challenge_bank ─────────────────────────────────────────────────────────
  const challengeBank = new Collection({
    name: "challenge_bank",
    type: "base",
    fields: [
      { name: "description",      type: "text",   required: true },
      { name: "difficulty",       type: "select", required: true,
        maxSelect: 1, values: ["easy", "medium", "hard"] },
      { name: "tags",             type: "json" },
      { name: "suggested_reward", type: "number" },
      { name: "created_by",       type: "text" },
      { name: "is_public",        type: "bool" },
    ],
  });
  app.save(challengeBank);

  // ── challenges ─────────────────────────────────────────────────────────────
  const challenges = new Collection({
    name: "challenges",
    type: "base",
    fields: [
      { name: "game_id",               type: "text",   required: true },
      { name: "station_id",            type: "text" },
      { name: "description",           type: "text",   required: true },
      { name: "coin_reward",           type: "number", required: true },
      { name: "difficulty",            type: "select", required: true,
        maxSelect: 1, values: ["easy", "medium", "hard"] },
      { name: "source",                type: "select", required: true,
        maxSelect: 1, values: ["bank", "host_authored", "bank_duplicate"] },
      { name: "bank_source_id",        type: "text" },
      { name: "status",                type: "select", required: true,
        maxSelect: 1, values: ["undrawn", "active", "pending_approval", "completed", "failed"] },
      { name: "completed_by_team_id",  type: "text" },
      { name: "submitted_at",          type: "date" },
      { name: "completed_at",          type: "date" },
      { name: "rejected_reason",       type: "text" },
    ],
  });
  app.save(challenges);

  // ── events ─────────────────────────────────────────────────────────────────
  const events = new Collection({
    name: "events",
    type: "base",
    fields: [
      { name: "game_id",  type: "text", required: true },
      { name: "type",     type: "select", required: true,
        maxSelect: 1,
        values: [
          "claim", "contest", "toll_paid",
          "challenge_submitted", "challenge_approved",
          "challenge_rejected", "challenge_drawn",
          "challenge_failed", "player_joined",
          "game_started", "game_ended",
        ],
      },
      { name: "team_id",           type: "text" },
      { name: "secondary_team_id", type: "text" },
      { name: "station_id",        type: "text" },
      { name: "challenge_id",      type: "text" },
      { name: "coins_involved",    type: "number" },
      { name: "was_partial",       type: "bool" },
      { name: "meta",              type: "json" },
    ],
  });
  app.save(events);

  // ── map_templates ──────────────────────────────────────────────────────────
  const mapTemplates = new Collection({
    name: "map_templates",
    type: "base",
    fields: [
      { name: "created_by_user_id", type: "text",   required: true },
      { name: "name",               type: "text",   required: true },
      { name: "city_name",          type: "text" },
      { name: "map_bounds",         type: "json" },
      { name: "stations",           type: "json" },
      { name: "station_count",      type: "number" },
      { name: "is_public",          type: "bool" },
      { name: "approval_status",    type: "select",
        maxSelect: 1, values: ["pending", "approved", "rejected"] },
      { name: "approved_by",        type: "text" },
      { name: "approved_at",        type: "date" },
      { name: "times_used",         type: "number" },
    ],
  });
  app.save(mapTemplates);

  // ── osm_station_cache ──────────────────────────────────────────────────────
  const osmCache = new Collection({
    name: "osm_station_cache",
    type: "base",
    fields: [
      { name: "bbox_hash",     type: "text", required: true },
      { name: "bbox_geojson",  type: "json" },
      { name: "stations_json", type: "json" },
      { name: "fetched_at",    type: "date", required: true },
    ],
  });
  app.save(osmCache);

  // ── spectator_access ───────────────────────────────────────────────────────
  const spectatorAccess = new Collection({
    name: "spectator_access",
    type: "base",
    fields: [
      { name: "game_id",      type: "text", required: true },
      { name: "user_id",      type: "text" },
      { name: "share_token",  type: "text", required: true },
      { name: "approved",     type: "bool" },
      { name: "approved_at",  type: "date" },
    ],
  });
  app.save(spectatorAccess);

}, (app) => {
  // rollback — delete in reverse dependency order
  for (const name of [
    "spectator_access", "osm_station_cache", "map_templates",
    "events", "challenges", "challenge_bank", "toll_payments",
    "station_claims", "stations", "team_members", "teams", "games",
  ]) {
    try {
      const col = app.findCollectionByNameOrId(name);
      app.delete(col);
    } catch (_) {}
  }
});
