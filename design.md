# Rail Rush — Design Document v0.4
### A Real-World Train Station Claiming Game
*Updated: station passing rules revised — toll system added.*

---

## 1. Overview

**Rail Rush** is a real-world, team-based strategy game inspired by the Jet Lag YouTube series. Teams physically travel between train or tram stations in a city, claiming stations by placing coins. Claimed stations create a living, contested map — teams must outmanoeuvre opponents to expand their territory. The game is orchestrated through a live webapp that all players have open on their phones.

**Core Fantasy:** You're a rival rail syndicate competing to dominate a city's transit network. Every station you claim is territory. Every coin you drop is a bet. Every station you hold prints money.

---

## 2. Game Rules

### 2.1 Stations & Claiming

- The playable map is a set of real train/tram stations configured by the host before the game, or copied from a published community map template.
- When a team physically arrives at a station, they interact with it based on its current ownership state.

**A station can be interacted with in the following ways:**

| Station state | Options |
|---|---|
| **Unclaimed** | Claim it — place 1–5 coins (locked into station, team gains ownership) |
| **Owned by your team** | Free passage — no action required |
| **Owned by another team** | **Option 1:** Contest & claim — outbid the current stake (see below). **Option 2:** Pay a toll — pay the toll cost directly to the owning team and pass through without claiming. |

**Contesting (Option 1):**
- Place coins equal to current stake + 1, up to a maximum of current stake + 5.
- Ownership transfers immediately. New stake is locked into the station. Neither team recovers spent coins.

**Toll (Option 2):**
- Pay the **toll cost** (host-configured, default 3 coins) directly to the owning team's coin balance.
- No ownership change. The passing team simply moves through.
- Toll coins are **not** locked into the station — they go straight to the owning team. Territorial teams can generate passive income from busy routes.
- **If the passing team cannot afford the full toll:** they pay their entire remaining coin balance (even if zero) and still pass through. They cannot be completely stranded.
- The minimum effective toll is therefore **0 coins** (a team already at zero still passes).

**Cannot pass at all:**
- A team cannot pass through an enemy station without taking one of the two options above. They cannot physically bypass a claimed station to reach one on the other side — this is enforced on the honour system.

### 2.2 Coins & Economy

- All teams start with the same coin pool (host configures; suggested 20–30 coins, scaled to map size).
- **No maximum coin balance** per team.
- **Stake cap per station:** maximum stake when contesting is always current stake + 5.
- Coins placed as a stake are **permanently locked in** — no withdrawal.
- Toll coins **transfer directly** between teams — they are never locked in and do not affect the station's stake.
- The only way to recover coins is through challenge completion or receiving tolls.

### 2.3 Challenges

- At game start, **3 challenges** are drawn from the active pool and assigned to random stations on the map.
- When any team completes a challenge:
  - The challenge is removed from the map.
  - If fewer than **10 active challenges** are on the map → **2 new challenges** are drawn.
  - If exactly **10 active challenges** are on the map → **1 new challenge** is drawn.
- Coin reward per challenge is set by the host per challenge (bank challenges have a suggested reward; host can override).
- Challenges come from two sources:
  - **Built-in challenge bank** — generic, reusable, playable anywhere. Host ticks which ones are active for their game. Bank challenges are read-only; hosts can **Duplicate** any bank challenge to create an editable copy pre-filled with the original.
  - **Host-authored** — written from scratch. Can optionally be **pinned to a specific station**.

#### Challenge Completion Flow

**If "Require Host Approval" is OFF (honour system):**
- Any team member taps "Mark Complete" → coins instantly awarded → challenge removed from map.

**If "Require Host Approval" is ON:**
- Team taps "Mark Complete" → challenge enters `pending_approval`.
- Card shows: *"Waiting for host approval…"*
- Reminder shown: *"📹 Send your video to the group chat before submitting."*
- Host reviews video on external channel → taps **Approve** or **Reject** (optional rejection note).
- Coins awarded only on approval.

**Mark Failed:** Team taps "Mark Failed" if they attempt and cannot complete. Challenge stays on the map. No coins change hands.

### 2.4 Visibility

