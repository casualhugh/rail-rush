# Station Reinforce Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow teams to top up the coin stake on a station they own, up to a ceiling set when the station was last claimed or contested.

**Architecture:** A new PocketBase migration adds `stake_ceiling` to `station_claims` and `reinforce` to two enums. Two new endpoints (`GET /ceiling`, `POST /reinforce`) are added to `stations.pb.js`. The existing `/claim` and `/contest` endpoints are updated to write `stake_ceiling`. `StationModal.tsx` gains a ceiling fetch and reinforce UI for the own-station state, and `EventFeed.tsx` gains a `reinforce` case.

**Tech Stack:** PocketBase JS hooks (JSVM runtime), React 18 + TypeScript, Zustand, Vite. PocketBase runs at `http://127.0.0.1:8090`. Start it with `cd backend && ./pocketbase serve`.

**Spec:** `docs/superpowers/specs/2026-03-25-station-reinforce-design.md`

---

## File Map

| File | Change |
|---|---|
| `backend/pb_migrations/2_reinforce.pb.js` | **Create** — add `stake_ceiling` field + `reinforce` enum values |
| `backend/pb_hooks/stations.pb.js` | **Modify** — update `/claim`, update `/contest`, add GET `/ceiling`, add POST `/reinforce` |
| `frontend/src/lib/api.ts` | **Modify** — add `getStationCeiling` and `reinforceStation` helpers |
| `frontend/src/components/StationModal.tsx` | **Modify** — replace own-station section with ceiling fetch + reinforce UI; fix claim slider max |
| `frontend/src/components/StationModal.module.css` | **Modify** — add `.reinforcedMsg` style |
| `frontend/src/components/EventFeed.tsx` | **Modify** — add `case 'reinforce':` |

---

## Task 1: Migration — add `stake_ceiling` field and `reinforce` enum values

**Files:**
- Create: `backend/pb_migrations/2_reinforce.pb.js`

PocketBase applies new migration files automatically on the next startup. The file must be named with a numeric prefix higher than the existing migration (`1_`).

The `stake_ceiling` field must be `type: "number"` (not `"text"`) and `required: false` so it is nullable for legacy rows.

The rollback function removes the field and reverts enum values to their original arrays — it does **not** delete entire collections (only `1_initial_schema.pb.js` does that).

- [ ] **Step 1: Create the migration file**

Create `backend/pb_migrations/2_reinforce.pb.js` with this content:

```js
/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  // ── station_claims: add stake_ceiling (nullable number) + reinforce action ─
  const claimsCol = app.findCollectionByNameOrId("station_claims");

  claimsCol.fields.add({
    name: "stake_ceiling",
    type: "number",      // must be "number", not "text"
    required: false,     // nullable — legacy rows default to null
  });

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
```

- [ ] **Step 2: Restart PocketBase and verify migration applied**

```bash
# Kill any running instance, then:
cd backend && ./pocketbase serve
```

Expected in startup logs: `applied 1 migration(s)`. Then open `http://127.0.0.1:8090/_/` → Collections → `station_claims` → confirm `stake_ceiling` field exists with type `number`. Check `action` select includes `reinforce`. Check `events` → `type` select includes `reinforce`.

- [ ] **Step 3: Commit**

```bash
git add backend/pb_migrations/2_reinforce.pb.js
git commit -m "feat: migration — add stake_ceiling to station_claims, reinforce enum values"
```

---

## Task 2: Update `/claim` endpoint — fix coins cap + write `stake_ceiling`

**Files:**
- Modify: `backend/pb_hooks/stations.pb.js:1-55`

**Important:** The existing handler at line 16 has an early-exit guard `coins > 5` that runs _before_ the game record is loaded. This guard must be **deleted entirely** — not moved. A replacement validation `coins > maxStakeIncrement` is added _after_ loading the game record. Both the old guard and the replacement check `coins < 1`, so only one coins check should exist in the final handler.

The handler also needs to write `stake_ceiling = maxStakeIncrement` on the new `StationClaim` row.

- [ ] **Step 1: Replace the entire `/claim` handler**

Replace the `routerAdd("POST", "/api/rr/station/{stationId}/claim", ...)` block (lines 1–55) with:

