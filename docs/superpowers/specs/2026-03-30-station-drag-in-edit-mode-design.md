# Station Drag in Edit Map Mode — Design

**Date:** 2026-03-30
**Status:** Approved

## Problem

The host's in-game "Edit Map" overlay (StationEditorOverlay) lets the host add, delete, and connect stations, but stations cannot be repositioned by dragging. This capability exists in the game creation flow (HostSetup) but was not carried over into the edit mode.

## Solution Overview

Three coordinated changes: a new backend endpoint to persist position changes, a new API wrapper in the frontend, and changes to GameMap to make markers draggable when edit mode is active.

---

## 1. Backend — `PATCH /api/rr/station/{stationId}/move`

**File:** `backend/pb_hooks/stations.pb.js`

- Auth required; caller must be the game's host; game must be `active`.
- Body: `{ lat: number, lng: number }`.
- Validates lat ∈ [-90, 90] and lng ∈ [-180, 180].
- Updates the station record's `lat` and `lng` fields and saves.
- Returns `{ ok: true }`.
- No manual SSE emission needed — PocketBase's realtime subscription on the `stations` collection fires automatically on save, which updates the store and redraws connection lines.

---

## 2. Frontend API wrapper

**File:** `frontend/src/lib/api.ts`

Add:
```ts
export const moveStation = (stationId: string, lat: number, lng: number) =>
  api.patch<{ ok: boolean }>(`/api/rr/station/${stationId}/move`, { lat, lng })
```

---

## 3. GameMap — draggable markers during edit mode

**File:** `frontend/src/pages/GameMap.tsx`

### New refs

```ts
const isEditingMapRef = useRef(false)
const dragHandlerMapRef = useRef<Map<string, () => void>>(new Map())
```

Keep `isEditingMapRef` in sync so closures inside `renderMarkers` can read the current value:
```ts
useEffect(() => { isEditingMapRef.current = isEditingMap }, [isEditingMap])
```

### Marker creation (inside `renderMarkers`)

When creating a new station marker, check `isEditingMapRef.current`. If in edit mode:
- Pass `draggable: true` to the `Marker` constructor.
- Attach a `dragend` handler that calls `moveStation(station.id, lat, lng)` (fire-and-forget; errors are swallowed silently, consistent with the rest of the overlay).
- Store the handler in `dragHandlerMapRef` for later cleanup.

### Toggle effect

```ts
useEffect(() => {
  for (const [stationId, marker] of markerMapRef.current) {
    if (isEditingMap) {
      marker.setDraggable(true)
      if (!dragHandlerMapRef.current.has(stationId)) {
        const handler = () => {
          const { lat, lng } = marker.getLngLat()
          moveStation(stationId, lat, lng).catch(() => {})
        }
        dragHandlerMapRef.current.set(stationId, handler)
        marker.on('dragend', handler)
      }
    } else {
      marker.setDraggable(false)
      const handler = dragHandlerMapRef.current.get(stationId)
      if (handler) {
        marker.off('dragend', handler)
        dragHandlerMapRef.current.delete(stationId)
      }
    }
  }
}, [isEditingMap])
```

This runs whenever edit mode is toggled, catching all markers that already exist. Markers created *while* edit mode is active are handled at creation time (see above).

---

## Data flow on drag

1. User drags a station pin; MapLibre moves the marker visually in real time.
2. `dragend` fires → `moveStation(id, lat, lng)` → `PATCH /api/rr/station/{id}/move`.
3. PocketBase saves the record and emits an SSE event on the `stations` collection.
4. `subscribe.ts` receives the update → `store.updateStation(record)`.
5. Zustand triggers re-render → `useEffect([store.stations])` fires → `renderMarkers` updates the GeoJSON connection-line source with the new coordinates.

Connection lines snap to the dragged position within one SSE round-trip (~50 ms on localhost).

---

## Interaction with Place / Connect modes

Dragging is available in both Place and Connect modes (matching HostSetup behavior). MapLibre suppresses the `click` event when a drag occurs, so:
- **Place mode:** a drag moves the pin; a tap opens the delete popup. No conflict.
- **Connect mode:** a drag moves the pin; a tap selects the station for connection. No conflict.
