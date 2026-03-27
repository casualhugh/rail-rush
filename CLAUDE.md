# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

**Backend:**
```bash
cd backend && ./pocketbase.exe serve
# Runs PocketBase at http://127.0.0.1:8090
# Admin panel: http://127.0.0.1:8090/_/
```

**Frontend:**
```bash
cd frontend
npm run dev       # Vite dev server on port 5173
npm run build     # TypeScript check + Vite production build → dist/
npm run preview   # Preview production build
```

There is no test suite. TypeScript is the primary correctness check (`npm run build` runs `tsc -b`).

## Architecture Overview

Rail Rush is a real-time multiplayer geolocation game (think: capture stations on a map). Players walk to physical locations to claim them using coins — teams contest each other's claims, pay tolls, and complete challenges.

**Stack:** React + TypeScript frontend (Vite), PocketBase backend (Go binary with JS hooks), SQLite database, MapLibre GL maps, Zustand state, SSE for real-time.

### Backend: PocketBase Hooks (`backend/pb_hooks/`)

All game logic runs as JavaScript inside PocketBase's JSVM. Hooks register custom REST endpoints under `/api/rr/`:

| File | Responsibility |
|------|---------------|
| `shared.js` | `writeEvent()`, `_drawChallenges()`, shared helpers used by all hooks |
| `game.pb.js` | Create game, start, end — orchestrates all collections |
| `stations.pb.js` | Claim, contest, toll, reinforce — coin transfer logic lives here |
| `challenges.pb.js` | Claim, complete, fail, approve, reject, impossible — full challenge lifecycle |
| `lobby.pb.js` | Join/leave game, host approve/deny players |
| `location.pb.js` | GPS updates (rate-limited: 1 update per 8s per team) |
| `cleanup.pb.js` | Cron job to purge old games and orphaned records |
| `osm.pb.js` | Overpass API proxy for station discovery (with mirror fallback) |

Schema is defined in `pb_migrations/1_initial_schema.pb.js` (the initial migration creates all collections). Migrations 2–13 layer on top — they run automatically on startup.

**Key collections:** `games`, `teams`, `team_members`, `stations`, `station_claims`, `challenges`, `events`, `challenge_bank`, `toll_payments`, `map_templates`, `osm_station_cache`

### Frontend: Pages + Zustand + SSE (`frontend/src/`)

**Routing** (`App.tsx`): Auth-gated. Unauthenticated users → `/` (Landing). Authenticated users → `/dashboard`, `/host-setup`, `/lobby/:gameId`, `/game/:gameId`, `/end/:gameId`.

**Game state** (`store/gameStore.ts`): Single Zustand store holds all in-game data. Two operation modes:
- Bulk setters (`setGame`, `setTeams`, etc.) — called on initial load
- Real-time handlers (`handleEvent`, `updateTeam`, `updateStation`, etc.) — called by SSE subscriptions

**SSE subscriptions** (`lib/subscribe.ts`): Subscribes to 5 collections simultaneously (`events`, `teams`, `stations`, `challenges`, `team_members`). Auto-reconnects on disconnect; a "Reconnecting…" banner appears in `GameMap.tsx` during outage. SSE data flows into the Zustand store handlers.

**API layer** (`lib/api.ts` + `lib/pb.ts`): `pb.ts` exports a PocketBase singleton and typed `api.get/post/patch/delete` helpers. `api.ts` wraps every `/api/rr/*` endpoint in typed functions.

### Game Lifecycle

1. **Host creates** (HostSetup.tsx, 5-step wizard) → `POST /api/rr/game` → creates game + teams + stations + challenges
2. **Players join** (Dashboard.tsx) → `POST /api/rr/game/:id/join` → creates `team_member` record
3. **Host approves & starts** (Lobby.tsx) → `POST /api/rr/game/:id/start` → transitions to `active`, draws initial challenges
4. **Active game** (GameMap.tsx) → station/challenge actions via REST, real-time updates via SSE
5. **Game ends** (host clicks End) → `POST /api/rr/game/:id/end` → final scores emitted as `game_ended` event → EndScreen.tsx

### Station Mechanics

- **Claim:** First team stakes coins on unclaimed station (`coins ≤ maxStakeIncrement`)
- **Contest:** Another team bids higher to take ownership (new bid must be `current_stake < bid ≤ current_stake + maxStakeIncrement`)
- **Reinforce:** Owner adds coins to their own station's stake
- **Toll:** Passing team pays `toll_cost` coins to the owning team (can be partial)

### Challenge Mechanics

Status flow: `undrawn` → `active` → `pending_approval` → `completed` | `failed` | `impossible`

Teams must first **claim** a challenge (`attempting_team_id` is set) before completing or failing it. Only the claiming team can then act on it. If a team fails, the reward escalates by +25% and they are blocked from re-attempting until another team tries. If all teams fail, the challenge is discarded and redrawn.

`_drawChallenges()` in `shared.js` maintains a pool of active challenges (controlled by `max_active_challenges` on the game). Draws 2 challenges at a time when under the cap, 1 when at cap. Challenge rewards include a completion bonus: +5% per previously completed challenge in the game (capped at +200%). The API response from `/complete` and `/approve` returns the actual bonus-adjusted amount via `coinsAwarded`.

## Environment

Frontend reads `VITE_PB_URL` from `frontend/.env.local` (defaults to `http://127.0.0.1:8090`). The PocketBase binary is `backend/pocketbase.exe` (Windows). `pb_data/` (SQLite + uploaded files) is gitignored.

## Known Limitations

- API visibility: any authenticated user can read all game/team/member records — no row-level security yet
- `team_members` has no `game_id` field, so the SSE subscription covers all games. The frontend store filters out foreign team_members by checking if the `team_id` belongs to a known team in the current game, but the raw SSE events still arrive for all games
- Completed/failed challenges accumulate in Zustand state; components must filter by status themselves