```js
routerAdd("POST", "/api/rr/station/{stationId}/claim", (e) => {
  const { writeEvent } = require(`${__hooks}/shared.js`);
  const authRecord = e.auth;
  if (!authRecord) throw new UnauthorizedError("unauthenticated");

  const stationId = e.request.pathValue("stationId");
  const body = e.requestInfo().body;
  const teamId = body.teamId;
  const coins = parseInt(body.coins, 10);

  if (!teamId) throw new BadRequestError("teamId is required");
  // NOTE: coins validation against max_stake_increment is below, after game is loaded.
  // The old hard-coded "coins > 5" check has been removed.

  let station;
  try { station = e.app.findRecordById("stations", stationId); }
  catch (_) { throw new NotFoundError("station not found"); }

  const game = e.app.findRecordById("games", station.get("game_id"));
  if (game.get("status") !== "active") throw new BadRequestError("game is not active");
  if (station.get("current_owner_team_id")) throw new BadRequestError("station is already claimed");

  const maxStakeIncrement = game.get("max_stake_increment") || 5;
  if (isNaN(coins) || coins < 1 || coins > maxStakeIncrement) {
    throw new BadRequestError(`coins must be between 1 and ${maxStakeIncrement}`);
  }

  const team = e.app.findRecordById("teams", teamId);
  if (team.get("game_id") !== game.id) throw new BadRequestError("team does not belong to this game");
  if (team.get("coin_balance") < coins) throw new BadRequestError("insufficient coins");

  const _claimMembers = e.app.findRecordsByFilter(
    "team_members",
    "team_id = {:teamId} && user_id = {:userId} && approved_by_host = true",
    "", 1, 0, { teamId, userId: authRecord.id }
  );
  if (!_claimMembers || _claimMembers.length === 0) throw new ForbiddenError("you are not an approved member of this team");

  e.app.runInTransaction((txApp) => {
    team.set("coin_balance", team.get("coin_balance") - coins);
    txApp.save(team);

    const claimCol = txApp.findCollectionByNameOrId("station_claims");
    const claim = new Record(claimCol);
    claim.set("station_id", stationId);
    claim.set("game_id", game.id);
    claim.set("team_id", teamId);
    claim.set("coins_placed", coins);
    claim.set("action", "initial_claim");
    claim.set("stake_ceiling", maxStakeIncrement);
    claim.set("claimed_at", new Date().toISOString());
    txApp.save(claim);

    station.set("current_owner_team_id", teamId);
    station.set("current_stake", coins);
    txApp.save(station);

    writeEvent(txApp, { gameId: game.id, type: "claim", teamId, stationId, coinsInvolved: coins });
  });

  return e.json(200, { ok: true, newBalance: team.get("coin_balance"), stake: coins });
});
```

- [ ] **Step 2: Verify — claim a station and check `stake_ceiling`**

PocketBase hooks auto-reload on file save. Claim a station and check the new `station_claims` row in the admin UI — `stake_ceiling` should equal the game's `max_stake_increment` (default 5).

Also verify the fix works correctly if `max_stake_increment` is not 5: create a test game with `max_stake_increment = 3` and confirm you cannot claim with 4 coins but can with 3.

- [ ] **Step 3: Commit**

```bash
git add backend/pb_hooks/stations.pb.js
git commit -m "feat: /claim writes stake_ceiling, validates coins against max_stake_increment"
```

---

## Task 3: Update `/contest` endpoint — write `stake_ceiling`

**Files:**
- Modify: `backend/pb_hooks/stations.pb.js:58-126`

This is a one-line addition inside the transaction. `currentStake` is the previous owner's stake (already read at line 84 before the write). `maxStakeIncrement` is already read at line 85.

- [ ] **Step 1: Update the transaction block inside `/contest`**

Replace the transaction block inside the contest route with:

```js
e.app.runInTransaction((txApp) => {
  team.set("coin_balance", team.get("coin_balance") - newStake);
  txApp.save(team);

  const claimCol = txApp.findCollectionByNameOrId("station_claims");
  const claim = new Record(claimCol);
  claim.set("station_id", stationId);
  claim.set("game_id", game.id);
  claim.set("team_id", teamId);
  claim.set("coins_placed", newStake);
  claim.set("action", "contest_win");
  claim.set("stake_ceiling", currentStake + maxStakeIncrement);
  claim.set("claimed_at", new Date().toISOString());
  txApp.save(claim);

  station.set("current_owner_team_id", teamId);
  station.set("current_stake", newStake);
  txApp.save(station);

  writeEvent(txApp, {
    gameId: game.id, type: "contest",
    teamId, secondaryTeamId: prevTeamId,
    stationId, coinsInvolved: newStake,
  });
});
```

