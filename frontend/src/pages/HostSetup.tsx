import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import maplibregl from 'maplibre-gl'
import { SlLocationPin, SlExclamation } from 'react-icons/sl'
import { PiCoinVertical } from 'react-icons/pi'
import { api } from '../lib/pb'
import styles from './HostSetup.module.css'

const Coin = () => <PiCoinVertical style={{ verticalAlign: 'middle', marginBottom: '2px', height: "100%" }} />

// ── Types ─────────────────────────────────────────────────────────────────────

interface StationPin { name: string; lat: number; lng: number; tempId: string; osmNodeId?: number }
interface TeamDraft  { name: string; color: string }
interface ChallengeDraft {
  description: string
  coinReward: number
  difficulty: 'easy' | 'medium' | 'hard'
  source: 'host_authored'
  stationTempId?: string
}

const PRESET_COLORS = [
  '#1A6B6B', '#E8622A', '#7B3FA0', '#C0392B',
  '#2C82C9', '#27AE60', '#F0AC2B', '#E91E8C',
]

type DrawMode = 'pin' | 'polygon' | 'connect'
type Step = 1 | 2 | 3 | 4 | 5

export default function HostSetup() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Step 1
  const [gameName, setGameName] = useState('')

  // Step 2
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const [stations, setStations] = useState<StationPin[]>([])
  const stationsRef = useRef<StationPin[]>([])
  const [editingStation, setEditingStation] = useState<StationPin | null>(null)
  const [editName, setEditName] = useState('')
  const [drawMode, setDrawMode] = useState<DrawMode>('pin')
  const [polygonPoints, setPolygonPoints] = useState<[number, number][]>([])
  const polygonLayerRef = useRef<maplibregl.Marker[]>([])
  const [osmLoading, setOsmLoading] = useState(false)
  const [incStations, setIncStations] = useState(true)
  const [incHalts, setIncHalts] = useState(true)
  const [incTrams, setIncTrams] = useState(false)
  const drawModeRef = useRef<DrawMode>('pin')
  const polygonPointsRef = useRef<[number, number][]>([])
  const [connections, setConnections] = useState<[string, string][]>([])
  const connectionsRef = useRef<[string, string][]>([])
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null)
  const connectingFromRef = useRef<string | null>(null)

  // Step 3
  const [startingCoins, setStartingCoins] = useState(25)
  const [tollCost, setTollCost] = useState(3)
  const [maxStakeIncrement, setMaxStakeIncrement] = useState(5)
  const [requireApproval, setRequireApproval] = useState(false)

  // Step 4
  const [challenges, setChallenges] = useState<ChallengeDraft[]>([])
  const [newDesc, setNewDesc] = useState('')
  const [newReward, setNewReward] = useState(5)
  const [newDiff, setNewDiff] = useState<'easy' | 'medium' | 'hard'>('medium')
  const [newPinnedStation, setNewPinnedStation] = useState('')
  const [stationSearch, setStationSearch] = useState('')
  const [stationDropdownOpen, setStationDropdownOpen] = useState(false)

  // Step 5
  const [teams, setTeams] = useState<TeamDraft[]>([
    { name: 'Team Teal', color: PRESET_COLORS[0] },
    { name: 'Team Orange', color: PRESET_COLORS[1] },
  ])

  // Keep refs in sync for use inside map click closures
  useEffect(() => { stationsRef.current = stations }, [stations])
  useEffect(() => { drawModeRef.current = drawMode }, [drawMode])
  useEffect(() => { polygonPointsRef.current = polygonPoints }, [polygonPoints])
  useEffect(() => { connectionsRef.current = connections }, [connections])
  useEffect(() => { connectingFromRef.current = connectingFrom }, [connectingFrom])

  // Init map when step 2 is active
  useEffect(() => {
    if (step !== 2 || !mapContainerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: 'https://tiles.openfreemap.org/styles/positron',
      center: [144.9632, -37.8142],
      zoom: 12,
    })
    mapRef.current = map

    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    map.on('load', () => {
      map.addSource('polygon-draw', {
        type: 'geojson',
        data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[]] }, properties: {} },
      })
      map.addLayer({ id: 'polygon-draw-fill', type: 'fill', source: 'polygon-draw',
        paint: { 'fill-color': '#7B3FA0', 'fill-opacity': 0.15 } })
      map.addLayer({ id: 'polygon-draw-line', type: 'line', source: 'polygon-draw',
        paint: { 'line-color': '#7B3FA0', 'line-width': 2, 'line-dasharray': [2, 1] } })

      map.addSource('station-connections', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer({ id: 'conn-bg', type: 'line', source: 'station-connections',
        paint: { 'line-color': '#000000', 'line-width': 6 } })
      map.addLayer({ id: 'conn-fg', type: 'line', source: 'station-connections',
        paint: { 'line-color': '#ffffff', 'line-width': 3 } })

      // Re-add markers and connections when returning to step 2
      for (const pin of stationsRef.current) {
        const el = document.createElement('div')
        el.className = styles.mapPin
        const dot = document.createElement('div')
        dot.className = styles.mapPinDot
        el.appendChild(dot)
        const marker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([pin.lng, pin.lat]).addTo(map)
        el.addEventListener('click', (ev) => {
          ev.stopPropagation()
          if (drawModeRef.current === 'connect') { handleConnectClick(pin.tempId); return }
          const current = stationsRef.current.find(s => s.tempId === pin.tempId)
          if (current) { setEditingStation(current); setEditName(current.name) }
        })
        marker.on('dragend', () => {
          const { lat, lng } = marker.getLngLat()
          setStations(prev => {
            const updated = prev.map(s => s.tempId === pin.tempId ? { ...s, lat, lng } : s)
            updateConnectionLayer(connectionsRef.current, updated)
            return updated
          })
        })
        markersRef.current.set(pin.tempId, marker)
      }
      updateConnectionLayer(connectionsRef.current, stationsRef.current)
    })

    map.on('click', (e) => {
      if (drawModeRef.current === 'polygon') {
        const { lat, lng } = e.lngLat
        const el = document.createElement('div')
        el.className = styles.polygonVertex
        const m = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map)
        polygonLayerRef.current.push(m)
        const newPts: [number, number][] = [...polygonPointsRef.current, [lat, lng]]
        setPolygonPoints(newPts)
        // Update polygon fill/outline on the map
        const coords = newPts.map(p => [p[1], p[0]]) // [lng, lat] for MapLibre
        const closed = newPts.length >= 3 ? [...coords, coords[0]] : coords
        const src = map.getSource('polygon-draw') as maplibregl.GeoJSONSource
        src?.setData({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [closed] }, properties: {} })
        return
      }

      if (drawModeRef.current === 'connect') return

      const { lat, lng } = e.lngLat
      const tempId = crypto.randomUUID()
      const pin: StationPin = { name: `Station ${stationsRef.current.length + 1}`, lat, lng, tempId }

      // Add MapLibre marker
      const el = document.createElement('div')
      el.className = styles.mapPin
      const dot = document.createElement('div')
      dot.className = styles.mapPinDot
      el.appendChild(dot)

      const marker = new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat([lng, lat])
        .addTo(map)

      el.addEventListener('click', (ev) => {
        ev.stopPropagation()
        if (drawModeRef.current === 'connect') {
          handleConnectClick(tempId)
          return
        }
        const current = stationsRef.current.find(s => s.tempId === tempId)
        if (current) {
          setEditingStation(current)
          setEditName(current.name)
        }
      })
      marker.on('dragend', () => {
        const { lat: newLat, lng: newLng } = marker.getLngLat()
        setStations(prev => {
          const updated = prev.map(s => s.tempId === tempId ? { ...s, lat: newLat, lng: newLng } : s)
          updateConnectionLayer(connectionsRef.current, updated)
          return updated
        })
      })

      markersRef.current.set(tempId, marker)
      setStations(s => [...s, pin])
      reverseGeocode(lat, lng, tempId)
    })

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [step])

  async function reverseGeocode(lat: number, lng: number, tempId: string) {
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
        { headers: { 'Accept-Language': 'en' } }
      )
      const data = await res.json() as { name?: string; display_name?: string }
      const name = data.name || data.display_name?.split(',')[0] || 'Station'
      setStations(s => s.map(p => p.tempId === tempId ? { ...p, name } : p))
    } catch (_) {}
  }

  function saveEditStation() {
    if (!editingStation) return
    setStations(s => s.map(p => p.tempId === editingStation.tempId ? { ...p, name: editName } : p))
    setEditingStation(null)
  }

  function removeStation(tempId: string) {
    markersRef.current.get(tempId)?.remove()
    markersRef.current.delete(tempId)
    setStations(s => s.filter(p => p.tempId !== tempId))
    setConnections(c => c.filter(([a, b]) => a !== tempId && b !== tempId))
    setEditingStation(null)
  }

  function updateConnectionLayer(conns: [string, string][], pins: StationPin[]) {
    const src = mapRef.current?.getSource('station-connections') as maplibregl.GeoJSONSource | undefined
    if (!src) return
    const byTempId = new Map(pins.map(p => [p.tempId, p]))
    const features = conns.flatMap(([a, b]) => {
      const pa = byTempId.get(a), pb = byTempId.get(b)
      if (!pa || !pb) return []
      return [{ type: 'Feature' as const, geometry: { type: 'LineString' as const,
        coordinates: [[pa.lng, pa.lat], [pb.lng, pb.lat]] }, properties: {} }]
    })
    src.setData({ type: 'FeatureCollection', features })
  }

  function handleConnectClick(clickedTempId: string) {
    const from = connectingFromRef.current
    if (!from) {
      setConnectingFrom(clickedTempId)
      return
    }
    if (from === clickedTempId) {
      setConnectingFrom(null)
      return
    }
    // Toggle connection
    const exists = connectionsRef.current.some(
      ([a, b]) => (a === from && b === clickedTempId) || (a === clickedTempId && b === from)
    )
    const next: [string, string][] = exists
      ? connectionsRef.current.filter(([a, b]) => !((a === from && b === clickedTempId) || (a === clickedTempId && b === from)))
      : [...connectionsRef.current, [from, clickedTempId]]
    setConnections(next)
    updateConnectionLayer(next, stationsRef.current)
    setConnectingFrom(null)
  }

  function clearAllStations() {
    markersRef.current.forEach(m => m.remove())
    markersRef.current.clear()
    setStations([])
    setConnections([])
    updateConnectionLayer([], [])
    setEditingStation(null)
    setConnectingFrom(null)
  }

  function clearPolygonMarkers() {
    polygonLayerRef.current.forEach(m => m.remove())
    polygonLayerRef.current = []
    const src = mapRef.current?.getSource('polygon-draw') as maplibregl.GeoJSONSource | undefined
    src?.setData({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[]] }, properties: {} })
  }

  async function fetchOsmStations() {
    setOsmLoading(true)
    try {
      const polyStr = polygonPoints.map(p => `${p[0]} ${p[1]}`).join(' ')
      // Also fetch railway ways so we can auto-derive connections between station nodes
      const nodeFilters = [
        incStations && `node["railway"="station"](poly:"${polyStr}");`,
        incHalts    && `node["railway"="halt"](poly:"${polyStr}");`,
        incTrams    && `node["railway"="tram_stop"](poly:"${polyStr}");`,
      ].filter(Boolean).join('')
      const query = [
        `[out:json][timeout:30];`,
        `(${nodeFilters})->.stations;`,
        `way["railway"~"^(rail|subway|tram|light_rail|monorail)$"](bn.stations)->.ways;`,
        `.ways out geom;`,
        `.stations out;`,
      ].join('')
      const MIRRORS = [
        'https://overpass-api.de/api/interpreter',
        'https://overpass.kumi.systems/api/interpreter',
        'https://overpass.openstreetmap.ru/api/interpreter',
      ]
      type OsmNode = { type: 'node'; id: number; lat: number; lon: number; tags?: Record<string, string> }
      type OsmWay  = { type: 'way';  id: number; nodes: number[]; geometry?: Array<{ lat: number; lon: number }> }
      let data: { elements: Array<OsmNode | OsmWay> } | null = null
      for (const mirror of MIRRORS) {
        try {
          const res = await fetch(`${mirror}?data=${encodeURIComponent(query)}`)
          if (res.ok) { data = await res.json(); break }
        } catch (_) {}
      }
      if (!data) throw new Error('All Overpass mirrors failed — try again later')

      const nodeElements = (data.elements || []).filter((el): el is OsmNode => el.type === 'node')
      const wayElements  = (data.elements || []).filter((el): el is OsmWay  => el.type === 'way')

      // Deduplicate: same name + within ~150m → merge into one pin (handles bidirectional tram stops)
      const MERGE_DIST = 0.0015
      const osmIdToTempId = new Map<number, string>()
      const newPins: StationPin[] = []
      for (const n of nodeElements) {
        if (stations.some(existing =>
          Math.abs(existing.lat - n.lat) < 0.0001 && Math.abs(existing.lng - n.lon) < 0.0001
        )) continue
        const name = n.tags?.name || n.tags?.['name:en'] || 'Unnamed Station'
        const match = newPins.find(p =>
          p.name === name &&
          Math.abs(p.lat - n.lat) < MERGE_DIST &&
          Math.abs(p.lng - n.lon) < MERGE_DIST
        )
        if (match) {
          osmIdToTempId.set(n.id, match.tempId)
        } else {
          const tempId = crypto.randomUUID()
          newPins.push({ name, lat: n.lat, lng: n.lon, tempId, osmNodeId: n.id })
          osmIdToTempId.set(n.id, tempId)
        }
      }

      for (const pin of newPins) {
        const el = document.createElement('div')
        el.className = styles.mapPin
        const dot = document.createElement('div')
        dot.className = styles.mapPinDot
        el.appendChild(dot)
        const marker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([pin.lng, pin.lat]).addTo(mapRef.current!)
        el.addEventListener('click', (ev) => {
          ev.stopPropagation()
          if (drawModeRef.current === 'connect') { handleConnectClick(pin.tempId); return }
          const current = stationsRef.current.find(s => s.tempId === pin.tempId)
          if (current) { setEditingStation(current); setEditName(current.name) }
        })
        marker.on('dragend', () => {
          const { lat, lng } = marker.getLngLat()
          setStations(prev => {
            const updated = prev.map(s => s.tempId === pin.tempId ? { ...s, lat, lng } : s)
            updateConnectionLayer(connectionsRef.current, updated)
            return updated
          })
        })
        markersRef.current.set(pin.tempId, marker)
      }

      // Auto-derive connections from OSM railway ways
      const newConnections: [string, string][] = []
      for (const way of wayElements) {
        // Collect station tempIds that appear on this way, in node order
        const stationsOnWay = way.nodes
          .map(nodeId => osmIdToTempId.get(nodeId))
          .filter((id): id is string => id !== undefined)
        // Connect consecutive stations on the same way
        for (let i = 0; i < stationsOnWay.length - 1; i++) {
          const a = stationsOnWay[i], b = stationsOnWay[i + 1]
          if (a === b) continue
          const alreadyExists = [...connectionsRef.current, ...newConnections].some(
            ([x, y]) => (x === a && y === b) || (x === b && y === a)
          )
          if (!alreadyExists) newConnections.push([a, b])
        }
      }

      const allPins = [...stationsRef.current, ...newPins]
      const allConns: [string, string][] = [...connectionsRef.current, ...newConnections]
      setStations(allPins)
      setConnections(allConns)
      updateConnectionLayer(allConns, allPins)
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

  function addChallenge() {
    if (!newDesc.trim()) return
    setChallenges(c => [...c, {
      description: newDesc.trim(),
      coinReward: newReward,
      difficulty: newDiff,
      source: 'host_authored',
      stationTempId: newPinnedStation || undefined,
    }])
    setNewDesc('')
    setNewReward(5)
    setNewPinnedStation('')
    setStationSearch('')
  }

  async function launch() {
    setError('')
    if (teams.length < 2) { setError('At least 2 teams are required'); return }
    setSaving(true)
    try {
      const result = await api.post<{
        gameId: string
        inviteCode: string
        teams: Array<{ id: string; name: string; color: string }>
      }>('/api/rr/game', {
        name: gameName,
        startingCoins, maxStakeIncrement, tollCost,
        requireHostApproval: requireApproval,
        spectatorsAllowed: true,
        teams: teams.map(t => ({ name: t.name, color: t.color })),
      })

      const stationResult = await api.post<{
        stations: Array<{ id: string; name: string; lat: number; lng: number }>
      }>(`/api/rr/game/${result.gameId}/stations`, {
        stations: stations.map(s => ({ name: s.name, lat: s.lat, lng: s.lng, tempId: s.tempId })),
        connections,
      })

      const tempToRealId: Record<string, string> = {}
      stations.forEach((s, i) => {
        tempToRealId[s.tempId] = stationResult.stations[i]?.id ?? ''
      })

      if (challenges.length > 0) {
        await api.post(`/api/rr/game/${result.gameId}/challenges`, {
          challenges: challenges.map(c => ({
            description: c.description,
            coinReward: c.coinReward,
            difficulty: c.difficulty,
            source: c.source,
            stationId: c.stationTempId ? tempToRealId[c.stationTempId] : undefined,
          })),
        })
      }

      navigate(`/game/${result.gameId}/lobby`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create game')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={() =>
          step > 1 && step < 6 ? setStep(s => (s - 1) as Step) : navigate('/dashboard')
        }>
          ← {step > 1 && step < 6 ? 'Back' : 'Dashboard'}
        </button>
        <h1 className={styles.title}>Create Game</h1>
        {step < 6 && <span className={styles.stepIndicator}>{step} / 5</span>}
      </header>

      <div className={styles.content}>

        {step === 1 && (
          <div className={styles.stepPanel}>
            <h2 className={styles.stepTitle}>Game Details</h2>
            <label className={styles.label}>Game name</label>
            <input className={styles.input} value={gameName} onChange={e => setGameName(e.target.value)}
              placeholder="e.g. London Rail Rush" maxLength={60} />
            <button className={styles.nextBtn} onClick={() => setStep(2)} disabled={!gameName.trim()}>
              Next: Place Stations →
            </button>
          </div>
        )}

        {step === 2 && (
          <div className={styles.mapStep}>
            <div className={styles.mapInstructions}>
              <p>Tap the map to place stations. Tap a pin to rename or remove it.</p>
              <span className={styles.stationCount}>{stations.length} station{stations.length !== 1 ? 's' : ''}</span>
            </div>
            <div className={styles.mapToolbar}>
              <button
                className={drawMode === 'pin' ? styles.toolActive : styles.tool}
                onClick={() => { setDrawMode('pin'); setPolygonPoints([]); clearPolygonMarkers(); setConnectingFrom(null) }}
              ><SlLocationPin style={{ verticalAlign: 'middle' }} /> Place Pins</button>
              <button
                className={drawMode === 'polygon' ? styles.toolActive : styles.tool}
                onClick={() => { setDrawMode('polygon'); setConnectingFrom(null) }}
              >⬡ Draw Search Area</button>
              {stations.length >= 2 && (
                <button
                  className={drawMode === 'connect' ? styles.toolActive : styles.tool}
                  onClick={() => { setDrawMode('connect'); setPolygonPoints([]); clearPolygonMarkers() }}
                >🔗 Connect / Disconnect</button>
              )}
              {drawMode === 'connect' && connectingFrom && (
                <span className={styles.connectHint}>
                  {stations.find(s => s.tempId === connectingFrom)?.name} → tap another station
                </span>
              )}
              {drawMode === 'polygon' && polygonPoints.length >= 3 && (
                <>
                  <button className={styles.toolAction} onClick={fetchOsmStations}
                    disabled={osmLoading || (!incStations && !incHalts && !incTrams)}>
                    {osmLoading ? 'Searching…' : `Search for Stations (${polygonPoints.length} pts)`}
                  </button>
                  <span className={styles.osmTypeFilters}>
                    <label className={styles.osmTypeLabel}>
                      <input type="checkbox" checked={incStations} onChange={e => setIncStations(e.target.checked)} />
                      Stations
                    </label>
                    <label className={styles.osmTypeLabel}>
                      <input type="checkbox" checked={incHalts} onChange={e => setIncHalts(e.target.checked)} />
                      Halts
                    </label>
                    <label className={styles.osmTypeLabel}>
                      <input type="checkbox" checked={incTrams} onChange={e => setIncTrams(e.target.checked)} />
                      Trams
                    </label>
                  </span>
                </>
              )}
              {drawMode === 'polygon' && polygonPoints.length > 0 && (
                <button className={styles.toolClear} onClick={() => { setPolygonPoints([]); clearPolygonMarkers() }}>
                  Clear Polygon
                </button>
              )}
              {stations.length > 0 && (
                <button className={styles.toolClear} onClick={clearAllStations}>
                  Clear All
                </button>
              )}
            </div>
            <div ref={mapContainerRef} className={styles.mapContainer} />
            {editingStation && (
              <div className={styles.editOverlay}>
                <input className={styles.input} value={editName} onChange={e => setEditName(e.target.value)} autoFocus />
                <div className={styles.editBtns}>
                  <button className={styles.saveBtn} onClick={saveEditStation}>Save</button>
                  <button className={styles.dangerBtn} onClick={() => removeStation(editingStation.tempId)}>Remove</button>
                  <button className={styles.cancelBtn} onClick={() => setEditingStation(null)}>Cancel</button>
                </div>
                {connections.some(([a, b]) => a === editingStation.tempId || b === editingStation.tempId) && (
                  <div className={styles.connList}>
                    <span className={styles.connListLabel}>Connections</span>
                    {connections
                      .filter(([a, b]) => a === editingStation.tempId || b === editingStation.tempId)
                      .map(([a, b]) => {
                        const otherId = a === editingStation.tempId ? b : a
                        const other = stations.find(s => s.tempId === otherId)
                        if (!other) return null
                        return (
                          <div key={otherId} className={styles.connItem}>
                            <span>{other.name}</span>
                            <button className={styles.iconBtnDanger} onClick={() => {
                              const next: [string, string][] = connections.filter(([ca, cb]) =>
                                !((ca === editingStation.tempId && cb === otherId) || (ca === otherId && cb === editingStation.tempId))
                              )
                              setConnections(next)
                              updateConnectionLayer(next, stations)
                            }}>✕</button>
                          </div>
                        )
                      })}
                  </div>
                )}
              </div>
            )}
            <div className={styles.stationList}>
              {stations.map(p => {
                const connCount = connections.filter(([a, b]) => a === p.tempId || b === p.tempId).length
                return (
                  <div key={p.tempId} className={styles.stationItem}>
                    <span>{p.name}{connCount > 0 && <span className={styles.connBadge}>{connCount}</span>}</span>
                    <div className={styles.stationItemBtns}>
                      <button className={styles.iconBtn} onClick={() => { setEditingStation(p); setEditName(p.name) }}>✎</button>
                      <button className={styles.iconBtnDanger} onClick={() => removeStation(p.tempId)}>✕</button>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className={styles.mapFooter}>
              <button className={styles.nextBtn} onClick={() => setStep(3)} disabled={stations.length < 2}>
                Next: Rules →
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className={styles.stepPanel}>
            <h2 className={styles.stepTitle}>Rules</h2>
            <label className={styles.label}>Starting coins per team</label>
            <input className={styles.input} type="number" min={10} max={1000} value={startingCoins}
              onChange={e => setStartingCoins(+e.target.value)} />
            <label className={styles.label}>Toll cost (default 3)</label>
            <input className={styles.input} type="number" min={0} max={20} value={tollCost}
              onChange={e => setTollCost(+e.target.value)} />
            <label className={styles.label}>Max stake increment when contesting (default 5)</label>
            <input className={styles.input} type="number" min={1} max={1000} value={maxStakeIncrement}
              onChange={e => setMaxStakeIncrement(+e.target.value)} />
            <label className={styles.checkLabel}>
              <input type="checkbox" checked={requireApproval} onChange={e => setRequireApproval(e.target.checked)} />
              Require host approval for challenge completions
            </label>
            <button className={styles.nextBtn} onClick={() => setStep(4)}>Next: Challenges →</button>
          </div>
        )}

        {step === 4 && (
          <div className={styles.stepPanel}>
            <h2 className={styles.stepTitle}>Challenges</h2>
            <p className={styles.hint}>Optional. Challenges earn coins when completed.</p>
            <div className={styles.challengeForm}>
              <textarea className={styles.textarea} placeholder="Challenge description…"
                value={newDesc} onChange={e => setNewDesc(e.target.value)} rows={2} />
              <div className={styles.challengeRow}>
                <div>
                  <label className={styles.label}>Reward</label>
                  <input className={styles.inputSm} type="number" min={1} max={50}
                    value={newReward} onChange={e => setNewReward(+e.target.value)} />
                </div>
                <div>
                  <label className={styles.label}>Difficulty</label>
                  <select className={styles.inputSm} value={newDiff}
                    onChange={e => setNewDiff(e.target.value as 'easy'|'medium'|'hard')}>
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </div>
                <div>
                  <label className={styles.label}>Pin to station</label>
                  <div className={styles.stationSearchWrapper}>
                    <input
                      className={styles.inputSm}
                      placeholder="random"
                      value={stationSearch}
                      onChange={e => { setStationSearch(e.target.value); setStationDropdownOpen(true) }}
                      onFocus={() => setStationDropdownOpen(true)}
                      onBlur={() => setTimeout(() => setStationDropdownOpen(false), 150)}
                    />
                    {stationDropdownOpen && (
                      <div className={styles.stationDropdown}>
                        <div className={styles.stationDropdownItem}
                          onMouseDown={() => { setNewPinnedStation(''); setStationSearch(''); setStationDropdownOpen(false) }}>
                          random
                        </div>
                        {stations
                          .filter(s => s.name.toLowerCase().includes(stationSearch.toLowerCase()))
                          .map(s => (
                            <div key={s.tempId} className={styles.stationDropdownItem}
                              onMouseDown={() => { setNewPinnedStation(s.tempId); setStationSearch(s.name); setStationDropdownOpen(false) }}>
                              {s.name}
                            </div>
                          ))
                        }
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <button className={styles.addBtn} onClick={addChallenge} disabled={!newDesc.trim()}>
                Add Challenge
              </button>
            </div>
            {challenges.map((c, i) => (
              <div key={i} className={styles.challengeItem}>
                <span className={styles.challengeDesc}>{c.description}</span>
                <div className={styles.challengeMeta}>
                  <span>{c.coinReward} coins · {c.difficulty}</span>
                  {c.stationTempId && <span><SlLocationPin style={{ verticalAlign: 'middle' }} /> {stations.find(s => s.tempId === c.stationTempId)?.name}</span>}
                </div>
                <button className={styles.removeBtn} onClick={() => setChallenges(arr => arr.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            {(() => {
              const totalCoinReward = challenges.reduce((sum, c) => sum + c.coinReward, 0)
              const totalCoinsInPlay = teams.length * startingCoins
              const poolTooSmall = challenges.length > 0 && challenges.length < 5
              const rewardTooLow = challenges.length > 0 && totalCoinReward < totalCoinsInPlay * 0.5
              return (
                <>
                  {poolTooSmall && (
                    <p className={styles.warning}>
                      <SlExclamation style={{ verticalAlign: 'middle', color: 'var(--color-amber)' }} /> Very small challenge pool ({challenges.length} challenge{challenges.length !== 1 ? 's' : ''}). Consider adding more.
                    </p>
                  )}
                  {rewardTooLow && (
                    <p className={styles.warning}>
                      <SlExclamation style={{ verticalAlign: 'middle', color: 'var(--color-amber)' }} /> Total challenge rewards ({totalCoinReward}<Coin />) are less than half the coins in play ({Math.floor(totalCoinsInPlay * 0.5)}<Coin />). Players may run out of coins.
                    </p>
                  )}
                </>
              )
            })()}
            <button className={styles.nextBtn} onClick={() => setStep(5)}>Next: Teams →</button>
          </div>
        )}

        {step === 5 && (
          <div className={styles.stepPanel}>
            <h2 className={styles.stepTitle}>Teams</h2>
            {teams.map((t, i) => (
              <div key={i} className={styles.teamRow}>
                <input className={styles.input} value={t.name}
                  onChange={e => setTeams(arr => arr.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                  placeholder={`Team ${i + 1}`} />
                <div className={styles.colorPicker}>
                  {PRESET_COLORS.map(c => (
                    <button key={c} className={styles.colorSwatch}
                      style={{ background: c, outline: t.color === c ? `3px solid ${c}` : 'none', outlineOffset: 2 }}
                      onClick={() => setTeams(arr => arr.map((x, j) => j === i ? { ...x, color: c } : x))} />
                  ))}
                </div>
                {teams.length > 1 && (
                  <button className={styles.removeBtn} onClick={() => setTeams(arr => arr.filter((_, j) => j !== i))}>✕</button>
                )}
              </div>
            ))}
            {teams.length < 8 && <button className={styles.addBtn} onClick={() => {
              const used = new Set(teams.map(t => t.color))
              const color = PRESET_COLORS.find(c => !used.has(c)) ?? PRESET_COLORS[teams.length % 8]
              setTeams(t => [...t, { name: `Team ${t.length + 1}`, color }])
            }}>+ Add Team</button>}
            {error && <p className={styles.error}>{error}</p>}
            <button className={styles.launchBtn} onClick={launch}
              disabled={saving || teams.some(t => !t.name.trim())}>
              {saving ? 'Creating…' : 'Create & Open Lobby'}
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
