# Task 10: OSM polygon station import in HostSetup

**Files:**
- Create: `backend/pb_hooks/osm.pb.js`
- Modify: `frontend/src/pages/HostSetup.tsx`

The `osm_station_cache` collection already exists — created in `1_initial_schema.pb.js` with fields `bbox_hash` (text), `bbox_geojson` (json), `stations_json` (json), `fetched_at` (date). No new migration needed.

---

- [ ] **Step 1: Create OSM proxy backend endpoint**

Create `backend/pb_hooks/osm.pb.js`:

```js
/// <reference path="../pb_data/types.d.ts" />

// POST /api/rr/osm/stations
// Body: { polygon: [[lat, lng], ...] }
// Returns OSM railway stations within the polygon, with 1-hour caching.
routerAdd("POST", "/api/rr/osm/stations", (e) => {
  const authRecord = e.auth;
  if (!authRecord) throw new UnauthorizedError("unauthenticated");

  const body = e.requestInfo().body;
  const polygon = body.polygon; // array of [lat, lng] pairs
  if (!Array.isArray(polygon) || polygon.length < 3) {
    throw new BadRequestError("polygon must have at least 3 points");
  }

  // Build a hash key for caching
  const bboxKey = polygon.map(p => `${p[0].toFixed(4)},${p[1].toFixed(4)}`).join(';');

  // Check cache (1 hour TTL)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const cached = e.app.findRecordsByFilter(
    "osm_station_cache",
    "bbox_hash = {:key} && fetched_at > {:cutoff}",
    "", 1, 0, { key: bboxKey, cutoff: oneHourAgo }
  );
  if (cached.length > 0) {
    return e.json(200, { stations: cached[0].get("stations_json"), fromCache: true });
  }

  // Build Overpass query using the polygon
  const polyStr = polygon.map(p => `${p[0]} ${p[1]}`).join(' ');
  const query = `[out:json][timeout:10];(node["railway"="station"](poly:"${polyStr}");node["railway"="halt"](poly:"${polyStr}"););out;`;

  let stations = [];
  try {
    const resp = $http.send({
      url: "https://overpass-api.de/api/interpreter",
      method: "POST",
      body: `data=${encodeURIComponent(query)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 15,
    });
    const data = resp.json();
    stations = (data.elements || []).map(n => ({
      id: `osm:${n.id}`,
      name: n.tags?.name || n.tags?.["name:en"] || "Unnamed Station",
      lat: n.lat,
      lng: n.lon,
    }));
  } catch (err) {
    throw new BadRequestError("Failed to fetch from OSM: " + err.message);
  }

  // Cache the result
  const col = e.app.findCollectionByNameOrId("osm_station_cache");
  const rec = new Record(col);
  rec.set("bbox_hash", bboxKey);
  rec.set("stations_json", stations);
  rec.set("fetched_at", new Date().toISOString());
  e.app.save(rec);

  return e.json(200, { stations, fromCache: false });
});
```

---

- [ ] **Step 2: Restart PocketBase and test the endpoint**

```bash
curl -X POST http://localhost:8090/api/rr/osm/stations \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"polygon":[[51.5,-0.15],[51.5,-0.1],[51.48,-0.1],[51.48,-0.15]]}'
```

Expected: `{"stations":[...],"fromCache":false}` with London stations.

---

- [ ] **Step 3: Add polygon draw mode to HostSetup state**

In `frontend/src/pages/HostSetup.tsx`, add state for polygon drawing:

```ts
const [drawMode, setDrawMode] = useState<'pin' | 'polygon'>('pin')
const [polygonPoints, setPolygonPoints] = useState<[number, number][]>([]) // [lat, lng]
const polygonLayerRef = useRef<maplibregl.Marker[]>([])
const [osmLoading, setOsmLoading] = useState(false)
const drawModeRef = useRef<'pin' | 'polygon'>('pin')
```

Keep the ref in sync:
```ts
useEffect(() => { drawModeRef.current = drawMode }, [drawMode])
```

---

- [ ] **Step 4: Add mode toggle toolbar in step 2 JSX**

Add a toolbar above the map container:

```tsx
<div className={styles.mapToolbar}>
  <button
    className={drawMode === 'pin' ? styles.toolActive : styles.tool}
    onClick={() => { setDrawMode('pin'); setPolygonPoints([]); clearPolygonMarkers() }}
  >📍 Place Pins</button>
  <button
    className={drawMode === 'polygon' ? styles.toolActive : styles.tool}
    onClick={() => setDrawMode('polygon')}
  >⬡ Draw Area</button>
  {drawMode === 'polygon' && polygonPoints.length >= 3 && (
    <button className={styles.toolAction} onClick={fetchOsmStations} disabled={osmLoading}>
      {osmLoading ? 'Searching…' : `Search OSM (${polygonPoints.length} pts)`}
    </button>
  )}
  {drawMode === 'polygon' && polygonPoints.length > 0 && (
    <button className={styles.toolClear} onClick={() => { setPolygonPoints([]); clearPolygonMarkers() }}>
      Clear Polygon
    </button>
  )}
