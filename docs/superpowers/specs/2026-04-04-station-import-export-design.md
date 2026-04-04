# Station Import / Export — Design Spec

**Date:** 2026-04-04  
**Status:** Approved

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
  "properties": { "railRushType": "station", "name": "Flinders Street" }
}
```
- `id` (top-level GeoJSON feature id) — the station's `tempId`
- `coordinates` — `[lng, lat]` (GeoJSON convention)
- `properties.name` — display name

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
- `properties.from` / `properties.to` — `tempId` values of the two connected stations
- `coordinates` — derived from station positions at export time (for visual rendering in GIS tools)

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
A button labelled "⬆ Export" in the Step 2 map toolbar, alongside the existing Place Pins / Draw Search Area / Connect buttons.

### Enabled state
Disabled when `stations.length === 0`.

### Filename
Game name (from Step 1) transformed:
1. Lowercase
2. Punctuation stripped (non-alphanumeric, non-space characters removed)
3. Spaces replaced with `-`
4. Suffix `-stations.geojson` appended

Example: `"London Rail Rush!"` → `london-rail-rush-stations.geojson`

### Logic
1. Map each `StationPin` to a GeoJSON Point Feature using `tempId` as `feature.id`
2. Map each `[tempIdA, tempIdB]` connection to a GeoJSON LineString Feature; look up coordinates from the station array
3. Serialize as JSON, trigger browser download via a temporary `<a>` element with a `blob:` URL

Client-side only. No backend changes.

---

## Import

### Trigger
A button labelled "⬇ Import" in the Step 2 map toolbar. Clicking it programmatically clicks a hidden `<input type="file" accept=".geojson,.json">`.

### Merge behavior
Imported data is merged into existing state — existing stations and connections are preserved.

### Logic

**Station deduplication:**
- For each station feature in the file: if `feature.id` already exists in the current `tempId` set, skip it
- If `feature.id` is absent (file edited externally and id removed), generate a fresh `tempId` via the existing `Date.now()` pattern
- Add new stations to state, create MapLibre markers for each

**Connection deduplication:**
- After merging stations, for each connection feature: resolve `from` and `to` against the full merged station set
- Skip if either endpoint is not found (orphaned connection)
- Skip if the pair `[from, to]` or `[to, from]` already exists in `connections` state
- Add remaining connections to state, update the connection layer

### Error handling
- Non-JSON file or malformed JSON: show a brief inline error message near the toolbar
- Valid JSON but not a GeoJSON FeatureCollection: same error
- File with zero recognized features: show a message "No stations found in file"

---

## UI Changes

Only [frontend/src/pages/HostSetup.tsx](../../../frontend/src/pages/HostSetup.tsx) and its CSS module require changes.

- Two new buttons added to the existing `mapToolbar` div in the Step 2 panel
- One hidden `<input type="file">` ref added
- Export handler: pure transformation + download, no new state
- Import handler: reads file, parses, merges into `stations` / `connections` state, updates map

No backend changes. No new files required.

---

## Out of Scope

- Exporting challenge or team data
- Import from URL
- Overwrite/replace mode (merge only)
- Undo after import