- [ ] **Step 2: Verify — contest a station and check `stake_ceiling`**

Contest a station where the previous stake was 3 and `max_stake_increment` is 5. The new `station_claims` row should have `stake_ceiling = 8`.

- [ ] **Step 3: Commit**

```bash
git add backend/pb_hooks/stations.pb.js
git commit -m "feat: /contest writes stake_ceiling on claim row"
```

---

## Task 4: Add `GET /ceiling` endpoint

**Files:**
- Modify: `backend/pb_hooks/stations.pb.js` (append new route)

**Auth note:** This endpoint does **not** require a `teamId` query parameter. The owning team is derived from `station.current_owner_team_id`. The auth check verifies that the calling user (`e.auth`) is an approved member of that team. No query params are needed — the station ID in the path is sufficient.

The ceiling query filters `station_claims` on `action = 'initial_claim' OR action = 'contest_win'` sorted by `claimed_at DESC`. This explicitly excludes `reinforce` rows, which copy the ceiling from the authoritative claim row but are not themselves the source of truth.

- [ ] **Step 1: Append the `GET /ceiling` route to `stations.pb.js`**

Add after the existing `/toll` route (before the `/stations` bulk-add route):

```js
// GET /api/rr/station/{stationId}/ceiling
// Returns the current stake and reinforce ceiling for the station's owning team.
// Auth: caller must be an approved member of the owning team.
// No teamId query param — owner is derived from the station record.
routerAdd("GET", "/api/rr/station/{stationId}/ceiling", (e) => {
  const authRecord = e.auth;
  if (!authRecord) throw new UnauthorizedError("unauthenticated");

  const stationId = e.request.pathValue("stationId");

  let station;
  try { station = e.app.findRecordById("stations", stationId); }
  catch (_) { throw new NotFoundError("station not found"); }

  const ownerTeamId = station.get("current_owner_team_id");
  if (!ownerTeamId) throw new BadRequestError("station is not owned by any team");

  const ownerTeam = e.app.findRecordById("teams", ownerTeamId);
  const game = e.app.findRecordById("games", station.get("game_id"));

  // Game-scoping: owning team must belong to this station's game
  if (ownerTeam.get("game_id") !== game.id) throw new BadRequestError("team does not belong to this game");

  // Auth: caller must be an approved member of the owning team
  const members = e.app.findRecordsByFilter(
    "team_members",
    "team_id = {:teamId} && user_id = {:userId} && approved_by_host = true",
    "", 1, 0,
    { teamId: ownerTeamId, userId: authRecord.id }
  );
  if (!members || members.length === 0) throw new ForbiddenError("you are not an approved member of the owning team");

  // Find the most recent initial_claim or contest_win (excludes reinforce rows)
  // sorted by claimed_at DESC so the latest ownership event is first
  const claims = e.app.findRecordsByFilter(
    "station_claims",
    "station_id = {:stationId} && (action = 'initial_claim' || action = 'contest_win')",
    "-claimed_at", 1, 0,
    { stationId }
  );
  if (!claims || claims.length === 0) throw new NotFoundError("no claim history found for this station");

  const stakeCeiling = claims[0].get("stake_ceiling") || 0;
  const currentStake = station.get("current_stake") || 0;

  return e.json(200, { currentStake, stakeCeiling });
});
```

- [ ] **Step 2: Verify**

```bash
# Should return ceiling for an owned station
curl -s "http://127.0.0.1:8090/api/rr/station/STATION_ID/ceiling" \
  -H "Authorization: TOKEN"
# Expected: {"currentStake":3,"stakeCeiling":5}

# Should 400 for an unclaimed station
curl -s "http://127.0.0.1:8090/api/rr/station/UNCLAIMED_STATION_ID/ceiling" \
  -H "Authorization: TOKEN"
# Expected: 400 "station is not owned by any team"

# Should 403 if caller is not on the owning team
# (use a token from a different team)
# Expected: 403 "you are not an approved member of the owning team"
```

- [ ] **Step 3: Commit**

```bash
git add backend/pb_hooks/stations.pb.js
git commit -m "feat: add GET /station/:id/ceiling endpoint"
```

---

## Task 5: Add `POST /reinforce` endpoint

**Files:**
- Modify: `backend/pb_hooks/stations.pb.js` (append new route)