</div>
```

---

- [ ] **Step 5: Handle polygon clicks in the map**

Modify the `map.on('click', ...)` handler to branch based on `drawModeRef.current`:

```ts
map.on('click', (e) => {
  if (drawModeRef.current === 'polygon') {
    const { lat, lng } = e.lngLat
    const el = document.createElement('div')
    el.className = styles.polygonVertex
    const m = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map)
    polygonLayerRef.current.push(m)
    setPolygonPoints(pts => [...pts, [lat, lng]])
    return
  }
  // ... existing pin placement code continues here
})
```

---

- [ ] **Step 6: Implement fetchOsmStations and clearPolygonMarkers**

Add these functions to the HostSetup component:

```ts
function clearPolygonMarkers() {
  polygonLayerRef.current.forEach(m => m.remove())
  polygonLayerRef.current = []
}

async function fetchOsmStations() {
  setOsmLoading(true)
  try {
    const result = await api.post<{ stations: { id: string; name: string; lat: number; lng: number }[] }>(
      '/api/rr/osm/stations',
      { polygon: polygonPoints }
    )
    // Add found stations to the list, deduped by proximity
    const newPins: StationPin[] = result.stations
      .filter(s => !stations.some(existing =>
        Math.abs(existing.lat - s.lat) < 0.0001 && Math.abs(existing.lng - s.lng) < 0.0001
      ))
      .map(s => ({ name: s.name, lat: s.lat, lng: s.lng, tempId: crypto.randomUUID() }))

    for (const pin of newPins) {
      const el = document.createElement('div')
      el.className = styles.mapPin
      const dot = document.createElement('div')
      dot.className = styles.mapPinDot
      el.appendChild(dot)
      const marker = new maplibregl.Marker({ element: el }).setLngLat([pin.lng, pin.lat]).addTo(mapRef.current!)
      el.addEventListener('click', (ev) => {
        ev.stopPropagation()
        const current = stationsRef.current.find(s => s.tempId === pin.tempId)
        if (current) { setEditingStation(current); setEditName(current.name) }
      })
      markersRef.current.set(pin.tempId, marker)
    }

    setStations(s => [...s, ...newPins])
    setDrawMode('pin')
    setPolygonPoints([])
    clearPolygonMarkers()
    if (newPins.length === 0) alert('No railway stations found in that area. Try a larger polygon.')
  } catch (err) {
    alert(err instanceof Error ? err.message : 'Failed to fetch OSM stations')
  } finally {
    setOsmLoading(false)
  }
}
```

---

- [ ] **Step 7: Add CSS for polygon tool UI**

In `HostSetup.module.css`, add:

```css
.mapToolbar {
  display: flex;
  gap: 0.5rem;
  padding: 0.5rem;
  background: rgba(255,255,255,0.95);
  border-bottom: 1px solid #ddd;
  flex-wrap: wrap;
}
.tool {
  padding: 0.4rem 0.8rem;
  border: 1px solid #ccc;
  border-radius: 6px;
  background: white;
  cursor: pointer;
  font-size: 0.85rem;
}
.toolActive {
  padding: 0.4rem 0.8rem;
  border: 2px solid #1A6B6B;
  border-radius: 6px;
  background: #e8f4f4;
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 600;
}
.toolAction {
  padding: 0.4rem 0.8rem;
  border: none;
  border-radius: 6px;
  background: #1A6B6B;
  color: white;
  cursor: pointer;
  font-size: 0.85rem;
}
.toolClear {
  padding: 0.4rem 0.8rem;
  border: 1px solid #E8622A;
  border-radius: 6px;
  background: white;
  color: #E8622A;
  cursor: pointer;
  font-size: 0.85rem;
}
.polygonVertex {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #7B3FA0;
  border: 2px solid white;
  cursor: pointer;
}
```

---

- [ ] **Step 8: Test polygon flow**

1. Create a new game.
2. In step 2, tap "Draw Area". Click 4+ points around a known station area.
3. Tap "Search OSM". After loading, station pins should appear for railway stations in that area.
4. Verify station names are correct.
5. Switch back to "Place Pins" mode, manually add more if needed.
6. Proceed to save stations — verify OSM-imported stations are included.

---

- [ ] **Step 9: Commit**

```bash
git add backend/pb_hooks/osm.pb.js frontend/src/pages/HostSetup.tsx
git commit -m "feat: polygon draw tool in HostSetup to import railway stations from OSM"
```