- All teams can see every other team's **real-time GPS location** on the map (foreground only — no background tracking).
- Station ownership and coin stakes are **fully public**.
- Challenge locations and descriptions are **fully public**.
- Toll transactions are **fully public** (visible in event feed).
- Pending approval submissions are **visible to host only**.

### 2.5 Winning

- The host controls the game end. They set an expected end time at setup (displayed to all players) but manually trigger the final call.
- **Winner = team with the most stations claimed.**
- Tiebreaker: total coins staked across all currently owned stations.
- Final scores broadcast to all players simultaneously on game end.

---

## 3. Roles

| Role | Permissions |
|---|---|
| **Host** | Creates game, configures map & rules, creates teams, approves joining players (per game), starts/ends game, approves/rejects challenge completions (if enabled), can force-refresh state |
| **Player** | Joins via code / link / QR; approved by host per game; selects team; views map, claims stations, pays tolls, completes/fails challenges |
| **Spectator** | View-only — same map view as players but no action buttons; must be approved by host; sees all team locations |

---

## 4. Game Lifecycle

```
Host creates game
  → Names the game, sets expected end time
  → Configures map (polygon auto-import OR manual pin mode)
  → Sets rules: starting coins, toll cost, stake increment cap,
                challenge reward defaults, host approval toggle
  → Builds challenge list (bank + authored, optionally pin to stations)
  → Creates team names + colours
  → Opens lobby → share code / link / QR generated

Players join
  → Enter code, scan QR, or tap link
  → Host sees join request → Approve or Deny (per game, every time)
  → Approved player selects which team they are joining

Host starts game
  → 3 challenges auto-drawn from active pool → placed on random stations
  → All players and spectators see the live map simultaneously

Game in progress
  → Players physically travel between stations
  → Arrive at station → tap to claim, contest, or pay toll
  → Arrive at challenge station → attempt challenge → Mark Complete or Mark Failed
  → If approval required: host reviews via external video → approves or rejects in app
  → Map updates in real time for all connected clients

Host ends game
  → Taps "End Game" → confirmation dialog → game state locked
  → Full-screen scoreboard shown to all players and spectators
  → Session archived — viewable post-game by all participants
```

---

## 5. Tech Stack

### 5.1 Philosophy
Cheap. Simple. Self-hostable. One binary, one SQLite database, minimal moving parts. Mobile-first frontend.