- [ ] **Step 1: Append the `POST /reinforce` route**

Add after the `GET /ceiling` route:

```js
// POST /api/rr/station/{stationId}/reinforce
// Body: { teamId, coins }
// Owning team adds coins to their stake, up to the stake_ceiling.
routerAdd("POST", "/api/rr/station/{stationId}/reinforce", (e) => {
  const { writeEvent } = require(`${__hooks}/shared.js`);
  const authRecord = e.auth;
  if (!authRecord) throw new UnauthorizedError("unauthenticated");

  const stationId = e.request.pathValue("stationId");
  const body = e.requestInfo().body;
  const teamId = body.teamId;
  const coins = parseInt(body.coins, 10);

  if (!teamId) throw new BadRequestError("teamId is required");
  if (isNaN(coins) || coins < 1) throw new BadRequestError("coins must be a positive integer");

  let station;
  try { station = e.app.findRecordById("stations", stationId); }
  catch (_) { throw new NotFoundError("station not found"); }

  const game = e.app.findRecordById("games", station.get("game_id"));
  if (game.get("status") !== "active") throw new BadRequestError("game is not active");

  const team = e.app.findRecordById("teams", teamId);
  if (team.get("game_id") !== game.id) throw new BadRequestError("team does not belong to this game");

  const ownerTeamId = station.get("current_owner_team_id");
  if (!ownerTeamId) throw new BadRequestError("station is unclaimed");
  if (ownerTeamId !== teamId) throw new ForbiddenError("you do not own this station");

  const members = e.app.findRecordsByFilter(
    "team_members",
    "team_id = {:teamId} && user_id = {:userId} && approved_by_host = true",
    "", 1, 0,
    { teamId, userId: authRecord.id }
  );
  if (!members || members.length === 0) throw new ForbiddenError("you are not an approved member of this team");

  // Find stake_ceiling from most recent initial_claim or contest_win (excludes reinforce rows)
  const claims = e.app.findRecordsByFilter(
    "station_claims",
    "station_id = {:stationId} && (action = 'initial_claim' || action = 'contest_win')",
    "-claimed_at", 1, 0,
    { stationId }
  );
  if (!claims || claims.length === 0) throw new NotFoundError("no claim history found for this station");

  const stakeCeiling = claims[0].get("stake_ceiling") || 0;
  const currentStake = station.get("current_stake") || 0;

  if (currentStake + coins > stakeCeiling) {
    throw new BadRequestError(`stake would exceed ceiling of ${stakeCeiling} (currently ${currentStake})`);
  }
  if (team.get("coin_balance") < coins) throw new BadRequestError("insufficient coins");

  e.app.runInTransaction((txApp) => {
    team.set("coin_balance", team.get("coin_balance") - coins);
    txApp.save(team);

    station.set("current_stake", currentStake + coins);
    txApp.save(station);

    const claimCol = txApp.findCollectionByNameOrId("station_claims");
    const claim = new Record(claimCol);
    claim.set("station_id", stationId);
    claim.set("game_id", game.id);
    claim.set("team_id", teamId);
    claim.set("coins_placed", coins);
    claim.set("action", "reinforce");
    claim.set("stake_ceiling", stakeCeiling);
    claim.set("claimed_at", new Date().toISOString());
    txApp.save(claim);

    writeEvent(txApp, { gameId: game.id, type: "reinforce", teamId, stationId, coinsInvolved: coins });
  });

  return e.json(200, {
    ok: true,
    newBalance: team.get("coin_balance"),
    newStake: currentStake + coins,
    stakeCeiling,
  });
});
```

- [ ] **Step 2: Verify**

```bash
# Should succeed
curl -s -X POST http://127.0.0.1:8090/api/rr/station/STATION_ID/reinforce \
  -H "Authorization: TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"teamId":"TEAM_ID","coins":2}'
# Expected: {"ok":true,"newBalance":...,"newStake":5,"stakeCeiling":5}

# Should 400 when exceeding ceiling
curl -s -X POST http://127.0.0.1:8090/api/rr/station/STATION_ID/reinforce \
  -H "Authorization: TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"teamId":"TEAM_ID","coins":99}'
# Expected: 400 "stake would exceed ceiling of ..."

# Should 400 for missing/non-integer coins
curl -s -X POST http://127.0.0.1:8090/api/rr/station/STATION_ID/reinforce \
  -H "Authorization: TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"teamId":"TEAM_ID"}'
# Expected: 400 "coins must be a positive integer"
```

