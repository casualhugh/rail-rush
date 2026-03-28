# Rail Rush — To Do

## Refactors

### Remove the `/ceiling` endpoint — store stake_ceiling on the station record
**Files:** `backend/pb_hooks/stations.pb.js`, `backend/pb_migrations/`, `frontend/src/store/gameStore.ts`, `frontend/src/lib/api.ts`, `frontend/src/components/StationModal.tsx`

**Problem:** The `/ceiling` endpoint exists only because `stake_ceiling` isn't stored on the station. Instead it's derived by querying `station_claims` history. This means:
- The frontend must make an extra API call just to know the ceiling before showing the reinforce UI
- The reinforce endpoint runs the same claims history query independently (duplicated logic)
- The ceiling isn't in the Zustand store, so it's not available reactively

**Solution:** Add a `stake_ceiling` field to the `stations` collection. Set it in the same transaction as ownership transfers:
- On claim/stake (unified endpoint): `station.stake_ceiling = maxStakeIncrement`
- On contest/stake: `station.stake_ceiling = currentStake + maxStakeIncrement`
- When a station becomes unclaimed (if that ever happens): reset to 0

Then:
- Delete the `GET /api/rr/station/:stationId/ceiling` endpoint entirely
- Simplify the reinforce endpoint to read `station.stake_ceiling` directly
- Add `stakeCeiling` to the `Station` type in `gameStore.ts` — it arrives via SSE like everything else
- Remove `getStationCeiling()` from `api.ts`
- `StationModal.tsx` reads `station.stakeCeiling` from the store instead of fetching it

---

### Combine claim + contest into a single `stake` endpoint
**Files:** `backend/pb_hooks/stations.pb.js`, `frontend/src/lib/api.ts`, `frontend/src/components/StationModal.tsx`

**Problem:** Having separate `claim` and `contest` endpoints creates a race condition. If two teams tap an unclaimed station simultaneously, the slower one gets a `"station is already claimed"` error and must make a second API call (contest) — even if they offered more coins than the winner.

**Solution:** Replace both with a single endpoint, e.g. `POST /api/rr/station/:stationId/stake`:

- Body: `{ teamId, stake }` — the target total stake the team wants to set
- Backend reads `currentStake` inside the transaction (the ground truth)
  - If `currentStake === 0` → treat as initial claim, write `action: "initial_claim"`
  - If `currentStake > 0` → treat as contest, write `action: "contest_win"`
- Validation is the same for both cases: `currentStake < stake <= currentStake + maxStakeIncrement`
- Stake ceiling formula unifies too: `currentStake + maxStakeIncrement` (works for both since `0 + maxStakeIncrement = maxStakeIncrement`)
- Returns: `{ ok, newBalance, stake, prevTeamId? }` (prevTeamId present only when displacing an owner)

**Frontend changes:**
- Replace `claimStation(stationId, teamId, coins)` and `contestStation(stationId, teamId, newStake)` in `api.ts` with a single `stakeStation(stationId, teamId, stake)`
- `StationModal.tsx` already knows the current stake from the store — just send the desired total stake regardless of whether the station is owned

**Why this is better:** The player who offered more always wins, regardless of which request hit the server first. The backend resolves the race correctly inside the transaction.

---

## Bugs / Misleading Code

### Fix misleading error message on challenge fail block
**File:** `backend/pb_hooks/challenges.pb.js` line 36

**Current message:**
```
"your team failed this challenge — wait for another team to attempt it first"
```

**Problem:** This implies the team will eventually be unblocked after another team attempts it. They won't be. Once a team is added to `failed_team_ids`, they are permanently blocked from claiming that challenge — the list is never cleared for individual teams.

**Fix:** Change the message to something like:
```
"your team has already failed this challenge and cannot attempt it again"
```