### 5.2 Frontend
- **React + Vite** — SPA, PWA-ready
- **MapLibre GL JS** — free, open-source, no API key required
- **Map tile providers (priority order):**
  1. [OpenFreeMap](https://openfreemap.org/) — fully free, no key, self-hostable
  2. [Stadia Maps](https://stadiamaps.com/) — generous free tier, no credit card for low volume
  3. Raw OpenStreetMap raster tiles — fallback
- **Zustand** — global client state
- **PocketBase JS SDK** — auth, REST, real-time SSE subscriptions
- **Deployed via AWS Amplify Hosting** — connects to GitHub, auto-deploys on push, HTTPS + CDN included. Used as a dumb static host only — no Amplify Auth, no Amplify backend features.

### 5.3 Backend
**PocketBase** — local binary during development, AWS EC2 t4g.micro in production
- Single Go binary, SQLite built-in, admin dashboard at `/pb/_/` (local: `http://127.0.0.1:8090/_/`)
- Auth: email/password + Google OAuth2
- Real-time: SSE subscriptions — no separate WebSocket server
- Custom game logic + atomic transactions via **PocketBase JS hooks** (`pb_hooks/*.pb.js`)
- Overpass API results cached in `osm_station_cache` collection (TTL 7 days)
- Reverse proxy (production only): **Caddy** (systemd service, auto HTTPS via Let's Encrypt)

### 5.4 Infrastructure Summary

| Component | Service | Est. Cost |
|---|---|---|
| Frontend hosting | AWS Amplify Hosting | Free tier / ~$0–1/mo |
| Backend compute | AWS EC2 t4g.micro | Free tier 12mo / ~$6/mo after |
| Database | SQLite (on EC2 disk) | $0 |
| HTTPS / reverse proxy | Caddy on EC2 | $0 |
| Domain | Namecheap or Route 53 | ~$10/yr |
| Map tiles | OpenFreeMap / Stadia free tier | $0 |
| **Total (after free tier)** | | **~$7–8/mo** |

---

## 6. Data Models

### Users *(PocketBase built-in auth collection)*
```
id, email, name, avatar_url, created_at
```

### Game
```
id
host_user_id            → users.id
name                    string
status                  enum: lobby | active | ended
city_name               string
map_bounds              JSON (GeoJSON polygon, nullable)
starting_coins          int
max_stake_increment     int      (default: 5)
toll_cost               int      (default: 3, host-configurable)
max_active_challenges   int      (default: 10)
require_host_approval   bool     (default: false)
spectators_allowed      bool     (default: true)
expected_end_time       datetime
created_at              datetime
started_at              datetime (nullable)
ended_at                datetime (nullable)
```

### Station
```
id
game_id                 → games.id
map_template_id         → map_templates.id (nullable)
name                    string
lat                     float
lng                     float
current_owner_team_id   → teams.id (nullable)
current_stake           int      (default: 0)  — denormalised cache of latest claim
is_challenge_location   bool     (default: false)
active_challenge_id     → challenges.id (nullable)
```

### StationClaim *(full ownership history)*
```
id
station_id              → stations.id
game_id                 → games.id
team_id                 → teams.id
coins_placed            int
action                  enum: initial_claim | contest_win
claimed_at              datetime
```
> `Station.current_stake` is the running total of all coins staked by the current owner (initial claim + any reinforcements). It is not a direct copy of any single `StationClaim.coins_placed` — `reinforce` rows record only the increment placed in that action.
> Tolls do NOT write a `StationClaim` row — ownership does not change. They write an `Event` only.

### TollPayment *(toll transaction record)*
```
id
game_id                 → games.id
station_id              → stations.id
paying_team_id          → teams.id
receiving_team_id       → teams.id
coins_requested         int      (the configured toll cost at time of payment)
coins_paid              int      (actual amount paid — may be less if team is short)
was_partial             bool     (true if coins_paid < coins_requested)
paid_at                 datetime
```
> Toll payments are **atomic transactions** on the backend: debit `paying_team.coin_balance`,
> credit `receiving_team.coin_balance`, write `TollPayment`, write `Event` — all in one operation.
> A separate table (rather than just an Event) preserves the financial audit trail cleanly.

### Team
```
id
game_id                 → games.id
name                    string
color                   string   (hex, e.g. "#1A6B6B")
coin_balance            int
invite_code             string   (unique per game)
current_lat             float    (nullable)
current_lng             float    (nullable)
location_updated_at     datetime (nullable)
```

### TeamMember
```
id
team_id                 → teams.id
user_id                 → users.id
role                    enum: captain | member
approved_by_host        bool     (default: false)
joined_at               datetime
```

### Challenge
```
id
game_id                 → games.id
station_id              → stations.id (nullable — if pinned)
description             string
coin_reward             int
difficulty              enum: easy | medium | hard
source                  enum: bank | host_authored | bank_duplicate
bank_source_id          → challenge_bank.id (nullable)
status                  enum: undrawn | active | pending_approval | completed | failed
completed_by_team_id    → teams.id (nullable)
submitted_at            datetime (nullable)
completed_at            datetime (nullable)
rejected_reason         string   (nullable)
```

### ChallengeBank
```
id
description             string
difficulty              enum: easy | medium | hard
tags                    JSON array  ["physical", "social", "observation", "creative", "food", "transport"]
suggested_reward        int
created_by              string   ("system" or users.id)
is_public               bool
```

### MapTemplate
```
id
created_by_user_id      → users.id
name                    string
city_name               string
map_bounds              JSON (GeoJSON polygon)
stations                JSON (array of {name, lat, lng})
station_count           int
is_public               bool     (default: false)
approval_status         enum: pending | approved | rejected
approved_by             string   (nullable)
approved_at             datetime (nullable)
times_used              int
created_at              datetime
```

### OsmStationCache
```
id
bbox_hash               string   (unique — SHA256 of rounded bbox)
bbox_geojson            JSON
stations_json           JSON
fetched_at              datetime
```

### Event *(real-time feed + immutable audit log)*
```
id
game_id                 → games.id
type                    enum: claim | contest | toll_paid |
                               challenge_submitted | challenge_approved |
                               challenge_rejected | challenge_drawn |
                               challenge_failed | player_joined |
                               game_started | game_ended
team_id                 → teams.id (nullable — the acting team)
secondary_team_id       → teams.id (nullable — the receiving team, e.g. toll recipient)
station_id              → stations.id (nullable)
challenge_id            → challenges.id (nullable)
coins_involved          int      (nullable)
was_partial             bool     (nullable — for toll_paid events only)
created_at              datetime
```

### SpectatorAccess
```
id
game_id                 → games.id
user_id                 → users.id (nullable)
share_token             string   (unique)
approved                bool     (default: false)
approved_at             datetime (nullable)
```

---

## 7. Real-Time Events

All clients subscribe to a game-scoped SSE channel via PocketBase.

| Event | Key Payload Fields | Audience |
|---|---|---|
| `station_claimed` | station_id, team_id, coins_staked | All |
| `station_contested` | station_id, new_owner_team_id, new_stake, prev_team_id | All |
| `toll_paid` | station_id, paying_team_id, receiving_team_id, coins_paid, was_partial | All |
| `challenge_submitted` | challenge_id, team_id | Host only |
| `challenge_approved` | challenge_id, team_id, coins_awarded | All |
| `challenge_rejected` | challenge_id, team_id, rejected_reason | Submitting team + host |
| `challenge_drawn` | challenge object, station_id | All |
| `challenge_failed` | challenge_id, team_id | All |
| `team_location_updated` | team_id, lat, lng | All |
| `player_joined` | user_id, team_id | Host |
| `game_started` | — | All |
| `game_ended` | final_scores array | All |

**Location update throttle:** client sends position every 10 seconds max. Server rejects updates more frequent than 8 seconds per team.

**Event feed display for `toll_paid`:**
- Normal toll: *"🚃 [Team Blue] paid [Team Orange] 3 coins to pass through Central Station"*
- Partial toll: *"🚃 [Team Blue] paid [Team Orange] 1 coin (all they had) to pass through Central Station"*

---

## 8. Map Configuration (Host Setup)

### Mode A — Polygon Auto-Import
1. Host draws a polygon on the map
2. Backend checks `OsmStationCache` → on miss or stale (>7 days), queries Overpass API for `railway=station`, `railway=tram_stop`, `amenity=ferry_terminal` within bounds
3. Station list returned as pins + sidebar list
4. Host uses "Select All" or taps individual stations to include/exclude
5. Confirmed stations saved to Game

### Mode B — Manual Pinning
1. Host taps map to place a custom pin anywhere
2. Name auto-filled from Nominatim reverse geocode (free); host can override
3. Full control — useful for non-standard routes, landmarks, pub crawls

### Community Map Templates
- Host can submit saved map as a public template (name + city tag required)
- Approval gate: ≥5 stations + submitting user has completed a real multiplayer game + manual admin approval
- Approved templates appear in "Browse Maps" on the Create Game screen
- Host selecting a template receives a **full independent copy** — editable before starting

---

## 9. Visual Design Language

### 9.1 Aesthetic Direction
**"Adventure Cartography meets Transit Ops."**

A field commander's tactical map crossed with a board game brought to life. Bold shapes, warm paper tones, illustrated icons, animated tokens, chain-link paths. The map is deliberately muted — it serves as a canvas. The game layer owns the visual hierarchy.

### 9.2 Colour Palette
```
Map canvas filter:    sepia(10%) saturate(80%) brightness(95%)
UI surfaces:          #F5EFE0   warm off-white (aged paper)
Primary / your team:  #1A6B6B   deep teal
Enemy / contested:    #E8622A   burnt orange
Coin / reward:        #F0AC2B   amber
Unclaimed station:    #FFFFFF   white fill, animated dashed dark border
Text primary:         #1C1C1C   near-black
Text secondary:       #8A7F72   warm grey
Danger / reject:      #C0392B   deep red
Toll indicator:       #F0AC2B   amber (coins transferring = gold)
```

No purple. No gradients. No flat white cards. No Inter, Roboto, or Arial.

### 9.3 Typography
| Role | Font |
|---|---|
| Display, hero numbers, station names | **Fraunces** (variable) — Google Fonts |
| UI labels, body, buttons, forms | **DM Sans** — Google Fonts |
| Event feed, timestamps, coin counts in log | **JetBrains Mono** — Google Fonts |

### 9.4 Map Layer Design
- Base tiles: OpenFreeMap vector tiles, CSS-filtered to warm muted tone
- **Station nodes:** 20–24px filled circles. Colour = owning team hex. Unclaimed = white with animated dashed border
- **Paths between stations:** chain-link SVG overlay in MapLibre as a GeoJSON line layer. Colour = owner's team hex. Unclaimed = `#8A7F72` grey dashes
- **Challenge badge:** amber inverted triangle (▽) bottom-right of station node, coin reward inside
- **Team location pins:** circular avatar bubbles with thick team-coloured border ring, smooth GPS interpolation

### 9.5 UI Components

**Station action modal** *(updated for toll)*

Bottom sheet slides up from map tap. Three distinct CTA states depending on context:

*Unclaimed station:*
- "Claim — place [1–5] coins" (coin slider)

*Enemy-owned station:*
- **Primary CTA:** "Contest & Claim — costs [stake+1] to [stake+5] coins" (slider, stake locked in)
- **Secondary CTA:** "Pay Toll — [N] coins → [Team Name]" (amber, transfers to owner)
- If team balance < toll cost, secondary CTA reads: "Pay Toll — [balance] coins (all you have) → [Team Name]"
- Both options clearly labelled with what happens to the coins: *"Stake locked in"* vs *"Goes to [Team]"*

*Your station:*
- "You own this station" (greyed, no action)

The distinction between "stake locked in" and "goes to their team" is surfaced explicitly in the UI so players understand the economy implication of each choice.

**Coin counter HUD**
- Top-left of map screen. Amber circle with coin icon + Fraunces numeral
- On coin gain (challenge reward OR received toll): +N amber text floats upward, counter bounces
- On toll payment: -N red text floats downward, counter drops

**Challenge modal** — unchanged from v0.3

**Event feed drawer**
- `toll_paid` row: 🚃 icon, team-colour border of paying team, description as above
- Partial toll displayed in warm grey italic to distinguish it visually

**Score panel strip** — unchanged from v0.3

### 9.6 Animations & Motion

| Trigger | Animation |
|---|---|
| Station claimed (your team) | Coin drops, bounces on node, fills colour, 🎆 fireworks |
| Station claimed (enemy) | Node fills enemy colour |
| Station contested — you win | Pulse ring in loser's colour resolves to yours + 🎆 |
| Station contested — you lose | Pulse ring in your colour + ⚔️ burst |
| Toll paid (you paying) | Coin icon slides from your HUD toward the station, -N red floats down |
| Toll received (your station) | +N amber floats up on your HUD, brief gold shimmer on station node |
| Partial toll paid | Same as toll paid but coin icon is smaller/faded to signal the deficit |
| Challenge drawn | Triangle materialises — pop scale + shimmer |
| Coins earned | +N amber floats up, HUD counter bounces |
| Team location move | Avatar slides smoothly, 800ms ease-in-out |
| All modals / sheets | 200ms ease-out slide |

---

## 10. Screens

*(Unchanged from v0.3 except station modal CTA states above)*

### 10.1 Landing Page
- Full-screen static illustrated map background
- Game title + tagline
- "Sign In to Play" CTA
- "How to Play" — 3 illustrated steps
- Mobile-first

### 10.2 Home / Dashboard *(authenticated)*
- Join a Game (code + QR scan)
- Create a Game CTA
- Active / recent games list

### 10.3 Host Setup Flow *(desktop-optimised)*
1. Game Details — name, expected end time
2. Map Config — Mode A / B; template browser
3. Rules — starting coins, **toll cost** (default 3), stake increment cap, challenge reward, host approval toggle
4. Challenges — bank browser, duplicate, custom, pin to station
5. Teams — names + colour picker
6. Review & Launch — code, QR, share link, Open Lobby

### 10.4 Player Lobby
- Game name, your team, teammate list, map preview, waiting indicator

### 10.5 Main Game Map
- Full-screen MapLibre map
- Top-left: coin counter HUD
- Top-right: event feed toggle + player count
- Map: station nodes, paths, challenge badges, team pins
- Bottom: score panel strip (collapsible)
- Tap station → station modal (claim / contest / toll)
- Tap challenge → challenge modal
- Host: End Game button + challenge approval notifications

### 10.6 End Screen / Scoreboard
- Animated rank reveal
- Station ownership breakdown
- Key event timeline
- Share Results button

---

## 11. Backend Build Order (Phase 1)

```
1. PocketBase binary running locally (./pocketbase serve)
   → Production: EC2 + Caddy + HTTPS (Step 6, last)

2. Collections
   → All tables from Section 6 created in PocketBase admin
   → Google OAuth2 + email auth configured

3. Game management
   → Create game, manual station pinning, team creation, invite codes

4. Lobby
   → Player join request flow
   → Host approve / deny
   → SSE subscription for lobby events

5. Game start
   → Validate ≥2 teams with ≥1 approved member
   → Set game.status = active
   → Auto-draw 3 challenges → assign to random stations
   → Broadcast game_started

6. Core game loop — claiming
   → Claim station endpoint
     (validate coins ≥ 1, write StationClaim, update Station + debit Team)
   → Contest station endpoint
     (validate new stake ≤ current+5, transfer ownership, write StationClaim)
   → Pay toll endpoint — ATOMIC TRANSACTION:
     (debit paying_team.coin_balance by min(toll_cost, balance),
      credit receiving_team.coin_balance,
      write TollPayment, write Event — all in one DB transaction)

7. Challenge flow
   → Mark complete / mark failed
   → Challenge draw logic (2 new / 1 new at cap)
   → Host approval flow (pending → approved/rejected)
   → Coin award on approval

8. Location updates
   → PATCH team location (rate-limited 1/8s per team)

9. Game end
   → Host triggers end → lock state → calculate scores → broadcast game_ended

10. Post-game
    → Scoreboard + event log read endpoints
```

---

## 12. Phased Build Plan

### Phase 1 — MVP Core
- [ ] PocketBase binary running locally (`./pocketbase serve`)
- [ ] All collections created (Section 6)
- [ ] Google OAuth2 + email auth
- [ ] Backend game loop via JS hooks (Section 11 steps 1–10)
- [ ] React frontend: landing page, auth, dashboard
- [ ] Host setup: manual pin mode (Mode B), toll cost configurable
- [ ] Lobby: join by code/QR, host approve/deny
- [ ] Game map: station nodes, claim / contest / toll flow
- [ ] Challenge draw + complete/fail + host approval
- [ ] Real-time sync via PocketBase SSE
- [ ] End game → scoreboard

### Phase 2 — Map & Polish
- [ ] GPS tracking + team avatar pins
- [ ] Mode A: polygon + Overpass API + OsmStationCache
- [ ] Community map templates + approval flow
- [ ] Full design system (typography, textures, chain-link paths)
- [ ] Full animation pass incl. toll animations
- [ ] Event feed drawer with toll_paid entries
- [ ] Station modal toll CTA + coin destination labelling

### Phase 3 — Extras
- [ ] Built-in challenge bank (~30 seeded entries)
- [ ] Spectator mode
- [ ] End screen share image
- [ ] Game replay / timeline
- [ ] PWA manifest + install prompt
- [ ] Web Push notifications

---

## 13. Open Items (Non-Blocking Before Phase 1)

- **Team colour palette:** Define 8 preset colours (teal, orange, purple, red, blue, green, yellow, pink)
- **Challenge bank content:** ~30 entries drafted at Phase 3 start
- **Map template moderation:** Admin tooling in PocketBase for approving/rejecting templates
- **Anti-spam:** Decide if claim/contest/toll actions need a per-team cooldown

---

*Document version 0.4 — toll system added, all Phase 1 rules resolved. Ready for backend implementation.*