Check `station_claims` in the admin UI — new row with `action = reinforce`, `stake_ceiling` matching the last claim row.

- [ ] **Step 3: Commit**

```bash
git add backend/pb_hooks/stations.pb.js
git commit -m "feat: add POST /station/:id/reinforce endpoint"
```

---

## Task 6: Add API helpers in `api.ts`

**Files:**
- Modify: `frontend/src/lib/api.ts`

`stakeCeiling` in the return type is `number` (not `number | null`) — the endpoint always returns a number or 4xx, so the frontend never receives null.

- [ ] **Step 1: Add helpers after the `payToll` export**

```ts
export const getStationCeiling = (stationId: string) =>
  api.get<{ currentStake: number; stakeCeiling: number }>(`/api/rr/station/${stationId}/ceiling`)

export const reinforceStation = (stationId: string, teamId: string, coins: number) =>
  api.post<{ ok: boolean; newBalance: number; newStake: number; stakeCeiling: number }>(
    `/api/rr/station/${stationId}/reinforce`, { teamId, coins }
  )
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat: add getStationCeiling and reinforceStation API helpers"
```

---

## Task 7: Update `StationModal` — reinforce UI + fix claim slider

**Files:**
- Modify: `frontend/src/components/StationModal.tsx`
- Modify: `frontend/src/components/StationModal.module.css`

Key changes:
- New state variables for ceiling fetch lifecycle
- `useEffect(() => { if (isOwn) loadCeiling() }, [])` — empty dependency array, fires once on mount
- The claim slider's `max` changes from the hard-coded `5` to `maxStakeIncrement` (the prop is already available)
- Import updated to use typed helpers from `api.ts` instead of inline `api.post`

- [ ] **Step 1: Add `.reinforcedMsg` to `StationModal.module.css`**

Add after `.ownMsg`:

```css
.reinforcedMsg {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--color-text-muted);
  font-size: 0.875rem;
  font-style: italic;
  padding: 0.5rem 0;
}
```

- [ ] **Step 2: Replace `StationModal.tsx` with the full updated component**

