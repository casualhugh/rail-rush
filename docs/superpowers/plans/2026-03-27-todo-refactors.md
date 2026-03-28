# Todo Refactors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete all three items in docs/todo.md: fix a misleading error message, store `stake_ceiling` on the station record (removing the `/ceiling` endpoint), and merge `claim` + `contest` into a single `/stake` endpoint.

**Architecture:** All changes are self-contained to `backend/pb_hooks/stations.pb.js`, `backend/pb_hooks/challenges.pb.js`, a new migration, `frontend/src/lib/api.ts`, `frontend/src/store/gameStore.ts`, and `frontend/src/components/StationModal.tsx`. No new files needed beyond the migration.

**Tech Stack:** PocketBase JS hooks (JSVM), React + TypeScript (Vite), Zustand

---

## Task 1: Fix misleading error message on challenge fail block

**Files:**
- Modify: `backend/pb_hooks/challenges.pb.js:36`

- [ ] **Step 1: Change the error message**

In `challenges.pb.js` line 36, change:
```js
throw new ForbiddenError("your team failed this challenge — wait for another team to attempt it first");
```
to:
```js
throw new ForbiddenError("your team has already failed this challenge and cannot attempt it again");
```

- [ ] **Step 2: Commit**

```bash
git add backend/pb_hooks/challenges.pb.js
git commit -m "fix: correct misleading error message on challenge fail block"
```

---

## Task 2: Store stake_ceiling on station record; remove /ceiling endpoint

**Files:**
- Create: `backend/pb_migrations/14_station_stake_ceiling.pb.js`
- Modify: `backend/pb_hooks/stations.pb.js` (claim, contest, reinforce, delete ceiling endpoint)
- Modify: `frontend/src/store/gameStore.ts` (add `stakeCeiling` to `Station` type + `recordToStation`)
- Modify: `frontend/src/lib/api.ts` (remove `getStationCeiling`)
- Modify: `frontend/src/components/StationModal.tsx` (read from store, remove fetch)

### Step 2a: Write the migration

- [ ] **Step 1: Create migration file**

Create `backend/pb_migrations/14_station_stake_ceiling.pb.js`:

```js
/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const col = app.findCollectionByNameOrId("stations");
  col.fields.add(new NumberField({ name: "stake_ceiling", required: false }));
  app.save(col);
}, (app) => {
  const col = app.findCollectionByNameOrId("stations");
  col.fields.removeByName("stake_ceiling");
  app.save(col);
});
```

### Step 2b: Update backend claim endpoint

- [ ] **Step 2: Set stake_ceiling on station in the claim transaction**

In `stations.pb.js`, inside the `claim` endpoint's `runInTransaction` block, after `station.set("current_stake", coins)` add:

```js
station.set("stake_ceiling", maxStakeIncrement);
```

The full station saves block should look like:
```js
station.set("current_owner_team_id", teamId);
station.set("current_stake", coins);
station.set("stake_ceiling", maxStakeIncrement);
txApp.save(station);
```

### Step 2c: Update backend contest endpoint

- [ ] **Step 3: Set stake_ceiling on station in the contest transaction**

In `stations.pb.js`, inside the `contest` endpoint's `runInTransaction` block, after `station.set("current_stake", newStake)` add:

```js
station.set("stake_ceiling", currentStake + maxStakeIncrement);
```

The full station saves block should look like:
```js
station.set("current_owner_team_id", teamId);
station.set("current_stake", newStake);
station.set("stake_ceiling", currentStake + maxStakeIncrement);
txApp.save(station);
```

### Step 2d: Simplify reinforce endpoint

- [ ] **Step 4: Replace the claims query in reinforce with a direct station field read**

In the `reinforce` endpoint, replace the block that queries `station_claims` for the ceiling (lines ~293–302 in the current file):

```js
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
```

With:

```js
const stakeCeiling = station.get("stake_ceiling") || 0;
const currentStake = station.get("current_stake") || 0;
```

Also update the `reinforce` transaction to keep `stake_ceiling` on the claim record (it already sets it from the local var, so this is fine — the `claim.set("stake_ceiling", stakeCeiling)` line stays as-is).

### Step 2e: Delete the /ceiling endpoint

- [ ] **Step 5: Delete the GET /ceiling endpoint**

Remove the entire `routerAdd("GET", "/api/rr/station/{stationId}/ceiling", ...)` block (lines ~206–252 in the current file).

### Step 2f: Update frontend types

- [ ] **Step 6: Add stakeCeiling to the Station type in gameStore.ts**

In `gameStore.ts`, add `stakeCeiling: number` to the `Station` interface:

```ts
export interface Station {
  id: string
  gameId: string
  name: string
  lat: number
  lng: number
  ownerTeamId: string | null
  currentStake: number
  stakeCeiling: number
  isChallengeLocation: boolean
  activeChallengeId: string | null
}
```

- [ ] **Step 7: Map stake_ceiling in recordToStation**

In `gameStore.ts`, update `recordToStation` to include:

