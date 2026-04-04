import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import maplibregl from 'maplibre-gl'
import { SlLocationPin, SlExclamation } from 'react-icons/sl'
import { PiCoinVertical } from 'react-icons/pi'
import { api } from '../lib/pb'
import styles from './HostSetup.module.css'
import { saveMap, MapTemplateDetail } from '../lib/api'
import MapGallery from '../components/MapGallery'

const Coin = () => <PiCoinVertical style={{ verticalAlign: 'middle', marginBottom: '2px', height: "100%" }} />

// ── Types ─────────────────────────────────────────────────────────────────────

interface StationPin { name: string; lat: number; lng: number; tempId: string; osmNodeId?: number }
interface PhotonFeature {
  geometry: { coordinates: [number, number] }
  properties: { name?: string; city?: string; state?: string; country?: string }
}
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
type Step = 1 | 2 | 3 | 4 | 5 | 6

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
  const [importError, setImportError] = useState('')
  const [importInfo, setImportInfo] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const connectingFromRef = useRef<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<PhotonFeature[]>([])
  const previewMarkerRef = useRef<maplibregl.Marker | null>(null)
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  // Template gallery
  const [selectedTemplate, setSelectedTemplate] = useState<MapTemplateDetail | null>(null)
  const selectedTemplateRef = useRef<MapTemplateDetail | null>(null)

  // Step 6 — save as template
  const [saveAsTemplate, setSaveAsTemplate] = useState(false)
  const [templateName, setTemplateName] = useState('')

  // Keep refs in sync for use inside map click closures
  useEffect(() => { stationsRef.current = stations }, [stations])
  useEffect(() => { drawModeRef.current = drawMode }, [drawMode])
  useEffect(() => { polygonPointsRef.current = polygonPoints }, [polygonPoints])
  useEffect(() => { connectionsRef.current = connections }, [connections])
  useEffect(() => { connectingFromRef.current = connectingFrom }, [connectingFrom])
  useEffect(() => { selectedTemplateRef.current = selectedTemplate }, [selectedTemplate])

  // Init map when step 2 is active
  useEffect(() => {
    if (step !== 3 || !mapContainerRef.current || mapRef.current) return

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
      dismissPreview()
      map.remove()
      mapRef.current = null
    }
  }, [step])

  function handleSearchChange(q: string) {
    setSearchQuery(q)
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    if (!q.trim()) { setSearchResults([]); return }
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=10`)
        const data = await res.json() as { features: PhotonFeature[] }
        setSearchResults(data.features || [])
      } catch (_) {
        setSearchResults([])
      }
    }, 300)
  }

  function dismissPreview() {
    previewMarkerRef.current?.remove()
    previewMarkerRef.current = null
  }

  function confirmPreviewPin(lat: number, lng: number, name: string) {
    dismissPreview()
    const tempId = crypto.randomUUID()
    const pin: StationPin = { name, lat, lng, tempId }
    const el = document.createElement('div')
    el.className = styles.mapPin
    const dot = document.createElement('div')
    dot.className = styles.mapPinDot
    el.appendChild(dot)
    const marker = new maplibregl.Marker({ element: el, draggable: true })
      .setLngLat([lng, lat])
      .addTo(mapRef.current!)
    el.addEventListener('click', (ev) => {
      ev.stopPropagation()
      if (drawModeRef.current === 'connect') { handleConnectClick(tempId); return }
      const current = stationsRef.current.find(s => s.tempId === tempId)
      if (current) { setEditingStation(current); setEditName(current.name) }
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
  }

  function selectSearchResult(feature: PhotonFeature) {
    const [lng, lat] = feature.geometry.coordinates
    const name = feature.properties.name || 'Station'
    setSearchQuery('')
    setSearchResults([])
    mapRef.current?.flyTo({ center: [lng, lat], zoom: 15 })
    dismissPreview()
    const el = document.createElement('div')
    el.className = styles.previewPin
    const dot = document.createElement('div')
    dot.className = styles.previewPinDot
    el.appendChild(dot)
    const tick = document.createElement('button')
    tick.className = styles.previewPinTick
    tick.textContent = '✓'
    tick.onclick = (ev) => { ev.stopPropagation(); confirmPreviewPin(lat, lng, name) }
    el.appendChild(tick)
    previewMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([lng, lat])
      .addTo(mapRef.current!)
  }

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

  function handleExport() {
    const stem = gameName
      .replace(/[^\x00-\x7F]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, '')
      .trim()
      .replace(/ +/g, '-')
    const filename = stem ? `${stem}-stations.geojson` : 'stations.geojson'

    const features: object[] = stations.map(s => {
      const props: Record<string, unknown> = { railRushType: 'station', name: s.name }
      if (s.osmNodeId != null) props.osmNodeId = s.osmNodeId
      return { type: 'Feature', id: s.tempId, geometry: { type: 'Point', coordinates: [s.lng, s.lat] }, properties: props }
    })

    const byTempId = new Map(stations.map(p => [p.tempId, p]))
    for (const [a, b] of connections) {
      const pa = byTempId.get(a), pb = byTempId.get(b)
      if (!pa || !pb) continue
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[pa.lng, pa.lat], [pb.lng, pb.lat]] },
        properties: { railRushType: 'connection', from: a, to: b },
      })
    }

    const json = JSON.stringify({ type: 'FeatureCollection', features }, null, 2)
    const blob = new Blob([json], { type: 'application/geo+json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setImportError('')
    setImportInfo('')

    const reader = new FileReader()
    reader.onload = () => {
      let parsed: unknown
      try {
        parsed = JSON.parse(reader.result as string)
      } catch (_) {
        setImportError('Could not read file. Make sure it is a valid GeoJSON file.')
        return
      }

      if (typeof parsed !== 'object' || parsed === null || (parsed as { type?: unknown }).type !== 'FeatureCollection') {
        setImportError('Could not read file. Make sure it is a valid GeoJSON file.')
        return
      }

      if (!mapRef.current) return

      const fc = parsed as { type: string; features?: unknown[] }
      const rawFeatures = Array.isArray(fc.features) ? fc.features : []

      // Step 1: Merge stations
      const mergedIds = new Set(stationsRef.current.map(s => s.tempId))
      const nextStations: StationPin[] = [...stationsRef.current]
      let addedStations = 0

      for (const feat of rawFeatures) {
        if (typeof feat !== 'object' || feat === null) continue
        const f = feat as Record<string, unknown>
        const props = typeof f.properties === 'object' && f.properties !== null
          ? f.properties as Record<string, unknown>
          : {}
        if (props.railRushType !== 'station') continue

        const fileId = f.id != null ? String(f.id) : ''
        if (fileId !== '' && mergedIds.has(fileId)) continue

        const geometry = typeof f.geometry === 'object' && f.geometry !== null
          ? f.geometry as Record<string, unknown>
          : {}
        const coords = Array.isArray(geometry.coordinates) ? geometry.coordinates : []
        const lng = typeof coords[0] === 'number' ? coords[0] : NaN
        const lat = typeof coords[1] === 'number' ? coords[1] : NaN

        if (!isFinite(lng) || !isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) continue

        const resolvedId = fileId !== '' ? fileId : crypto.randomUUID()
        const name = props.name != null && String(props.name) !== '' ? String(props.name) : 'Station'

        let osmNodeId: number | undefined
        if (props.osmNodeId != null) {
          const n = parseInt(String(props.osmNodeId), 10)
          if (isFinite(n)) osmNodeId = n
        }

        const pin: StationPin = osmNodeId != null
          ? { tempId: resolvedId, name, lat, lng, osmNodeId }
          : { tempId: resolvedId, name, lat, lng }
        nextStations.push(pin)
        mergedIds.add(resolvedId)
        addedStations++

        const el = document.createElement('div')
        el.className = styles.mapPin
        const dot = document.createElement('div')
        dot.className = styles.mapPinDot
        el.appendChild(dot)
        const marker = new maplibregl.Marker({ element: el, draggable: true })
          .setLngLat([lng, lat])
          .addTo(mapRef.current!)
        el.addEventListener('click', (ev) => {
          ev.stopPropagation()
          if (drawModeRef.current === 'connect') { handleConnectClick(resolvedId); return }
          const current = stationsRef.current.find(s => s.tempId === resolvedId)
          if (current) { setEditingStation(current); setEditName(current.name) }
        })
        marker.on('dragend', () => {
          const { lat: newLat, lng: newLng } = marker.getLngLat()
          setStations(prev => {
            const updated = prev.map(s => s.tempId === resolvedId ? { ...s, lat: newLat, lng: newLng } : s)
            updateConnectionLayer(connectionsRef.current, updated)
            return updated
          })
        })
        markersRef.current.set(resolvedId, marker)
      }

      // Step 2: Merge connections
      const seen = new Set(connectionsRef.current.map(([a, b]) => [a, b].sort().join('|')))
      const nextConnections: [string, string][] = [...connectionsRef.current]
      let addedConnections = 0

      for (const feat of rawFeatures) {
        if (typeof feat !== 'object' || feat === null) continue
        const f = feat as Record<string, unknown>
        const props = typeof f.properties === 'object' && f.properties !== null
          ? f.properties as Record<string, unknown>
          : {}
        if (props.railRushType !== 'connection') continue

        const from = props.from != null ? String(props.from) : ''
        const to = props.to != null ? String(props.to) : ''
        if (!from || !to || from === to) continue
        if (!mergedIds.has(from) || !mergedIds.has(to)) continue

        const pairKey = [from, to].sort().join('|')
        if (seen.has(pairKey)) continue

        nextConnections.push([from, to])
        seen.add(pairKey)
        addedConnections++
      }

      // Step 3: Update state + map
      setStations(nextStations)
      setConnections(nextConnections)
      updateConnectionLayer(nextConnections, nextStations)

      if (addedStations === 0 && addedConnections === 0) {
        setImportInfo('No stations or connections were added.')
      }
    }
    reader.readAsText(file)
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
        <button className={styles.backBtn} onClick={() => {
          if (step > 1 && step < 7) {
            if (step === 2) setSelectedTemplate(null)
            setStep(s => (s - 1) as Step)
          } else {
            navigate('/dashboard')
          }
        }}>
          ← {step > 1 && step < 7 ? 'Back' : 'Dashboard'}
        </button>
        <h1 className={styles.title}>Create Game</h1>
        {step < 6 && <span className={styles.stepIndicator}>{step} / 6</span>}
      </header>

      <div className={styles.content}>

        {step === 1 && (
          <div className={styles.stepPanel}>
            <h2 className={styles.stepTitle}>Choose a Map</h2>
            <MapGallery
              onSelect={template => {
                setSelectedTemplate(template)
                setStep(2)
              }}
              onSkip={() => {
                setSelectedTemplate(null)
                setStep(2)
              }}
            />
          </div>
        )}

        {step === 2 && (
          <div className={styles.stepPanel}>
            <h2 className={styles.stepTitle}>Game Details</h2>
            <label className={styles.label}>Game name</label>
            <input className={styles.input} value={gameName} onChange={e => setGameName(e.target.value)}
              placeholder="e.g. London Rail Rush" maxLength={60} />
            <button className={styles.nextBtn} onClick={() => setStep(3)} disabled={!gameName.trim()}>
              Next: Place Stations →
            </button>
          </div>
        )}

        {step === 3 && (
          <div className={styles.mapStep}>
            <div className={styles.mapInstructions}>
              <p>Tap the map to place stations. Tap a pin to rename or remove it.</p>
              <span className={styles.stationCount}>{stations.length} station{stations.length !== 1 ? 's' : ''}</span>
            </div>
            <div className={styles.mapToolbar}>
              <button
                className={drawMode === 'pin' ? styles.toolActive : styles.tool}
                onClick={() => { setDrawMode('pin'); setPolygonPoints([]); clearPolygonMarkers(); setConnectingFrom(null) }}
              ><SlLocationPin style={{ verticalAlign: 'middle' }} /> Place Stations</button>
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
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
                <button className={styles.tool} onClick={() => fileInputRef.current?.click()}>Import</button>
                <button className={styles.tool} onClick={handleExport} disabled={stations.length === 0}>Export</button>
              </div>
            </div>
            {importError && <p className={styles.importError}>{importError}</p>}
            {importInfo && <p className={styles.importInfo}>{importInfo}</p>}
            <input ref={fileInputRef} type="file" accept=".geojson,.json" style={{ display: 'none' }} onChange={handleImport} />
            <div ref={mapContainerRef} className={styles.mapContainer}>
              <div className={styles.mapSearchOverlay}>
                <input
                  className={styles.mapSearchInput}
                  placeholder="Search for a place or station..."
                  value={searchQuery}
                  onChange={e => handleSearchChange(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && searchResults.length > 0) selectSearchResult(searchResults[0])
                    if (e.key === 'Escape') { setSearchQuery(''); setSearchResults([]) }
                  }}
                />
                {searchResults.length > 0 && (
                  <div className={styles.mapSearchDropdown}>
                    {searchResults.map((f, i) => {
                      const sub = [f.properties.city, f.properties.state, f.properties.country].filter(Boolean).join(', ')
                      return (
                        <button key={i} className={styles.mapSearchItem} onClick={() => selectSearchResult(f)}>
                          <span className={styles.mapSearchItemName}>{f.properties.name || 'Unknown'}</span>
                          {sub && <span className={styles.mapSearchItemSub}>{sub}</span>}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
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
              <button className={styles.nextBtn} onClick={() => setStep(4)} disabled={stations.length < 2}>
                Next: Rules →
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
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
            <button className={styles.nextBtn} onClick={() => setStep(5)}>Next: Challenges →</button>
          </div>
        )}

        {step === 5 && (
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
            <button className={styles.nextBtn} onClick={() => setStep(6)}>Next: Teams →</button>
          </div>
        )}

        {step === 6 && (
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