```tsx
import { useState, useEffect } from 'react'
import { useGameStore, type Station, type Challenge } from '../store/gameStore'
import { getStationCeiling, reinforceStation, claimStation, contestStation, payToll } from '../lib/api'
import styles from './StationModal.module.css'

interface Props {
  station: Station
  myTeamId: string
  tollCost: number
  maxStakeIncrement: number
  onClose: () => void
  onChallengeOpen: (challenge: Challenge) => void
}

export default function StationModal({ station, myTeamId, tollCost, maxStakeIncrement, onClose, onChallengeOpen }: Props) {
  const { teams, challenges } = useGameStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Own-station ceiling state
  const [ceilingLoading, setCeilingLoading] = useState(false)
  const [ceilingError, setCeilingError] = useState('')
  const [stakeCeiling, setStakeCeiling] = useState<number | null>(null)
  const [reinforceCoins, setReinforceCoins] = useState(1)

  const myTeam = teams.find(t => t.id === myTeamId)
  const ownerTeam = teams.find(t => t.id === station.ownerTeamId)
  const activeChallenge = challenges.find(c => c.id === station.activeChallengeId && c.status === 'active')

  const isOwn    = station.ownerTeamId === myTeamId
  const isEnemy  = !!station.ownerTeamId && !isOwn
  const isFree   = !station.ownerTeamId

  const currentStake = station.currentStake ?? 0
  const minContest   = currentStake + 1
  const maxContest   = currentStake + maxStakeIncrement
  const myBalance    = myTeam?.coinBalance ?? 0

  // Contest slider range
  const contestMin = Math.min(minContest, myBalance)
  const contestMax = Math.min(maxContest, myBalance)
  const [contestStake, setContestStake] = useState(Math.min(minContest, myBalance))

  // Claim slider
  const [claimCoins, setClaimCoins] = useState(1)

  // Effective toll (may be partial)
  const effectiveToll = Math.min(tollCost, myBalance)
  const isPartialToll = effectiveToll < tollCost

  // Load ceiling when this is our own station. Empty [] — fires once on mount.
  useEffect(() => {
    if (isOwn) loadCeiling()
  }, [])

  async function loadCeiling() {
    setCeilingError('')
    setCeilingLoading(true)
    try {
      const data = await getStationCeiling(station.id)
      setStakeCeiling(data.stakeCeiling)
      setReinforceCoins(1)
    } catch (err: unknown) {
      setCeilingError(err instanceof Error ? err.message : 'Could not load station info')
    } finally {
      setCeilingLoading(false)
    }
  }

  async function doClaim() {
    setError('')
    setLoading(true)
    try {
      await claimStation(station.id, myTeamId, claimCoins)
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to claim')
    } finally { setLoading(false) }
  }

  async function doContest() {
    setError('')
    setLoading(true)
    try {
      await contestStation(station.id, myTeamId, contestStake)
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to contest')
    } finally { setLoading(false) }
  }

  async function doToll() {
    setError('')
    setLoading(true)
    try {
      await payToll(station.id, myTeamId)
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to pay toll')
    } finally { setLoading(false) }
  }

  async function doReinforce() {
    setError('')
    setLoading(true)
    try {
      await reinforceStation(station.id, myTeamId, reinforceCoins)
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to reinforce')
    } finally { setLoading(false) }
  }

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.sheet}>
        <div className={styles.handle} />

        {/* Station name + owner */}
        <div className={styles.stationHeader}>
          <h2 className={styles.stationName}>{station.name}</h2>
          {ownerTeam && (
            <div className={styles.ownerTag} style={{ background: ownerTeam.color }}>
              {ownerTeam.name} · {currentStake}🪙 staked
            </div>
          )}
        </div>

        {/* Challenge badge if present */}
        {activeChallenge && (
          <button
            className={styles.challengeBanner}
            onClick={() => { onChallengeOpen(activeChallenge); onClose() }}
          >
            <span className={styles.challengeTriangle}>▽</span>
            <span className={styles.challengeBannerText}>
              <strong>{activeChallenge.description.slice(0, 60)}{activeChallenge.description.length > 60 ? '…' : ''}</strong>
              <span className={styles.challengeReward}>+{activeChallenge.coinReward}🪙</span>
            </span>
            <span className={styles.challengeArrow}>→</span>
          </button>
        )}

        {error && <p className={styles.error}>{error}</p>}

        {/* Own station */}
        {isOwn && (
          <>
            <div className={styles.ownMsg}>
              <span>✓</span> You own this station
              {stakeCeiling !== null && ` · ${currentStake}🪙 staked · ceiling ${stakeCeiling}🪙`}
            </div>

            {ceilingLoading && <p className={styles.coinNote}>Loading…</p>}

            {ceilingError && (
              <div className={styles.actions}>
                <p className={styles.error}>{ceilingError}</p>
                <button className={styles.closeBtn} onClick={loadCeiling}>Retry</button>
              </div>
            )}

            {stakeCeiling !== null && currentStake < stakeCeiling && (
              <div className={styles.actions}>
                <p className={styles.actionLabel}>Reinforce</p>
                <div className={styles.sliderRow}>
                  <input
                    type="range"
                    min={1}
                    max={Math.min(stakeCeiling - currentStake, myBalance)}
                    value={reinforceCoins}
                    onChange={e => setReinforceCoins(+e.target.value)}
                    className={styles.slider}
                  />
                  <span className={styles.sliderVal}>{reinforceCoins}🪙</span>
                </div>
                <p className={styles.coinNote}>Stake locked in · balance: {myBalance}🪙</p>
                <button
                  className={styles.primaryBtn}
                  onClick={doReinforce}
                  disabled={loading || myBalance < 1}
                >
                  {loading ? '…' : `Reinforce — ${reinforceCoins} coin${reinforceCoins !== 1 ? 's' : ''}`}
                </button>
              </div>
            )}

            {stakeCeiling !== null && currentStake >= stakeCeiling && (
              <p className={styles.reinforcedMsg}>Fully reinforced — {currentStake}🪙 staked</p>
            )}
          </>
        )}

        {/* Unclaimed station */}
        {isFree && (
          <div className={styles.actions}>
            <p className={styles.actionLabel}>Place coins to claim</p>
            <div className={styles.sliderRow}>
              {/* max uses maxStakeIncrement prop — previously hard-coded to 5 */}
              <input type="range" min={1} max={Math.min(maxStakeIncrement, myBalance)} value={claimCoins}
                onChange={e => setClaimCoins(+e.target.value)} className={styles.slider} />
              <span className={styles.sliderVal}>{claimCoins}🪙</span>
            </div>
            <p className={styles.coinNote}>Stake locked in · balance: {myBalance}🪙</p>
            <button className={styles.primaryBtn} onClick={doClaim} disabled={loading || myBalance < 1}>
              {loading ? '…' : `Claim — ${claimCoins} coin${claimCoins !== 1 ? 's' : ''}`}
            </button>
          </div>
        )}

        {/* Enemy station */}
        {isEnemy && (
          <div className={styles.actions}>
            <p className={styles.actionLabel}>Contest & Claim</p>
            {myBalance >= minContest ? (
              <>
                <div className={styles.sliderRow}>
                  <input type="range"
                    min={contestMin} max={Math.max(contestMin, contestMax)}
                    value={Math.min(contestStake, Math.max(contestMin, contestMax))}
                    onChange={e => setContestStake(+e.target.value)}
                    className={styles.slider} />
                  <span className={styles.sliderVal}>{Math.min(contestStake, Math.max(contestMin, contestMax))}🪙</span>
                </div>
                <p className={styles.coinNote}>Stake locked in · balance: {myBalance}🪙</p>
                <button className={styles.primaryBtn} onClick={doContest} disabled={loading}>
                  {loading ? '…' : `Contest — ${Math.min(contestStake, Math.max(contestMin, contestMax))} coins`}
                </button>
              </>
            ) : (
              <p className={styles.cantAfford}>Need at least {minContest}🪙 to contest (you have {myBalance}🪙)</p>
            )}

            <div className={styles.divider} />

            <button className={styles.tollBtn} onClick={doToll} disabled={loading}>
              {isPartialToll
                ? `Pay Toll — ${effectiveToll}🪙 (all you have) → ${ownerTeam?.name}`
                : `Pay Toll — ${tollCost}🪙 → ${ownerTeam?.name}`}
              <span className={styles.tollNote}>Goes to {ownerTeam?.name}</span>
            </button>
          </div>
        )}

        <button className={styles.closeBtn} onClick={onClose}>Close</button>
      </div>
    </>
  )
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run the dev server and manually verify**

```bash
cd frontend && npm run dev
```

Tap a station your team owns:
- Brief "Loading…" then header shows `· N🪙 staked · ceiling N🪙`
- If `currentStake < stakeCeiling`: reinforce slider and button appear
- Reinforce → modal closes → stake updates in real time via SSE
- If already at ceiling: "Fully reinforced" message only
- On a game with `max_stake_increment = 3`: claim slider should cap at 3, not 5

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/StationModal.tsx frontend/src/components/StationModal.module.css
git commit -m "feat: StationModal — reinforce UI for own stations, fix claim slider cap"
```