```ts
function recordToStation(r: Record<string, unknown>): Station {
  return {
    id: r.id as string,
    gameId: (r.game_id as string) ?? '',
    name: r.name as string,
    lat: r.lat as number,
    lng: r.lng as number,
    ownerTeamId: (r.current_owner_team_id as string) || null,
    currentStake: (r.current_stake as number) ?? 0,
    stakeCeiling: (r.stake_ceiling as number) ?? 0,
    isChallengeLocation: (r.is_challenge_location as boolean) ?? false,
    activeChallengeId: (r.active_challenge_id as string) || null,
  }
}
```

### Step 2g: Update api.ts

- [ ] **Step 8: Remove getStationCeiling from api.ts**

Delete these lines from `api.ts`:

```ts
export const getStationCeiling = (stationId: string) =>
  api.get<{ currentStake: number; stakeCeiling: number }>(`/api/rr/station/${stationId}/ceiling`)
```

### Step 2h: Update StationModal.tsx

- [ ] **Step 9: Remove ceiling fetch state and useEffect from StationModal.tsx**

Remove:
- The `ceilingLoading`, `ceilingError`, `stakeCeiling` state declarations
- The `loadCeiling` function
- The `useEffect` that calls `loadCeiling`
- The `getStationCeiling` import

Replace the `stakeCeiling` local state usage with `station.stakeCeiling` from props.

The updated top of the component (after removing ceiling state) should look like:

```tsx
export default function StationModal({ station, myTeamId, tollCost, maxStakeIncrement, onClose, onChallengeOpen }: Props) {
  const { teams, challenges } = useGameStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [reinforceCoins, setReinforceCoins] = useState(1)

  const myTeam = teams.find(t => t.id === myTeamId)
  const ownerTeam = teams.find(t => t.id === station.ownerTeamId)
  const activeChallenge = challenges.find(c => c.id === station.activeChallengeId && c.status === 'active')

  const isOwn    = station.ownerTeamId === myTeamId
  const isEnemy  = !!station.ownerTeamId && !isOwn
  const isFree   = !station.ownerTeamId

  const currentStake = station.currentStake ?? 0
  const stakeCeiling = station.stakeCeiling ?? 0
  // ... rest unchanged
```

- [ ] **Step 10: Update the own-station JSX section to use station.stakeCeiling**

The own-station section currently conditionally renders based on `stakeCeiling !== null` (since it was async-loaded). Now it's always present. Simplify:

- Remove the `{ceilingLoading && <p ...>Loading…</p>}` line
- Remove the `{ceilingError !== null && ...}` retry block
- Change `{stakeCeiling !== null && currentStake < stakeCeiling && (() => {` to `{currentStake < stakeCeiling && (() => {`
- Change `{stakeCeiling !== null && currentStake === stakeCeiling && (` to `{currentStake === stakeCeiling && (`
- Remove the `getStationCeiling` import from the import line at the top

The import line should become:
```tsx
import { reinforceStation, claimStation, contestStation, payToll } from '../lib/api'
```

- [ ] **Step 11: Verify TypeScript build passes**

```bash
cd frontend && npm run build
```
Expected: clean build with no TypeScript errors.

- [ ] **Step 12: Commit**

```bash
git add backend/pb_migrations/14_station_stake_ceiling.pb.js backend/pb_hooks/stations.pb.js frontend/src/store/gameStore.ts frontend/src/lib/api.ts frontend/src/components/StationModal.tsx
git commit -m "refactor: store stake_ceiling on station record, remove /ceiling endpoint"
```

---

## Task 3: Combine claim + contest into a single /stake endpoint

**Files:**
- Modify: `backend/pb_hooks/stations.pb.js` (replace claim + contest with stake)
- Modify: `frontend/src/lib/api.ts` (replace claimStation + contestStation with stakeStation)
- Modify: `frontend/src/components/StationModal.tsx` (update doClaim + doContest to doStake)

### Step 3a: Replace backend claim + contest with /stake

- [ ] **Step 1: Replace the claim and contest routerAdd blocks with a single /stake endpoint**

Delete the entire `routerAdd("POST", "/api/rr/station/{stationId}/claim", ...)` block and the entire `routerAdd("POST", "/api/rr/station/{stationId}/contest", ...)` block.

Replace them with:

