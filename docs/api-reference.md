# Rail Rush — API Reference

All endpoints are under `/api/rr/`. All requests require a valid PocketBase auth token (logged-in user). Errors follow the pattern `{ "message": "..." }` with an appropriate HTTP status code.

---

## Game Flow Overview

This is the lifecycle every game goes through, matched to what the UI does at each step.

### 1. Host sets up the game (HostSetup wizard)
The host fills in a 5-step wizard. On the final step, the UI fires three API calls in sequence:
1. **Create game** — creates the game record and all teams (each team starts with `startingCoins`)
2. **Save stations** — uploads the map pins placed in step 2
3. **Save challenges** — uploads the challenge list written in step 4 (optional)

The game is now in **`lobby`** status and the host is redirected to the lobby page.

### 2. Players join (Lobby page)
Players navigate to the lobby using the invite code shown on the host's screen. They pick a team and click **Join**. Their join request starts as **pending** — the host must approve them before they can act in-game. The host can also deny a request (deletes the record).

The host sees a **Start Game** button once every team has at least one approved player. Clicking it triggers the start API.

### 3. Game starts
The start API:
- Validates every team has ≥1 approved player
- Draws 3 initial challenges from the pool (`undrawn` → `active`)
- Sets game status to **`active`**
- Broadcasts a `game_started` SSE event → all lobby clients navigate to the game map

### 4. Active game (GameMap page)
Teams walk around and interact with stations and challenges on the map. Real-time updates come via SSE — the frontend doesn't poll, it just reacts to events.

**Station mechanics:**
- **Claim** — plant your flag on an unclaimed station by spending coins
- **Contest** — outbid the current owner to take their station
- **Reinforce** — add more coins to your own station to make it harder to contest
- **Toll** — if you're at an enemy station, you pay a fee to the owner

**Challenge mechanics** (team perspective):
1. **Claim** a challenge — lock it to your team so no one else can grab it
2. **Complete** it — submit for coins; if host approval is required, enters pending state
3. Or **Fail** it — releases the challenge with a 25% reward escalation; your team is blocked from retrying until another team attempts it

**Challenge mechanics** (host perspective):
- **Approve** — confirms a pending completion; team gets coins and a new challenge is drawn
- **Reject** — sends the challenge back to `active` so the team can try again
- **Mark impossible** — removes the challenge from play and draws a replacement

### 5. Game ends
The host clicks **End Game**. The end API calculates final scores (ranked by station count, then total staked coins as a tiebreaker), emits a `game_ended` event with the scores embedded, and sets status to **`ended`**. All clients receive the event via SSE and navigate to the end screen.

---

## Coins

Coins are a zero-sum resource within a game. They move between teams (contest, toll) or are spent on stakes (claim, reinforce). Challenges are the only source of *new* coins entering the system.

The **challenge completion bonus** is: +5% of the base reward for each challenge already completed in the game, capped at +200%. So the 20th completion in a game pays triple the base reward.

---

## 1. Game Lifecycle

### `POST /api/rr/game` — Create game
Creates the game record plus all teams. Called at the end of the HostSetup wizard.

**Body:**
```json
{
  "name": "London Rail Rush",
  "startingCoins": 25,
  "maxStakeIncrement": 5,
  "tollCost": 3,
  "maxActiveChallenges": 10,
  "requireHostApproval": false,
  "teams": [{ "name": "Team Teal", "color": "#1A6B6B" }]
}
```

**Returns:** `{ gameId, inviteCode, teams: [{ id, name, color }] }`

**Fails when:**
- Not authenticated
- You already have 5 active or lobby games (end or delete one first)
- `name` is missing
- `startingCoins` is not between 10 and 1000
- `maxStakeIncrement` is outside 1–1000 (if provided)
- Fewer than 2 teams, or more than 10 teams

---

### `GET /api/rr/game/:gameId` — Get full game state
Loads everything the game map page needs: game settings, all teams + coin balances, all stations, and active/pending challenges.

**Note:** Only returns challenges with status `active` or `pending_approval` — completed and failed challenges are excluded.

**Fails when:**
- Not authenticated
- Game not found

---

### `POST /api/rr/game/:gameId/start` — Start game *(host only)*
Transitions the game from `lobby` to `active`. Draws the first 3 challenges and broadcasts `game_started`.

**Fails when:**
- Not authenticated
- Not the host
- Game is not in `lobby` status
- Fewer than 2 teams exist
- Fewer than 2 teams have approved members
- Any team has zero approved members (every team must be ready)

---

### `POST /api/rr/game/:gameId/end` — End game *(host only)*
Calculates final scores, sets status to `ended`, and broadcasts `game_ended` with scores in the event metadata.

**Scoring:** Ranked by station count descending; total coins staked (on owned stations) as tiebreaker.

