import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import maplibregl from 'maplibre-gl'
import { pb, api } from '../lib/pb'
import { moveStation } from '../lib/api'
import { subscribeToGame } from '../lib/subscribe'
import { useGameStore, type Station, type Challenge } from '../store/gameStore'
import CoinHUD from '../components/CoinHUD'
import ScorePanel from '../components/ScorePanel'
import StationModal from '../components/StationModal'
import ChallengeModal from '../components/ChallengeModal'
import EventFeed from '../components/EventFeed'
import StationEditorOverlay from '../components/StationEditorOverlay'
import { GoChecklist } from 'react-icons/go'
import styles from './GameMap.module.css'

export default function GameMap() {
  const { gameId } = useParams<{ gameId: string }>()
  const navigate = useNavigate()
  const user = pb.authStore.model!

  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerMapRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const challengeMarkerMapRef = useRef<Map<string, maplibregl.Marker>>(new Map())

  const [isEditingMap, setIsEditingMap] = useState(false)
  const editStationHandlerRef = useRef<((id: string, x: number, y: number) => void) | null>(null)
  const isEditingMapRef = useRef(false)
  const dragHandlerMapRef = useRef<Map<string, (e: maplibregl.MapLibreEvent) => void>>(new Map())

  const [loading, setLoading] = useState(true)
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [myTeamId, setMyTeamId] = useState<string | null>(null)
  const [myTeamColor, setMyTeamColor] = useState('#1A6B6B')
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null)
  const [selectedChallengeId, setSelectedChallengeId] = useState<string | null>(null)
  const [showFeed, setShowFeed] = useState(false)
  const [ending, setEnding] = useState(false)

  const store = useGameStore()
  const game = store.game
  const selectedStation = selectedStationId ? (store.stations.find(s => s.id === selectedStationId) ?? null) : null
  const isHost = game?.hostUserId === user.id

  // Load initial game state
  useEffect(() => {
    if (!gameId) return
    const gid = gameId
    let cancelled = false
    let unsubscribe: (() => void) | null = null

    async function init() {
      try {
        const data = await api.get<{
          id: string; name: string; status: string; hostUserId: string
          startingCoins: number; maxStakeIncrement: number; tollCost: number
          maxActiveChallenges: number; requireHostApproval: boolean
          startedAt: string | null; endedAt: string | null
          teams: Array<{ id: string; name: string; color: string; coinBalance: number; currentLat: number|null; currentLng: number|null }>
          stations: Array<{ id: string; name: string; lat: number; lng: number; ownerTeamId: string|null; currentStake: number; stakeCeiling: number; isChallengeLocation: boolean; activeChallengeId: string|null; connectedTo: string[] }>
          challenges: Array<{ id: string; stationId: string|null; description: string; coinReward: number; difficulty: string; status: string; completedByTeamId: string|null; attemptingTeamId?: string|null; failedTeamIds?: string[] }>
        }>(`/api/rr/game/${gid}`)

        if (cancelled) return

        if (data.status === 'ended') { navigate(`/game/${gid}/end`); return }
        if (data.status === 'lobby') { navigate(`/game/${gid}/lobby`); return }

        store.setGame({
          id: data.id, name: data.name, status: data.status as 'active',
          hostUserId: data.hostUserId, startingCoins: data.startingCoins,
          maxStakeIncrement: data.maxStakeIncrement, tollCost: data.tollCost,
          maxActiveChallenges: data.maxActiveChallenges,
          requireHostApproval: data.requireHostApproval,
          startedAt: data.startedAt, endedAt: data.endedAt,
        })
        store.setTeams(data.teams.map(t => ({ ...t, gameId: gid, locationUpdatedAt: null })))
        store.setStations(data.stations.map(s => ({ ...s, gameId: gid, connectedTo: s.connectedTo ?? [] })))
        store.setChallenges(data.challenges.map(c => ({
          ...c, gameId: gid,
          difficulty: c.difficulty as 'easy'|'medium'|'hard',
          status: c.status as Challenge['status'],
          completedByTeamId: c.completedByTeamId,
          attemptingTeamId: c.attemptingTeamId ?? null,
          failedTeamIds: c.failedTeamIds ?? [],
        })))

        // Load recent events to seed the feed
        try {
          const eventsRes = await pb.collection('events').getList(1, 50, {
            filter: `game_id = "${gid}"`,
            sort: '-created',
            requestKey: null,
          })
          if (!cancelled) {
            store.setEventFeed(eventsRes.items.map(r => ({
              id: r.id,
              type: r['type'] as string,
              teamId: (r['team_id'] as string) || null,
              secondaryTeamId: (r['secondary_team_id'] as string) || null,
              stationId: (r['station_id'] as string) || null,
              challengeId: (r['challenge_id'] as string) || null,
              coinsInvolved: (r['coins_involved'] as number) ?? null,
              wasPartial: (r['was_partial'] as boolean) ?? null,
              meta: (r['meta'] as Record<string, unknown>) ?? null,
              created: r['created'] as string,
            })))
          }
        } catch (_) {
          // non-fatal — feed will still update via SSE
        }

        // Find my team — cross-reference approved memberships with this game's team IDs
        const gameTeamIds = new Set(data.teams.map(t => t.id))
        const memberRecs = await pb.collection('team_members').getList(1, 50, {
          filter: `user_id = "${user.id}" && approved_by_host = true`,
          requestKey: null,
        })

        if (cancelled) return

        const myMemberRec = memberRecs.items.find(m => gameTeamIds.has(m.team_id as string))
        if (myMemberRec) {
          const tid = myMemberRec.team_id as string
          setMyTeamId(tid)
          store.setMyTeamId(tid)
          const t = data.teams.find(x => x.id === tid)
          if (t) setMyTeamColor(t.color)
        }

        setLoading(false)

        // Subscribe to real-time updates
        unsubscribe = await subscribeToGame(gid)
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load game', err)
          setLoading(false)
        }
      }
    }

    async function applyGameState(gid: string) {
      const data = await api.get<{
        id: string; name: string; status: string; hostUserId: string
        startingCoins: number; maxStakeIncrement: number; tollCost: number
        maxActiveChallenges: number; requireHostApproval: boolean
        startedAt: string | null; endedAt: string | null
        teams: Array<{ id: string; name: string; color: string; coinBalance: number; currentLat: number|null; currentLng: number|null }>
        stations: Array<{ id: string; name: string; lat: number; lng: number; ownerTeamId: string|null; currentStake: number; stakeCeiling: number; isChallengeLocation: boolean; activeChallengeId: string|null; connectedTo: string[] }>
        challenges: Array<{ id: string; stationId: string|null; description: string; coinReward: number; difficulty: string; status: string; completedByTeamId: string|null; attemptingTeamId?: string|null; failedTeamIds?: string[] }>
      }>(`/api/rr/game/${gid}`)

      store.setGame({
        id: data.id, name: data.name, status: data.status as 'active',
        hostUserId: data.hostUserId, startingCoins: data.startingCoins,
        maxStakeIncrement: data.maxStakeIncrement, tollCost: data.tollCost,
        maxActiveChallenges: data.maxActiveChallenges,
        requireHostApproval: data.requireHostApproval,
        startedAt: data.startedAt, endedAt: data.endedAt,
      })
      store.setTeams(data.teams.map(t => ({ ...t, gameId: gid, locationUpdatedAt: null })))
      store.setStations(data.stations.map(s => ({ ...s, gameId: gid, connectedTo: s.connectedTo ?? [] })))
      store.setChallenges(data.challenges.map(c => ({
        ...c, gameId: gid,
        difficulty: c.difficulty as 'easy'|'medium'|'hard',
        status: c.status as Challenge['status'],
        completedByTeamId: c.completedByTeamId,
        attemptingTeamId: c.attemptingTeamId ?? null,
        failedTeamIds: c.failedTeamIds ?? [],
      })))
    }

    const handleOffline = () => setIsReconnecting(true)
    const handleOnline = async () => {
      try {
        await applyGameState(gid)
      } catch (_) {
        // best-effort — SSE events will continue to patch state once reconnected
      }
      if (!cancelled) setIsReconnecting(false)
    }
    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)

    init()
    return () => {
      cancelled = true
      unsubscribe?.()
      store.reset()
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
    }
  }, [gameId])

  // Watch for game_ended event
  useEffect(() => {
    if (game?.status === 'ended') navigate(`/game/${gameId}/end`)
  }, [game?.status])

  useEffect(() => { isEditingMapRef.current = isEditingMap }, [isEditingMap])

  // Init MapLibre after loading
  useEffect(() => {
    if (loading || !mapContainerRef.current || mapRef.current) return

    const stations = useGameStore.getState().stations
    if (!stations.length) return

    // Center on first station
    const center = stations[0]
    if (center.lat == null || center.lng == null) return
const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: 'https://tiles.openfreemap.org/styles/positron',
      center: [center.lng, center.lat],
      zoom: 12,
    })

    // Apply warm map filter and add connection line layers
    map.on('load', () => {
      map.getCanvas().style.filter = 'sepia(30%) saturate(80%) brightness(95%)'
      map.addSource('station-connections', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      // Border layer — team color when both endpoints share an owner, otherwise neutral
      map.addLayer({ id: 'conn-bg', type: 'line', source: 'station-connections',
        paint: { 'line-color': ['coalesce', ['get', 'teamColor'], '#8A7F72'], 'line-width': 10 } })
      // White fill layer on top of black
      map.addLayer({ id: 'conn-fg', type: 'line', source: 'station-connections',
        paint: { 'line-color': '#ffffff', 'line-width': 3 } })
      renderMarkers(map)
    })

    mapRef.current = map

    return () => { map.remove(); mapRef.current = null }
  }, [loading])

  // Re-render markers when stations/challenges change
  useEffect(() => {
    if (!mapRef.current) return
    renderMarkers(mapRef.current)
  }, [store.stations, store.challenges])

  // Enable/disable marker dragging when edit mode is toggled
  useEffect(() => {
    for (const [stationId, marker] of markerMapRef.current) {
      if (isEditingMap) {
        marker.setDraggable(true)
        if (!dragHandlerMapRef.current.has(stationId)) {
          const handler = (_e: maplibregl.MapLibreEvent) => {
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

  function renderMarkers(map: maplibregl.Map) {
    const { stations, challenges, teams } = useGameStore.getState()

    // Connection lines
    const connSrc = map.getSource('station-connections') as maplibregl.GeoJSONSource | undefined
    if (connSrc) {
      const stationsById = new Map(stations.map(s => [s.id, s]))
      const teamsById = new Map(teams.map(t => [t.id, t]))
      const seen = new Set<string>()
      const features = stations.flatMap(s =>
        (s.connectedTo ?? []).flatMap(neighborId => {
          const key = [s.id, neighborId].sort().join(':')
          if (seen.has(key)) return []
          seen.add(key)
          const nb = stationsById.get(neighborId)
          if (!nb) return []
          const sharedOwner = s.ownerTeamId && nb.ownerTeamId && s.ownerTeamId === nb.ownerTeamId
            ? s.ownerTeamId : null
          const teamColor = sharedOwner ? (teamsById.get(sharedOwner)?.color ?? null) : null
          return [{ type: 'Feature' as const, geometry: { type: 'LineString' as const,
            coordinates: [[s.lng, s.lat], [nb.lng, nb.lat]] }, properties: { teamColor } }]
        })
      )
      connSrc.setData({ type: 'FeatureCollection', features })
    }

    // Station markers
    for (const station of stations) {
      if (station.lat == null || station.lng == null) continue
      const owner = teams.find(t => t.id === station.ownerTeamId)
      const color = owner?.color ?? null

      if (markerMapRef.current.has(station.id)) {
        // Update existing marker color
        const el = markerMapRef.current.get(station.id)!.getElement()
        const dot = el.querySelector('.station-dot') as HTMLElement | null
        if (dot) {
          dot.style.background = color ?? '#ffffff'
          dot.style.border = color ? 'none' : '2.5px solid #8A7F72'
          dot.style.animation = color ? 'none' : 'dashRotate 3s linear infinite'
        }
      } else {
        const el = document.createElement('div')
        el.className = styles.stationMarker

        const dot = document.createElement('div')
        dot.className = `station-dot ${styles.stationDot}`
        dot.style.background = color ?? '#ffffff'
        dot.style.border = color ? '3px solid rgba(255,255,255,0.8)' : '3px solid #8A7F72'
        el.appendChild(dot)

        el.addEventListener('click', (e) => {
          e.stopPropagation()
          if (editStationHandlerRef.current) {
            const rect = (e.target as HTMLElement).getBoundingClientRect()
            editStationHandlerRef.current(station.id, rect.left + rect.width / 2, rect.top)
          } else {
            setSelectedStationId(station.id)
          }
        })

        const draggable = isEditingMapRef.current
        const marker = new maplibregl.Marker({ element: el, draggable })
          .setLngLat([station.lng, station.lat])
          .addTo(map)

        if (draggable) {
          const handler = (_e: maplibregl.MapLibreEvent) => {
            const { lat, lng } = marker.getLngLat()
            moveStation(station.id, lat, lng).catch(() => {})
          }
          dragHandlerMapRef.current.set(station.id, handler)
          marker.on('dragend', handler)
        }

        markerMapRef.current.set(station.id, marker)
      }

    }

    // Remove markers for stations that no longer exist
    const currentStationIds = new Set(stations.map(s => s.id))
    for (const [sid, marker] of markerMapRef.current) {
      if (!currentStationIds.has(sid)) {
        marker.remove()
        markerMapRef.current.delete(sid)
        dragHandlerMapRef.current.delete(sid)
      }
    }

    // Challenge badges — driven from active challenges so new draws appear
    // as soon as the challenge SSE arrives (no need to wait for station update too)
    const activeChallenges = challenges.filter(c => c.status === 'active' && c.stationId)
    for (const challenge of activeChallenges) {
      if (challengeMarkerMapRef.current.has(challenge.id)) continue
      const station = stations.find(s => s.id === challenge.stationId)
      if (!station || station.lat == null || station.lng == null) continue
      const el = document.createElement('div')
      el.className = styles.challengeBadge
      el.textContent = `▽${challenge.coinReward}`
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        setSelectedChallengeId(challenge.id)
      })
      const marker = new maplibregl.Marker({ element: el, anchor: 'top-left', offset: [8, 8] })
        .setLngLat([station.lng, station.lat])
        .addTo(map)
      challengeMarkerMapRef.current.set(challenge.id, marker)
    }

    // Remove badges for challenges that are no longer active
    const activeChallengeIds = new Set(activeChallenges.map(c => c.id))
    for (const [cid, marker] of challengeMarkerMapRef.current) {
      if (!activeChallengeIds.has(cid)) {
        marker.remove()
        challengeMarkerMapRef.current.delete(cid)
      }
    }
  }

  async function handleEndGame() {
    if (!window.confirm('End the game now? This cannot be undone.')) return
    setEnding(true)
    try {
      await api.post(`/api/rr/game/${gameId}/end`)
      navigate(`/game/${gameId}/end`)
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to end game')
      setEnding(false)
    }
  }

  const myTeam = store.teams.find(t => t.id === myTeamId)
  const myBalance = myTeam?.coinBalance ?? 0

  if (loading) return (
    <div className={styles.loading}>
      <div className={styles.loadingSpinner} />
      <p>Loading game…</p>
    </div>
  )

  return (
    <div className={styles.root}>
      {/* Reconnecting banner */}
      {isReconnecting && (
        <div className={styles.reconnectingBanner}>
          Reconnecting…
        </div>
      )}

      {/* Map */}
      <div ref={mapContainerRef} className={styles.map} />

      {/* HUD overlays */}
      <div className={styles.topLeft}>
        <CoinHUD balance={myBalance} />
      </div>

      <div className={styles.topRight}>
        <button className={styles.feedToggle} onClick={() => setShowFeed(o => !o)}>
          {showFeed ? '✕' : <GoChecklist />}
        </button>
        {isHost && (
          <button
            className={styles.editMapBtn}
            onClick={() => { setIsEditingMap(o => !o); setSelectedStationId(null) }}
          >
            {isEditingMap ? 'Editing…' : 'Edit Map'}
          </button>
        )}
        {isHost && (
          <button className={styles.endBtn} onClick={handleEndGame} disabled={ending}>
            {ending ? '…' : 'End Game'}
          </button>
        )}
      </div>

      {/* Score panel */}
      <ScorePanel />

      {/* Event feed drawer */}
      {showFeed && (
        <div className={styles.feedDrawer}>
          <EventFeed onClose={() => setShowFeed(false)} />
        </div>
      )}

      {/* Station modal */}
      {selectedStationId && myTeamId && game && (() => {
        const selectedStation = store.stations.find(s => s.id === selectedStationId) ?? null
        return selectedStation ? (
          <StationModal
            station={selectedStation}
            myTeamId={myTeamId}
            tollCost={game.tollCost}
            maxStakeIncrement={game.maxStakeIncrement}
            onClose={() => setSelectedStationId(null)}
            onChallengeOpen={(c) => { setSelectedChallengeId(c.id); setSelectedStationId(null) }}
          />
        ) : null
      })()
      }

      {/* Challenge modal */}
      {selectedChallengeId && myTeamId && (() => {
        const liveChallenge = store.challenges.find(c => c.id === selectedChallengeId)
        if (!liveChallenge) return null
        return (
          <ChallengeModal
            challenge={liveChallenge}
            myTeamId={myTeamId}
            isHost={isHost}
            onClose={() => setSelectedChallengeId(null)}
          />
        )
      })()}

      {/* Station editor overlay (host only) */}
      {isEditingMap && isHost && (
        <StationEditorOverlay
          gameId={gameId!}
          mapRef={mapRef}
          editStationHandlerRef={editStationHandlerRef}
          onClose={() => setIsEditingMap(false)}
        />
      )}
    </div>
  )
}