```js
// POST /api/rr/station/{stationId}/stake
// Body: { teamId, stake } — unified claim/contest. Works for both unclaimed and claimed stations.
routerAdd("POST", "/api/rr/station/{stationId}/stake", (e) => {
  const { writeEvent } = require(`${__hooks}/shared.js`);
  const authRecord = e.auth;
  if (!authRecord) throw new UnauthorizedError("unauthenticated");

  const stationId = e.request.pathValue("stationId");
  const body = e.requestInfo().body;
  const teamId = body.teamId;
  const stake = parseInt(body.stake, 10);

  if (!teamId) throw new BadRequestError("teamId is required");
  if (isNaN(stake) || stake < 1) throw new BadRequestError("stake must be a positive integer");

  let station;
  try { station = e.app.findRecordById("stations", stationId); }
  catch (_) { throw new NotFoundError("station not found"); }

  const game = e.app.findRecordById("games", station.get("game_id"));
  if (game.get("status") !== "active") throw new BadRequestError("game is not active");

  const currentStake = station.get("current_stake") || 0;
  const currentOwnerTeamId = station.get("current_owner_team_id") || null;
  const maxStakeIncrement = game.get("max_stake_increment") || 5;

  // Owner cannot use /stake to contest their own station
  if (currentOwnerTeamId === teamId) throw new BadRequestError("you already own this station");

  // Unified validation: stake must be > currentStake and <= currentStake + maxStakeIncrement
  if (stake <= currentStake) throw new BadRequestError(`stake must be greater than current stake of ${currentStake}`);
  if (stake > currentStake + maxStakeIncrement) throw new BadRequestError(`stake cannot exceed ${currentStake + maxStakeIncrement}`);

  const team = e.app.findRecordById("teams", teamId);
  if (team.get("game_id") !== game.id) throw new BadRequestError("team does not belong to this game");
  if (team.get("coin_balance") < stake) throw new BadRequestError("insufficient coins");

  const _members = e.app.findRecordsByFilter(
    "team_members",
    "team_id = {:teamId} && user_id = {:userId} && approved_by_host = true",
    "", 1, 0, { teamId, userId: authRecord.id }
  );
  if (!_members || _members.length === 0) throw new ForbiddenError("you are not an approved member of this team");

  const prevTeamId = currentOwnerTeamId;
  const action = currentOwnerTeamId ? "contest_win" : "initial_claim";

  e.app.runInTransaction((txApp) => {
    team.set("coin_balance", team.get("coin_balance") - stake);
    txApp.save(team);

    const claimCol = txApp.findCollectionByNameOrId("station_claims");
    const claim = new Record(claimCol);
    claim.set("station_id", stationId);
    claim.set("game_id", game.id);
    claim.set("team_id", teamId);
    claim.set("coins_placed", stake);
    claim.set("action", action);
    claim.set("stake_ceiling", currentStake + maxStakeIncrement);
    claim.set("claimed_at", new Date().toISOString());
    txApp.save(claim);

    station.set("current_owner_team_id", teamId);
    station.set("current_stake", stake);
    station.set("stake_ceiling", currentStake + maxStakeIncrement);
    txApp.save(station);

    const eventType = currentOwnerTeamId ? "contest" : "claim";
    writeEvent(txApp, {
      gameId: game.id, type: eventType,
      teamId,
      ...(prevTeamId ? { secondaryTeamId: prevTeamId } : {}),
      stationId, coinsInvolved: stake,
    });
  });

  return e.json(200, {
    ok: true,
    newBalance: team.get("coin_balance"),
    stake,
    ...(prevTeamId ? { prevTeamId } : {}),
  });
});
```

### Step 3b: Update frontend api.ts

- [ ] **Step 2: Replace claimStation + contestStation with stakeStation in api.ts**

Remove:
```ts
export const claimStation = (stationId: string, teamId: string, coins: number) =>
  api.post<{ ok: boolean; newBalance: number; stake: number }>(`/api/rr/station/${stationId}/claim`, { teamId, coins })

export const contestStation = (stationId: string, teamId: string, newStake: number) =>
  api.post<{ ok: boolean; newBalance: number; newStake: number; prevTeamId: string }>(`/api/rr/station/${stationId}/contest`, { teamId, newStake })
```

Add:
```ts
export const stakeStation = (stationId: string, teamId: string, stake: number) =>
  api.post<{ ok: boolean; newBalance: number; stake: number; prevTeamId?: string }>(`/api/rr/station/${stationId}/stake`, { teamId, stake })
```

### Step 3c: Update StationModal.tsx

- [ ] **Step 3: Replace doClaim + doContest with doStake in StationModal.tsx**

Update the import line (already removed `getStationCeiling` in Task 2) to replace `claimStation, contestStation` with `stakeStation`:
```tsx
import { reinforceStation, stakeStation, payToll } from '../lib/api'
```

Replace the `doClaim` and `doContest` functions with a single `doStake` that takes a stake amount:

```tsx
async function doStake(stake: number) {
  setError('')
  setLoading(true)
  try {
    await stakeStation(station.id, myTeamId, stake)
    onClose()
  } catch (err: unknown) {
    setError(err instanceof Error ? err.message : 'Failed to stake')
  } finally { setLoading(false) }
}
```

- [ ] **Step 4: Update the JSX to call doStake**

For the free station section, change `onClick={doClaim}` to `onClick={() => doStake(claimCoins)}`.

For the enemy station section, change `onClick={doContest}` to `onClick={() => doStake(Math.min(contestStake, Math.max(contestMin, contestMax)))}`.

- [ ] **Step 5: Verify TypeScript build passes**

```bash
cd frontend && npm run build
```
Expected: clean build with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add backend/pb_hooks/stations.pb.js frontend/src/lib/api.ts frontend/src/components/StationModal.tsx
git commit -m "refactor: combine claim + contest into unified /stake endpoint"
```
