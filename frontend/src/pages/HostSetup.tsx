import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import maplibregl from 'maplibre-gl'
import { api } from '../lib/pb'
import styles from './HostSetup.module.css'

// ── Types ─────────────────────────────────────────────────────────────────────

interface StationPin { name: string; lat: number; lng: number; tempId: string }
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
  const [drawMode, setDrawMode] = useState<'pin' | 'polygon'>('pin')
  const [polygonPoints, setPolygonPoints] = useState<[number, number][]>([])
  const polygonLayerRef = useRef<maplibregl.Marker[]>([])
  const [osmLoading, setOsmLoading] = useState(false)
  const drawModeRef = useRef<'pin' | 'polygon'>('pin')
  const polygonPointsRef = useRef<[number, number][]>([])

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

  // Step 6
  const [createdGame, setCreatedGame] = useState<{
    gameId: string
    inviteCode: string
    teams: Array<{ id: string; name: string; color: string }>
  } | null>(null)

  // Keep stationsRef in sync for use inside map click closure
  useEffect(() => { stationsRef.current = stations }, [stations])
  useEffect(() => { drawModeRef.current = drawMode }, [drawMode])
  useEffect(() => { polygonPointsRef.current = polygonPoints }, [polygonPoints])

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

      const { lat, lng } = e.lngLat
      const tempId = crypto.randomUUID()
      const pin: StationPin = { name: `Station ${stationsRef.current.length + 1}`, lat, lng, tempId }

      // Add MapLibre marker
      const el = document.createElement('div')
      el.className = styles.mapPin
      const dot = document.createElement('div')
      dot.className = styles.mapPinDot
      el.appendChild(dot)

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([lng, lat])
        .addTo(map)

      el.addEventListener('click', (ev) => {
        ev.stopPropagation()
        const current = stationsRef.current.find(s => s.tempId === tempId)
        if (current) {
          setEditingStation(current)
          setEditName(current.name)
        }
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
    setEditingStation(null)
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
      const query = `[out:json][timeout:25];(node["railway"="station"](poly:"${polyStr}");node["railway"="halt"](poly:"${polyStr}"););out;`
      const MIRRORS = [
        'https://overpass-api.de/api/interpreter',
        'https://overpass.kumi.systems/api/interpreter',
        'https://overpass.openstreetmap.ru/api/interpreter',
      ]
      let data: { elements: Array<{ lat: number; lon: number; tags?: Record<string, string> }> } | null = null
      for (const mirror of MIRRORS) {
        try {
          const res = await fetch(`${mirror}?data=${encodeURIComponent(query)}`)
          if (res.ok) { data = await res.json(); break }
        } catch (_) {}
      }
      if (!data) throw new Error('All Overpass mirrors failed — try again later')

      const newPins: StationPin[] = (data.elements || [])
        .map(n => ({
          name: n.tags?.name || n.tags?.['name:en'] || 'Unnamed Station',
          lat: n.lat,
          lng: n.lon,
        }))
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
        stations: stations.map(s => ({ name: s.name, lat: s.lat, lng: s.lng })),
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

      setCreatedGame(result)
      setStep(6)
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
            <div ref={mapContainerRef} className={styles.mapContainer} />
            {editingStation && (
              <div className={styles.editOverlay}>
                <input className={styles.input} value={editName} onChange={e => setEditName(e.target.value)} autoFocus />
                <div className={styles.editBtns}>
                  <button className={styles.saveBtn} onClick={saveEditStation}>Save</button>
                  <button className={styles.dangerBtn} onClick={() => removeStation(editingStation.tempId)}>Remove</button>
                  <button className={styles.cancelBtn} onClick={() => setEditingStation(null)}>Cancel</button>
                </div>
              </div>
            )}
            <div className={styles.stationList}>
              {stations.map(p => (
                <div key={p.tempId} className={styles.stationItem}>
                  <span>{p.name}</span>
                  <div className={styles.stationItemBtns}>
                    <button className={styles.iconBtn} onClick={() => { setEditingStation(p); setEditName(p.name) }}>✎</button>
                    <button className={styles.iconBtnDanger} onClick={() => removeStation(p.tempId)}>✕</button>
                  </div>
                </div>
              ))}
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
            <p className={styles.hint}>Optional — challenges earn coins when completed.</p>
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
                      placeholder="— random —"
                      value={stationSearch}
                      onChange={e => { setStationSearch(e.target.value); setStationDropdownOpen(true) }}
                      onFocus={() => setStationDropdownOpen(true)}
                      onBlur={() => setTimeout(() => setStationDropdownOpen(false), 150)}
                    />
                    {stationDropdownOpen && (
                      <div className={styles.stationDropdown}>
                        <div className={styles.stationDropdownItem}
                          onMouseDown={() => { setNewPinnedStation(''); setStationSearch(''); setStationDropdownOpen(false) }}>
                          — random —
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
                  {c.stationTempId && <span>📍 {stations.find(s => s.tempId === c.stationTempId)?.name}</span>}
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
                      ⚠️ Very small challenge pool ({challenges.length} challenge{challenges.length !== 1 ? 's' : ''}). Consider adding more.
                    </p>
                  )}
                  {rewardTooLow && (
                    <p className={styles.warning}>
                      ⚠️ Total challenge rewards ({totalCoinReward}🪙) are less than half the coins in play ({Math.floor(totalCoinsInPlay * 0.5)}🪙). Players may run out of coins.
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

        {step === 6 && createdGame && (
          <div className={styles.stepPanel}>
            <h2 className={styles.stepTitle}>Game Ready!</h2>
            <p className={styles.hint}>Share this code with all players. They'll pick their team in the lobby.</p>
            <div className={styles.gameInviteBlock}>
              <span className={styles.gameInviteLabel}>Game Code</span>
              <span className={styles.gameInviteCode}>{createdGame.inviteCode}</span>
            </div>
            <p className={styles.hint} style={{ marginTop: '0.5rem' }}>Teams</p>
            {createdGame.teams.map(t => (
              <div key={t.id} className={styles.inviteCard} style={{ borderColor: t.color }}>
                <div className={styles.inviteTeamDot} style={{ background: t.color }} />
                <span className={styles.inviteTeamName}>{t.name}</span>
              </div>
            ))}
            <button className={styles.launchBtn} onClick={() => navigate(`/game/${createdGame.gameId}/lobby`)}>
              Open Lobby →
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
