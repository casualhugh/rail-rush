import { pb } from './pb'
import { useGameStore } from '../store/gameStore'

type UnsubscribeFn = () => void

/**
 * Subscribe to all real-time updates for a game session.
 * Returns an unsubscribe function — call it on cleanup.
 *
 * Subscribes to:
 * - events collection (game actions, challenge events, game start/end)
 * - teams collection (coin balance changes, location updates)
 * - stations collection (ownership changes)
 * - challenges collection (status changes)
 * - team_members collection (lobby approvals)
 */
export async function subscribeToGame(gameId: string): Promise<UnsubscribeFn> {
  const store = useGameStore.getState()
  const unsubs: UnsubscribeFn[] = []

  // ── Events (main game feed) ───────────────────────────────────────────────
  const unsubEvents = await pb.collection('events').subscribe('*', (e) => {
    if (e.record.game_id !== gameId) return
    store.handleEvent(e.record)
  })
  unsubs.push(unsubEvents)

  // ── Teams (coin balances + location) ─────────────────────────────────────
  const unsubTeams = await pb.collection('teams').subscribe('*', (e) => {
    if (e.record.game_id !== gameId) return
    store.updateTeam(e.record)
  })
  unsubs.push(unsubTeams)

  // ── Stations (ownership changes) ─────────────────────────────────────────
  const unsubStations = await pb.collection('stations').subscribe('*', (e) => {
    if (e.record.game_id !== gameId) return
    store.updateStation(e.record)
  })
  unsubs.push(unsubStations)

  // ── Challenges (status changes) ──────────────────────────────────────────
  const unsubChallenges = await pb.collection('challenges').subscribe('*', (e) => {
    if (e.record.game_id !== gameId) return
    store.updateChallenge(e.record)
  })
  unsubs.push(unsubChallenges)

  // ── TeamMembers (lobby approvals) ─────────────────────────────────────────
  const unsubMembers = await pb.collection('team_members').subscribe('*', (e) => {
    store.updateTeamMember(e.record)
  })
  unsubs.push(unsubMembers)

  return () => { unsubs.forEach(fn => fn()) }
}
