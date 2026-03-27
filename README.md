# Rail Rush — Local Development

Two processes to run: the PocketBase backend and the Vite dev server.

---

## Prerequisites

- **Node.js** 18+ (for the frontend)
- Nothing else — PocketBase is a single binary included at `backend/pocketbase.exe`

---

## 1. Start the backend

```bash
cd backend
./pocketbase.exe serve
```

PocketBase will start at **http://127.0.0.1:8090**.

First run only, open the admin UI and complete the setup:

1. Go to **http://127.0.0.1:8090/_/**
2. Create an admin account when prompted
3. The migration file at `pb_migrations/1_initial_schema.pb.js` runs automatically — all collections are created for you

---

## 2. Start the frontend

In a separate terminal:

```bash
cd frontend
npm install       # first time only
npm run dev
```

The app will be available at **http://localhost:5173**.

The frontend is pre-configured to talk to `http://127.0.0.1:8090` by default. To change this, create `frontend/.env.local`:

```
VITE_PB_URL=http://127.0.0.1:8090
```

---

## Playing a game (quick walkthrough)

1. **Create accounts** — open two browser tabs or use two browsers. Sign up on the Landing page in each.

2. **Host creates a game** — in one tab, go to Dashboard → Create Game, then work through the 5-step wizard:
   - Name the game
   - Tap the map to place station pins (Nominatim auto-fills names)
   - Set rules (coins, toll cost, etc.)
   - Add challenges (optional)
   - Name your teams and pick colours

3. **Players join** — from Dashboard, enter the single invite code shown at the end of setup (one code per game). Players then select which team they want to join.

4. **Host approves players** — in the Lobby, the host approves join requests. Once ≥2 teams each have an approved member, the **Start Game** button unlocks.

5. **Play** — tap stations on the map to claim, contest, or pay toll. Tap challenge badges to complete or fail challenges.

6. **End the game** — host taps **End Game** → all players see the scoreboard simultaneously.

---

## Project structure

```
rail-rush/
├── backend/
│   ├── pocketbase.exe          # PocketBase binary (Windows)
│   ├── pb_hooks/               # Game logic (JS hooks, run by PocketBase)
│   │   ├── shared.js           # writeEvent(), _drawChallenges(), shared helpers
│   │   ├── game.pb.js          # Create / start / end game
│   │   ├── lobby.pb.js         # Join / leave / approve / deny
│   │   ├── stations.pb.js      # Claim / contest / toll / reinforce
│   │   ├── challenges.pb.js    # Claim / complete / fail / approve / reject / impossible
│   │   ├── location.pb.js      # Rate-limited GPS updates
│   │   ├── osm.pb.js           # Overpass API proxy for station discovery
│   │   └── cleanup.pb.js       # Cron job: purge old ended games
│   └── pb_migrations/
│       ├── 1_initial_schema.pb.js   # Creates all collections on first run
│       └── 2_*.pb.js … 13_*.pb.js  # Incremental schema changes (run automatically)
│
└── frontend/
    └── src/
        ├── lib/
        │   ├── pb.ts           # PocketBase client singleton + fetch helpers
        │   ├── api.ts          # Typed wrappers for all /api/rr/* endpoints
        │   └── subscribe.ts    # SSE subscription manager
        ├── store/
        │   └── gameStore.ts    # Zustand store — game state + real-time handlers
        ├── pages/
        │   ├── Landing.tsx     # Auth (sign in / sign up)
        │   ├── Dashboard.tsx   # Game list + join by code
        │   ├── HostSetup.tsx   # 5-step game creation wizard
        │   ├── Lobby.tsx       # Host approve/deny + player waiting room
        │   ├── GameMap.tsx     # Main game screen (MapLibre map)
        │   └── EndScreen.tsx   # Final scoreboard
        └── components/
            ├── StationModal.tsx    # Claim / contest / toll action sheet
            ├── ChallengeModal.tsx  # Complete / fail / approve challenge
            ├── EventFeed.tsx       # Real-time event drawer
            ├── CoinHUD.tsx         # Coin balance overlay
            └── ScorePanel.tsx      # Live score strip
```

---

## API endpoints (PocketBase hooks)

All custom routes are under `/api/rr/` and require a Bearer token.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/rr/game` | Create a new game |
| POST | `/api/rr/game/:id/start` | Start the game (host only) |
| POST | `/api/rr/game/:id/end` | End the game (host only) |
| GET  | `/api/rr/game/:id` | Full game state |
| POST | `/api/rr/game/:id/join` | Join a specific team (body: `{ teamId }`) |
| POST | `/api/rr/game/:id/leave` | Leave your team (lobby only) |
| POST | `/api/rr/game/:id/approve/:memberId` | Approve a player (host) |
| POST | `/api/rr/game/:id/deny/:memberId` | Deny a player (host) |
| POST | `/api/rr/game/:id/stations` | Save station list (lobby only) |
| POST | `/api/rr/game/:id/challenges` | Save challenge list (lobby only) |
| GET  | `/api/rr/game/:id/challenges/pending` | List challenges awaiting approval (host) |
| POST | `/api/rr/station/:id/claim` | Claim an unclaimed station |
| POST | `/api/rr/station/:id/contest` | Contest an enemy station |
| POST | `/api/rr/station/:id/toll` | Pay toll to pass through |
| POST | `/api/rr/station/:id/reinforce` | Add coins to your station's stake |
| GET  | `/api/rr/station/:id/ceiling` | Get current stake and reinforce ceiling (owner only) |
| POST | `/api/rr/challenge/:id/claim` | Claim a challenge to attempt (sets attempting team) |
| POST | `/api/rr/challenge/:id/complete` | Submit challenge as complete |
| POST | `/api/rr/challenge/:id/fail` | Mark challenge failed (escalates reward +25%) |
| POST | `/api/rr/challenge/:id/impossible` | Mark challenge impossible and redraw (host) |
| POST | `/api/rr/challenge/:id/approve` | Approve completion (host) |
| POST | `/api/rr/challenge/:id/reject` | Reject completion, challenge returns to active (host) |
| PATCH | `/api/rr/team/:id/location` | Update GPS location (rate-limited: 1/8s per team) |
| POST | `/api/rr/osm/stations` | Fetch OSM stations within a polygon (body: `{ polygon }`) |