**Fails when:**
- Not authenticated
- Not the host
- Game is not `active`

---

### `DELETE /api/rr/game/:gameId` — Delete game *(host only)*
Hard-deletes the game and all associated data: teams, members, stations, claims, challenges, events, toll payments. Used from the lobby "Cancel Game" button.

**Fails when:**
- Not authenticated
- Not the host
- Game not found

---

## 2. Lobby

### `POST /api/rr/game/:gameId/join` — Join a team
Player picks a team and submits a join request. They start as **unapproved** and must wait for the host to approve them. The host is automatically approved when they join their own team.

**Body:** `{ "teamId": "..." }`

**Returns:** `{ memberId }`

**Fails when:**
- Not authenticated
- Game is not in `lobby`
- Team not found, or team doesn't belong to this game
- Player is already in this game on any team

---

### `POST /api/rr/game/:gameId/leave` — Leave team *(lobby only)*
Player removes themselves from their current team. Used to switch teams — leave and rejoin another.

**Fails when:**
- Not authenticated
- Game is not in `lobby`
- Player is not a member of this game

---

### `POST /api/rr/game/:gameId/approve/:memberId` — Approve player *(host only)*
Sets `approved_by_host = true` on the member record. The player is now eligible to participate in-game.

**Fails when:**
- Not authenticated
- Not the host
- Game not found
- Member not found
- Member doesn't belong to this game

---

### `POST /api/rr/game/:gameId/deny/:memberId` — Deny player *(host only)*
Deletes the member record entirely. Player can rejoin if they want.

**Fails when:**
- Not authenticated
- Not the host
- Game not found
- Member not found

---

## 3. Station Setup

### `POST /api/rr/game/:gameId/stations` — Save stations *(host only, lobby only)*
Replaces the entire station list for the game. Called during HostSetup after the map is drawn. Re-submitting wipes and recreates all stations.

**Body:** `{ "stations": [{ "name": "Paddington", "lat": 51.515, "lng": -0.176 }] }`

**Returns:** `{ created, stations: [{ id, name, lat, lng }] }`

**Fails when:**
- Not authenticated
- Not the host
- Game is not in `lobby`
- No stations provided
- More than 500 stations
- Any station has an invalid lat (must be −90 to 90) or lng (must be −180 to 180)

---

## 4. Station Actions *(active game only)*

All station actions require the caller to be an **approved member** of the specified team.

### `POST /api/rr/station/:stationId/claim` — Claim a station
Take ownership of an unclaimed station by placing coins on it.

**Body:** `{ "teamId": "...", "coins": 3 }`

**Returns:** `{ ok, newBalance, stake }`

**Fails when:**
- Game is not `active`
- Station is already owned by someone
- `coins` is not between 1 and `maxStakeIncrement`
- Team doesn't have enough coins
- Caller is not an approved member of the team

---

### `POST /api/rr/station/:stationId/contest` — Contest a station
Outbid the current owner to take ownership. Your bid must be strictly higher than the current stake, but within one `maxStakeIncrement` above it.

**Body:** `{ "teamId": "...", "newStake": 8 }`

**Returns:** `{ ok, newBalance, newStake, prevTeamId }`

**Fails when:**
- Game is not `active`
- Station is unclaimed (use claim instead)
- You already own this station
- `newStake` is not greater than the current stake
- `newStake` exceeds `currentStake + maxStakeIncrement`
- Team doesn't have enough coins
- Caller is not an approved member of the team

---

### `POST /api/rr/station/:stationId/toll` — Pay toll
You've arrived at an enemy station and owe a toll. Always succeeds — if the team is broke, a partial payment is made (whatever coins remain).

**Body:** `{ "teamId": "..." }`

**Returns:** `{ ok, coinsPaid, wasPartial, newBalance }`

**Fails when:**
- Game is not `active`
- Station is unclaimed (no toll owed)
- You own the station (free passage)
- Caller is not an approved member of the team

---

### `GET /api/rr/station/:stationId/ceiling` — Get reinforce ceiling *(owner only)*
Returns the current stake and the maximum coins the owner can reinforce up to. The ceiling is set when the station is first claimed or contested — it equals `stake + maxStakeIncrement` at the time of that action.

**Returns:** `{ currentStake, stakeCeiling }`

**Fails when:**
- Station is unclaimed
- Caller is not an approved member of the owning team
- No claim history found

---

### `POST /api/rr/station/:stationId/reinforce` — Reinforce a station *(owner only)*
Add coins to your own station's stake to make it more expensive to contest.

**Body:** `{ "teamId": "...", "coins": 2 }`

**Returns:** `{ ok, newBalance, newStake, stakeCeiling }`

