# Station Import / Export — Design Spec

**Date:** 2026-04-04

---

## Overview

Add Import and Export buttons to the Step 2 (station placement) toolbar in HostSetup. Hosts can export their station layout as a standard GeoJSON file and import it into future sessions, share it with other hosts, or edit it in external GIS tools (QGIS, geojson.io).

---

## File Format

A single GeoJSON FeatureCollection containing two feature types, distinguished by `properties.railRushType`.

### Station feature
```json
{
  "type": "Feature",
  "id": "pin-1234",
  "geometry": { "type": "Point", "coordinates": [144.963, -37.814] },
  "properties": { "railRushType": "station", "name": "Flinders Street", "osmNodeId": 123456 }
}
```
- `id` (top-level GeoJSON feature id) — the station's `tempId`
- `coordinates` — `[lng, lat]` (GeoJSON convention)
- `properties.name` — display name
- `properties.osmNodeId` — optional; included when present on the `StationPin`, omitted otherwise

### Connection feature
```json
{
  "type": "Feature",
  "geometry": {
    "type": "LineString",
    "coordinates": [[144.963, -37.814], [144.982, -37.809]]
  },
  "properties": { "railRushType": "connection", "from": "pin-1234", "to": "pin-5678" }
}
```
- `properties.from` / `properties.to` — `feature.id` values of the two connected stations as they appear in the same file
- `coordinates` — derived from station positions at export time (for visual rendering in GIS tools)

Connections are undirected — order within a pair has no semantic meaning.