---

## Task 8: Update `EventFeed` — add `reinforce` case

**Files:**
- Modify: `frontend/src/components/EventFeed.tsx:38-101`

`EventFeedItem.type` is typed as `string` (not a union type), so TypeScript will **not** catch a typo like `'reinforced'` — it will silently fall to `default` and show the raw string. Double-check the spelling `'reinforce'` matches exactly what the backend writes to `events.type`. The existing `evClaim` CSS class is reused — no new CSS needed.

- [ ] **Step 1: Add the `reinforce` case before `default:`**

In `EventFeed.tsx`, inside the `switch (ev.type)` block, add:

```tsx
case 'reinforce':
  return {
    icon: '🪙',
    text: <><span style={{ color: teamColor(t), fontWeight: 600 }}>{teamName(t)}</span> reinforced <strong>{stationName(s)}</strong> (+{coins}🪙)</>,
    className: styles.evClaim,
  }
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 3: Manually verify in the running dev server**

Reinforce a station in a running game, open the event feed. The new entry must show:
> 🪙 **[Team Name]** reinforced **[Station Name]** (+N🪙)

If it shows a raw string like `reinforce` instead, there is a spelling mismatch between the backend event type and the frontend case — check the backend `writeEvent` call in the reinforce endpoint.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/EventFeed.tsx
git commit -m "feat: EventFeed — add reinforce event display"
```

---

## Done

All 8 tasks complete. The reinforce mechanic is fully implemented:
- Schema updated via migration
- `/claim` and `/contest` write `stake_ceiling`; `/claim` coins validation uses `max_stake_increment`
- `GET /ceiling` and `POST /reinforce` endpoints active
- `StationModal` shows reinforce slider or "Fully reinforced" for own stations
- `EventFeed` displays reinforce events
