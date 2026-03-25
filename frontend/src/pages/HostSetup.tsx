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
  const [expectedEnd, setExpectedEnd] = useState('')

  // Step 2
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const [stations, setStations] = useState<StationPin[]>([])
  const stationsRef = useRef<StationPin[]>([])
  const [editingStation, setEditingStation] = useState<StationPin | null>(null)
  const [editName, setEditName] = useState('')

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

  // Init map when step 2 is active
  useEffect(() => {
    if (step !== 2 || !mapContainerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: 'https://tiles.openfreemap.org/styles/positron',
      center: [-0.118, 51.509],
      zoom: 12,
    })
    mapRef.current = map

    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    map.on('click', (e) => {
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
        expectedEndTime: expectedEnd || undefined,
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
            <label className={styles.label}>Expected end time (optional)</label>
            <input className={styles.input} type="datetime-local" value={expectedEnd}
              onChange={e => setExpectedEnd(e.target.value)} />
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
                  <button className={styles.iconBtn} onClick={() => { setEditingStation(p); setEditName(p.name) }}>✎</button>
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
            <input className={styles.input} type="number" min={5} max={100} value={startingCoins}
              onChange={e => setStartingCoins(+e.target.value)} />
            <label className={styles.label}>Toll cost (default 3)</label>
            <input className={styles.input} type="number" min={0} max={20} value={tollCost}
              onChange={e => setTollCost(+e.target.value)} />
            <label className={styles.label}>Max stake increment when contesting (default 5)</label>
            <input className={styles.input} type="number" min={1} max={20} value={maxStakeIncrement}
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
                  <select className={styles.inputSm} value={newPinnedStation}
                    onChange={e => setNewPinnedStation(e.target.value)}>
                    <option value="">— random —</option>
                    {stations.map(s => <option key={s.tempId} value={s.tempId}>{s.name}</option>)}
                  </select>
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
