# Station Reinforce — Design Spec
**Date:** 2026-03-25
**Status:** Approved

---

## Overview

Players can revisit a station they own and add more coins to increase its stake, up to a ceiling established when the station was last claimed or contested. This makes owned stations harder to contest without requiring a full re-claim.

---

## Rules

- A team may reinforce a station they currently own by depositing 1 or more coins.
- The maximum total stake after reinforcing is capped at the **stake ceiling** — the maximum the current owner *could have* placed when they claimed or contested the station:
  - **Initial claim** (no previous owner): ceiling = `max_stake_increment` (from game config)
  - **Contest win**: ceiling = `previous_owner_stake + max_stake_increment`
- Reinforcements can be done across multiple visits as long as the ceiling has not been reached.
- If `current_stake === stake_ceiling`, no further reinforcement is possible ("Fully reinforced").
- Coins placed via reinforce are permanently locked in — same as any stake.
- `Station.current_stake` is the **running total** of all coins staked by the current owner (initial claim + all reinforcements). It is no longer a direct copy of any single `StationClaim.coins_placed` value — `reinforce` rows record only the increment placed in that action, not the total.

---

## Schema Changes

### `StationClaim` — add field

```
stake_ceiling   int   (nullable — NULL for legacy rows with no live game data)
```

Set on every claim row:

| Action | `stake_ceiling` value |
|---|---|
| `initial_claim` | `max_stake_increment` (from game config) |
| `contest_win` | `previous_owner_stake + max_stake_increment` |
| `reinforce` | Copied from the most recent `initial_claim` or `contest_win` for this station |

Every row carries the ceiling in effect for that ownership period, making the history self-documenting. For `reinforce` rows, storing the ceiling is redundant (it can always be derived from the last non-reinforce row) but is included for audit clarity.

### `StationClaim.action` enum — add value

```
initial_claim | contest_win | reinforce
```

### `Event.type` enum — add value

```
... | reinforce
```

---

## Backend

### Update existing endpoints

**`POST /api/rr/station/{stationId}/claim`**

Two changes required:
1. Replace the hard-coded `coins > 5` validation with `coins > max_stake_increment` (read from the game record, default 5). This ensures the claim cap respects host configuration.
2. Write `stake_ceiling = max_stake_increment` on the new `StationClaim` row.

**`POST /api/rr/station/{stationId}/contest`**

Write `stake_ceiling = station.current_stake + max_stake_increment` on the new `StationClaim` row. Read `station.current_stake` before the contest write — this is the previous owner's stake.

---

### New endpoint — GET ceiling

`GET /api/rr/station/{stationId}/ceiling`

**Auth:** Required. Calling user must be an approved member of the team that owns the station.

**Validation:**
- Station must exist
- Station must have a current owner (`current_owner_team_id` is non-null) — if unclaimed, return `400 "station is not owned by any team"`
- `team.game_id` must equal `station.game_id` (game-scoping check)
- Calling user must be an approved member of the owning team

**Logic:**
- Query `station_claims` filtered by `station_id = stationId AND action IN ('initial_claim', 'contest_win')`, sorted by `claimed_at DESC`, limit 1
- Read `stake_ceiling` from that row

**Response:**
```json
{ "currentStake": 3, "stakeCeiling": 8 }
```

---

### New endpoint — reinforce

`POST /api/rr/station/{stationId}/reinforce`
Body: `{ teamId, coins }`

**Validation:**
- Station must exist
- Game must be `active`
- `team.game_id` must equal `game.id` (game-scoping check)
- Calling user must be an approved member of `teamId`
- Team must be the current owner of the station (`station.current_owner_team_id === teamId`)
- `coins >= 1`
- Query `station_claims` filtered by `station_id = stationId AND action IN ('initial_claim', 'contest_win')`, sorted by `claimed_at DESC`, limit 1 → read `stake_ceiling`
- `station.current_stake + coins <= stake_ceiling`
- `team.coin_balance >= coins`

**Transaction (atomic):**
1. Debit `team.coin_balance` by `coins`
2. Update `station.current_stake += coins`
3. Write `StationClaim` row: `action = reinforce`, `coins_placed = coins`, `stake_ceiling` = ceiling read above
4. Write `Event` row: `type = reinforce`, `team_id = teamId`, `station_id = stationId`, `coins_involved = coins`

**Response:**
```json
{ "ok": true, "newBalance": 12, "newStake": 7, "stakeCeiling": 8 }
```

---

## Frontend

### `StationModal` — own station state

On open, fetch `GET /api/rr/station/{stationId}/ceiling`. Show a brief loading state while the request is in flight.

**On fetch error:** Show an error message ("Could not load station info") with a retry button and a close button. Do not render any action UI.

**If `currentStake < stakeCeiling`:**
- Header: `{currentStake}🪙 staked · ceiling {stakeCeiling}🪙`
- Coin slider: min=1, max=`stakeCeiling - currentStake`
- Note: "Stake locked in"
- Button: "Reinforce — N coins"
- On success: close modal. `CoinHUD` and station stake update via existing SSE subscriptions.

**If `currentStake === stakeCeiling`:**
- Header: `{currentStake}🪙 staked`
- Message: "Fully reinforced"
- No action available

The `reinforce` endpoint response (`newBalance`, `newStake`, `stakeCeiling`) is available for local state refresh, but closing the modal on success (consistent with `doClaim`, `doContest`, `doToll`) is the correct pattern — SSE handles the map update.

No changes to `gameStore.ts` — ceiling is local modal state only.

### `StationModal.tsx` — existing claim slider

The unclaimed-station claim slider at line 124 currently uses a hard-coded `max={Math.min(5, myBalance)}`. Update this to `max={Math.min(maxStakeIncrement, myBalance)}` — the prop is already available on the component. This keeps the frontend consistent with the backend change to read `max_stake_increment` from the game config.

### `EventFeed.tsx`

Add a `case 'reinforce':` handler to render the new event type. Without it the raw type string will be displayed.

---

## Event Feed

New `reinforce` row:

> 🪙 **[Team Name]** reinforced **[Station Name]** (+N coins, now N🪙 staked)

Team colour border. Same visual style as `claim`.

---

## Migration

- Add `stake_ceiling` column (nullable int) to `station_claims` in the PocketBase migration file.
- Add `reinforce` to the `action` enum in `station_claims`.
- Add `reinforce` to the `type` enum in `events`.
- Existing rows: `stake_ceiling` defaults to `NULL` — no backfill required. No live games exist. The reinforce endpoint derives the ceiling dynamically via query, so NULL legacy rows do not affect correctness.