### Full example
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "id": "pin-1234",
      "geometry": { "type": "Point", "coordinates": [144.963, -37.814] },
      "properties": { "railRushType": "station", "name": "Flinders Street" }
    },
    {
      "type": "Feature",
      "id": "pin-5678",
      "geometry": { "type": "Point", "coordinates": [144.982, -37.809] },
      "properties": { "railRushType": "station", "name": "Richmond" }
    },
    {
      "type": "Feature",
      "geometry": {
        "type": "LineString",
        "coordinates": [[144.963, -37.814], [144.982, -37.809]]
      },
      "properties": { "railRushType": "connection", "from": "pin-1234", "to": "pin-5678" }
    }
  ]
}
```

---

## Export

### Trigger
A button labelled "Export" at the right end of the Step 2 map toolbar. Export is a download-only operation; the map camera does not move.

### Enabled state
Disabled when `stations.length === 0`. Import is always enabled.

### Filename
Game name (from Step 1) transformed by these steps in order:

1. Strip all non-ASCII characters (keep only code points 0–127)
2. Lowercase
3. Strip all characters that are not alphanumeric (`a-z`, `0-9`) or space — this includes hyphens already in the name, which is intentional
4. Trim leading/trailing spaces, then replace runs of spaces with `-`
5. Append `-stations.geojson`

The emptiness check is applied after step 4 (after trimming). If the stem is empty, the filename falls back to `stations.geojson`.

Examples:
- `"London Rail Rush!"` → `london-rail-rush-stations.geojson`
- `"   "` → `stations.geojson` (fallback)
- `"東京"` → `stations.geojson` (all non-ASCII, fallback)

### Logic
1. Map each `StationPin` to a GeoJSON Point Feature: `id = tempId`, coordinates `[lng, lat]`, `properties.name`, `properties.osmNodeId` (omit if not present)
2. Map each `[tempIdA, tempIdB]` connection to a GeoJSON LineString Feature: look up coordinates from the station array. Stations can be deleted from the map in Step 2, which can leave stale connection pairs in state. If either `tempId` has no matching station, silently skip that connection in the export
3. Serialize as JSON, trigger browser download via a temporary `<a>` element with a `blob:` URL

Client-side only. No backend changes. No station count limits are applied at export — the game's own submission validation handles caps.

---

## Import

### Trigger
A button labelled "Import" placed to the left of the Export button at the right end of the Step 2 map toolbar. Clicking it programmatically clicks a hidden `<input type="file" accept=".geojson,.json">`. After each import attempt the file input's `value` is reset to `""` so selecting the same file again triggers `onChange`.

### Merge behavior
Imported data is merged into existing state — existing stations and connections are preserved. The map camera never moves on import. No station count limits are enforced during import.

### Logic

**Step 1 — Merge stations**

Treat a missing or non-array `features` field on the FeatureCollection as an empty array.

Silently skip any feature whose `properties.railRushType` is not `"station"` or `"connection"`.

Build `mergedIds: Set<string>` initialised from the current `tempId` set. This set tracks all station ids that will exist after the merge, and is used in Step 2 to resolve connections.

Coerce `feature.id` to a string at the point of reading: `const fileId = feature.id != null ? String(feature.id) : ""`. A numeric GeoJSON id (e.g. `1`) becomes `"1"`. An absent id or the value `null`/`undefined` becomes `""` and is treated as absent.

For each station feature (iterate in file order):
- If `fileId` is non-empty and already in `mergedIds`: skip (covers both pre-existing session stations and earlier stations in this same file, since each accepted station's `resolvedId` is added to `mergedIds`; connections may still reference this id and will resolve to the pre-existing station — intentional)
- Validate coordinates: `lng` and `lat` must each be a finite number; `lng` in `[-180, 180]` inclusive; `lat` in `[-90, 90]` inclusive. If invalid, silently skip the feature
- Determine `resolvedId`: `fileId` if non-empty, else `crypto.randomUUID()`
- Determine `name`: `String(properties.name)` if `properties.name` is not null/undefined and non-empty, otherwise `"Station"`
- Determine `osmNodeId`: if `properties.osmNodeId` exists, parse with `parseInt(String(properties.osmNodeId), 10)`; use only if finite integer, otherwise omit. Precision loss for OSM ids above 2^53 is accepted (`osmNodeId` is informational only)
- Add `StationPin { tempId: resolvedId, name, lat, lng, osmNodeId? }` and add `resolvedId` to `mergedIds`
- Create a MapLibre marker registered in `markersRef`, using the same path as manually placed pins (same drag/click-to-edit behaviour)

**Note on id collisions between sessions:** `tempId` values are UUIDs (`crypto.randomUUID()`). If a file's station id already exists in the current session (very unlikely given UUIDs), the imported station is silently skipped and connections referencing that id resolve to the pre-existing station. Acknowledged and accepted.

Stations with no `feature.id` receive a UUID and are permanently islands — connections cannot reference them since connection features reference stations by `fileId`, which is empty for id-less features. This is intentional.

**Step 2 — Merge connections**

Maintain a `seen: Set<string>` of normalised pair keys (format: `${a}|${b}` where `a < b` lexicographically) to de-duplicate within the file and against existing state.

Initialise `seen` from all pairs already in `connections` state, normalising each with `.sort().join('|')` before adding.

For each connection feature:
- Skip if `properties.from` or `properties.to` is absent or empty
- Skip if `properties.from === properties.to` (self-connection)
- Skip if either `properties.from` or `properties.to` is not in `mergedIds`
- Compute `pairKey = [properties.from, properties.to].sort().join('|')`
- Skip if `pairKey` is already in `seen`
- Add `[properties.from, properties.to]` to connections state and add `pairKey` to `seen`

**Step 3 — Update map**

Call `updateConnectionLayer(nextConnections, nextStations)` once after all merging is complete. No summary of skipped features is shown.

**Ref synchronisation:** `stationsRef` and `connectionsRef` are kept in sync with their state counterparts via `useEffect` hooks in HostSetup (lines 84 and 87). Calling `setStations(nextStations)` and `setConnections(nextConnections)` is sufficient; no direct ref mutation is needed in the import handler.

**Map readiness guard:** The import handler must check `if (!mapRef.current) return` before creating markers. The toolbar renders immediately when step 2 activates but the map may not yet be loaded. In practice, the map initialises quickly, but the guard prevents a null-ref crash during that window.

### Feedback states

Two separate state strings — `importError: string` and `importInfo: string` — displayed near the toolbar. Both are cleared at the start of each new import attempt.

| Condition | Field | Message |
|-----------|-------|---------|
| Non-JSON or malformed JSON | `importError` | "Could not read file. Make sure it is a valid GeoJSON file." |
| Valid JSON but not a FeatureCollection — check: `typeof parsed !== "object" \|\| parsed === null \|\| parsed.type !== "FeatureCollection"` | `importError` | "Could not read file. Make sure it is a valid GeoJSON file." |
| Parse succeeded AND `addedStations === 0` AND `addedConnections === 0` | `importInfo` | "No stations or connections were added." |
| Parse succeeded, one or more stations or connections added | both clear | (no message; station count updates) |

`importError` is styled as an error (red text). `importInfo` is styled as a neutral notice.

---

## UI Changes

Only [frontend/src/pages/HostSetup.tsx](../../../frontend/src/pages/HostSetup.tsx) and its existing CSS module require changes (edits, not new files).

- Import and Export buttons added at the right end of the existing `mapToolbar` div in the Step 2 panel, in that order (Import left, Export right)
- One hidden `<input type="file">` ref added
- `importError` and `importInfo` state strings for inline feedback near the toolbar
- Export handler: pure transformation + download, no new state
- Import handler: reads file, parses, merges into `stations` / `connections` state, updates map

No backend changes. No new files required.

---

## Out of Scope

- Exporting challenge or team data
- Import from URL
- Overwrite/replace mode (merge only)
- Undo after import
- Count of skipped/merged features shown to user
