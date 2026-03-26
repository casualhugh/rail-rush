# Rail Rush — Full Todo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve all outstanding bugs and implement all features from todo.md (10 items).

**Architecture:** PocketBase JS hooks in `backend/pb_hooks/`, React + TypeScript SPA in `frontend/src/`, PocketBase SQLite with migrations in `backend/pb_migrations/`. MapLibre GL for maps, Zustand for state.

**Tech Stack:** PocketBase (goja JS engine), React 18, TypeScript, Vite, Zustand, MapLibre GL, react-router-dom.

---

## Assumptions & Design Decisions

The following decisions were made without confirmation — flag anything that conflicts with intent:

1. **Bugs 1 & 2 (challenge complete/fail errors):** The error path `backend/pb.js` is PocketBase's internal identifier for the compiled hooks bundle. The root cause is that `_completeChallengeAndDraw` and `_clearChallengeFromStation` are not in scope when the route handlers run — goja's module loading loses the binding. Fix: move helpers into `shared.js` and export them properly. This is how we resolved it for other shared functions.

2. **Events on refresh:** Fetch the 50 most recent events from PocketBase's `events` collection on GameMap init and seed the store. SSE then handles live updates as before.

3. **Reward scaling (item 4):** Count-based bonus. When a challenge is completed, award `floor(coinReward × min(completedCount × 0.05, 2.0))` bonus coins where `completedCount` is the number of challenges already completed in the game (max +200%). No schema change needed — computed at completion time.

4. **Challenge gating (item 6):** A team must explicitly "claim" a challenge before seeing its details or acting on it. A team can only claim one challenge at a time. `attempting_team_id` field added to `challenges` table. When a challenge is completed it is removed from the board. No other team can claim it until that team either fails it or completes it.

5. **Fail escalation (item 7):** On fail, challenge stays at the station with `coinReward` increased by 25% (rounded up). Failing team is added to `failed_team_ids` (new JSON field) and cannot reclaim. If all game teams have failed, the challenge is cleared and new ones drawn.

6. **Mark impossible (item 8):** New `impossible` status in challenges. Host-only endpoint clears the challenge from its station and draws a single replacement.

7. **OSM polygon tool (item 10):** Custom polygon drawing (no extra library). User clicks to place polygon vertices, then closes the shape. On close, query the OSM Overpass API with the polygon boundary and display selectable station pins. A backend proxy endpoint caches the result in `osm_station_cache`.

---

## File Map

| File | Change |
|---|---|
| `backend/pb_hooks/shared.js` | Export helper functions from challenges |
| `backend/pb_hooks/challenges.pb.js` | Require helpers; claim, fail, impossible endpoints |
| `backend/pb_hooks/lobby.pb.js` | Auto-approve host on join |
| `backend/pb_hooks/osm.pb.js` | New — OSM proxy/cache |
| `backend/pb_migrations/8_challenge_gating.pb.js` | New — attempting_team_id, failed_team_ids, fail_count, impossible status |
| `frontend/src/store/gameStore.ts` | Add attemptingTeamId to Challenge; add setEventFeed |
| `frontend/src/pages/GameMap.tsx` | Load events on init |
| `frontend/src/pages/HostSetup.tsx` | Polygon draw mode + OSM station import |
| `frontend/src/components/ChallengeModal.tsx` | Claim button; impossible button for host |

---

## Task Index

| # | File | Description |
|---|---|---|
| 1 | [task-01-fix-challenge-helpers.md](task-01-fix-challenge-helpers.md) | Fix challenge complete/fail ReferenceError |
| 2 | [task-02-fix-events-feed.md](task-02-fix-events-feed.md) | Fix events feed disappearing on refresh |
| 3 | [task-03-host-auto-approve.md](task-03-host-auto-approve.md) | Host auto-approved onto their own team |
| 4 | [task-04-challenge-gating-migration.md](task-04-challenge-gating-migration.md) | Challenge gating migration (schema) |
| 5 | [task-05-challenge-claim-endpoint.md](task-05-challenge-claim-endpoint.md) | Challenge claim endpoint (backend gating logic) |
| 6 | [task-06-fail-escalation.md](task-06-fail-escalation.md) | Fail escalation logic |
| 7 | [task-07-mark-impossible.md](task-07-mark-impossible.md) | "Mark impossible" host-only endpoint |
| 8 | [task-08-frontend-challenge-fields.md](task-08-frontend-challenge-fields.md) | Update frontend store for new Challenge fields |
| 9 | [task-09-challenge-ui-gating.md](task-09-challenge-ui-gating.md) | Challenge UI gating (frontend) |
| 10 | [task-10-osm-polygon-tool.md](task-10-osm-polygon-tool.md) | OSM polygon station import in HostSetup |

---

## Final Verification Checklist

After all tasks are complete, verify each todo item:

- [ ] `Mark challenge complete` — no ReferenceError, coins awarded correctly
- [ ] `Mark failed` — no ReferenceError, challenge stays active with escalated reward
- [ ] Events feed present after page refresh
- [ ] Challenge reward increases as more challenges are completed during the game
- [ ] Host is auto-approved when joining a team in lobby
- [ ] Challenge badge shows "Claim" screen; only attempting team can complete/fail
- [ ] Fail logic escalates reward, blocks team, clears when all teams failed
- [ ] Host sees "Mark Impossible" button in challenge modal
- [ ] OSM polygon tool imports railway stations in HostSetup