**Fails when:**
- Game is not `active`
- Station is unclaimed
- You don't own this station
- Adding `coins` would push the stake above the ceiling
- Team doesn't have enough coins
- Caller is not an approved member of the team

---

## 5. Challenge Setup

### `POST /api/rr/game/:gameId/challenges` — Save challenges *(host only, lobby only)*
Saves the host's challenge list. Replaces any previously submitted challenges (re-submitting wipes and recreates). Challenges start with status `undrawn` — they won't appear in-game until drawn at start or after a completion.

**Body:** `{ "challenges": [{ "description": "...", "coinReward": 10, "difficulty": "medium", "stationId": "..." }] }`

**Returns:** `{ created, ids }`

**Fails when:**
- Not authenticated
- Not the host
- Game is not in `lobby`
- No challenges provided
- More than 500 challenges
- Any `coinReward` exceeds 1000

---

## 6. Challenge Actions *(active game only)*

### `POST /api/rr/challenge/:challengeId/claim` — Claim a challenge *(team)*
Lock the challenge to your team so you can attempt it. Your team can only hold one active claim at a time.

**Body:** `{ "teamId": "..." }`

**Fails when:**
- Challenge is not `active`
- Game is not `active`
- Your team previously failed this challenge — once a team fails a challenge they are permanently blocked from it
- Your team already has a different active challenge claimed
- Caller is not an approved member of the team

---

### `POST /api/rr/challenge/:challengeId/complete` — Complete a challenge *(team)*
Submit the challenge as done.
- If `requireHostApproval` is **off**: coins are awarded immediately and a new challenge is drawn
- If `requireHostApproval` is **on**: challenge enters `pending_approval`, host must approve or reject

**Body:** `{ "teamId": "..." }`

**Returns:** `{ ok, status, coinsAwarded? }` (coinsAwarded only present when immediately approved)

**Fails when:**
- Challenge is not `active`
- Game is not `active`
- Another team is currently attempting this challenge
- Caller is not an approved member of the team

---

### `POST /api/rr/challenge/:challengeId/fail` — Fail a challenge *(team)*
Give up on the challenge. The reward escalates by 25%, your team is blocked from retrying, and the challenge goes back to `active` for others. If every team in the game has failed, the challenge is discarded and a new one is drawn.

**Body:** `{ "teamId": "..." }`

**Returns:** `{ ok, newReward, allFailed }`

**Note on all-teams-failed:** If every team in the game has now failed this challenge, it is removed from play and `_drawChallenges` is called — which draws 1 or 2 new challenges depending on how many are currently active relative to the cap.

**Fails when:**
- Challenge is not `active`
- Game is not `active`
- Another team is currently attempting this challenge

---

### `POST /api/rr/challenge/:challengeId/approve` — Approve a challenge *(host only)*
Confirm a `pending_approval` completion. Coins are awarded to the submitting team and a new challenge is drawn.

**Returns:** `{ ok, coinsAwarded }`

**Fails when:**
- Challenge is not `pending_approval`
- Not the host

---

### `POST /api/rr/challenge/:challengeId/reject` — Reject a challenge *(host only)*
Send a `pending_approval` challenge back to `active`. The team that submitted it can try again.

**Body:** `{ "reason": "..." }` *(optional)*

**Fails when:**
- Challenge is not `pending_approval`
- Not the host

---

### `POST /api/rr/challenge/:challengeId/impossible` — Mark impossible *(host only)*
Remove a broken or unachievable challenge from play. Clears it from its station and draws a replacement.

**Fails when:**
- Not the host
- Game is not `active`

---

### `GET /api/rr/game/:gameId/challenges/pending` — List pending approvals *(host only)*
Returns all challenges currently awaiting host approval.

**Fails when:**
- Not the host

---

## 7. Location

### `PATCH /api/rr/team/:teamId/location` — Update team GPS location
Updates the team's current position on the map. Rate-limited to one update per 8 seconds per team. The update is broadcast to all clients via PocketBase's native SSE on the `teams` collection.

**Body:** `{ "lat": -37.81, "lng": 144.96 }`

**Returns:** `{ ok }` or HTTP 429 if rate-limited (not an error — just skip and try again)

**Fails when:**
- `lat` or `lng` are not valid numbers
- `lat` is outside −90 to 90
- `lng` is outside −180 to 180
- Caller is not an approved member of the team

---

## Common Patterns

**"game is not active"** — Nearly every in-game action checks this. If a player gets this error, the game hasn't started yet (still in lobby) or has already ended.

**"you are not an approved member of this team"** — The caller's user account must have an approved `team_member` record for the specified team. This is the primary auth gate for all game actions.

**"team does not belong to this game"** — The teamId passed in the body doesn't match the game the station/challenge belongs to. Usually a client bug (stale state).

**"insufficient coins"** — The team's current `coin_balance` is less than the coins required for the action.
