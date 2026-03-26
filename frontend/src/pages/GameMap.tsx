import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import maplibregl from 'maplibre-gl'
import { pb, api } from '../lib/pb'
import { subscribeToGame } from '../lib/subscribe'
import { useGameStore, type Station, type Challenge } from '../store/gameStore'
import CoinHUD from '../components/CoinHUD'
import ScorePanel from '../components/ScorePanel'
import StationModal from '../components/StationModal'
import ChallengeModal from '../components/ChallengeModal'
import EventFeed from '../components/EventFeed'
import styles from './GameMap.module.css'

export default function GameMap() {
  const { gameId } = useParams<{ gameId: string }>()
  const navigate = useNavigate()
  const user = pb.authStore.model!

  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markerMapRef = useRef<Map<string, maplibregl.Marker>>(new Map())
  const challengeMarkerMapRef = useRef<Map<string, maplibregl.Marker>>(new Map())

  const [loading, setLoading] = useState(true)
  const [myTeamId, setMyTeamId] = useState<string | null>(null)
  const [myTeamColor, setMyTeamColor] = useState('#1A6B6B')
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null)
  const [selectedChallenge, setSelectedChallenge] = useState<Challenge | null>(null)
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
          expectedEndTime: string | null; startedAt: string | null; endedAt: string | null
          teams: Array<{ id: string; name: string; color: string; coinBalance: number; inviteCode: string; currentLat: number|null; currentLng: number|null }>
          stations: Array<{ id: string; name: string; lat: number; lng: number; ownerTeamId: string|null; currentStake: number; isChallengeLocation: boolean; activeChallengeId: string|null }>
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
          expectedEndTime: data.expectedEndTime, startedAt: data.startedAt, endedAt: data.endedAt,
        })
        store.setTeams(data.teams.map(t => ({ ...t, gameId: gid, locationUpdatedAt: null })))
        store.setStations(data.stations.map(s => ({ ...s, gameId: gid })))
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

    init()
    return () => { cancelled = true; unsubscribe?.(); store.reset() }
  }, [gameId])

  // Watch for game_ended event
  useEffect(() => {
    if (game?.status === 'ended') navigate(`/game/${gameId}/end`)
  }, [game?.status])

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

    // Apply warm map filter
    map.on('load', () => {
      map.getCanvas().style.filter = 'sepia(30%) saturate(80%) brightness(95%)'
    })

    mapRef.current = map
    renderMarkers(map)

    return () => { map.remove(); mapRef.current = null }
  }, [loading])

  // Re-render markers when stations/challenges change
  useEffect(() => {
    if (!mapRef.current) return
    renderMarkers(mapRef.current)
  }, [store.stations, store.challenges])

  function renderMarkers(map: maplibregl.Map) {
    const { stations, challenges, teams } = useGameStore.getState()

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
          dot.style.border = color ? 'none' : '2.5px dashed #8A7F72'
          dot.style.animation = color ? 'none' : 'dashRotate 3s linear infinite'
        }
      } else {
        const el = document.createElement('div')
        el.className = styles.stationMarker

        const dot = document.createElement('div')
        dot.className = `station-dot ${styles.stationDot}`
        dot.style.background = color ?? '#ffffff'
        dot.style.border = color ? '2.5px solid rgba(255,255,255,0.8)' : '2.5px dashed #8A7F72'
        el.appendChild(dot)

        el.addEventListener('click', (e) => {
          e.stopPropagation()
          setSelectedStationId(station.id)
        })

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([station.lng, station.lat])
          .addTo(map)

        markerMapRef.current.set(station.id, marker)
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
        setSelectedChallenge(challenge)
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
      {/* Map */}
      <div ref={mapContainerRef} className={styles.map} />

      {/* HUD overlays */}
      <div className={styles.topLeft}>
        <CoinHUD balance={myBalance} />
      </div>

      <div className={styles.topRight}>
        <button className={styles.feedToggle} onClick={() => setShowFeed(o => !o)}>
          {showFeed ? '✕' : '📋'}
        </button>
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
            onChallengeOpen={(c) => { setSelectedChallenge(c); setSelectedStationId(null) }}
          />
        ) : null
      })()
      }

      {/* Challenge modal */}
      {selectedChallenge && myTeamId && (
        <ChallengeModal
          challenge={selectedChallenge}
          myTeamId={myTeamId}
          isHost={isHost}
          onClose={() => setSelectedChallenge(null)}
        />
      )}
    </div>
  )
}
