import { api } from './pb'

// ── Shared types ──────────────────────────────────────────────────────────────

export interface GameState {
  id: string
  name: string
  status: 'lobby' | 'active' | 'ended'
  hostUserId: string
  startingCoins: number
  maxStakeIncrement: number
  tollCost: number
  maxActiveChallenges: number
  requireHostApproval: boolean
  expectedEndTime: string | null
  startedAt: string | null
  endedAt: string | null
  teams: {
    id: string; name: string; color: string; coinBalance: number
    inviteCode: string; currentLat: number | null; currentLng: number | null
  }[]
  stations: {
    id: string; name: string; lat: number; lng: number
    ownerTeamId: string | null; currentStake: number
    isChallengeLocation: boolean; activeChallengeId: string | null
  }[]
  challenges: {
    id: string; stationId: string | null; description: string
    coinReward: number; difficulty: string; status: string
    completedByTeamId: string | null
  }[]
}

export interface ChallengeInput {
  description: string
  coinReward?: number
  difficulty?: 'easy' | 'medium' | 'hard'
  stationId?: string
}

// ── Game lifecycle ────────────────────────────────────────────────────────────

export const getGame = (gameId: string) =>
  api.get<GameState>(`/api/rr/game/${gameId}`)

export const createGame = (body: {
  name: string
  cityName?: string
  expectedEndTime?: string
  startingCoins: number
  maxStakeIncrement?: number
  tollCost?: number
  maxActiveChallenges?: number
  requireHostApproval?: boolean
  teams: { name: string; color: string }[]
}) => api.post<{ gameId: string; teams: { id: string; name: string; color: string; inviteCode: string }[] }>('/api/rr/game', body)

export const startGame = (gameId: string) =>
  api.post<{ ok: boolean; challengesDrawn: number }>(`/api/rr/game/${gameId}/start`)

export const endGame = (gameId: string) =>
  api.post<{ scores: { teamId: string; teamName: string; color: string; stationCount: number; totalStaked: number; coinBalance: number; rank: number }[] }>(`/api/rr/game/${gameId}/end`)

// ── Lobby ─────────────────────────────────────────────────────────────────────

export const joinGame = (gameId: string, teamId: string) =>
  api.post<{ memberId: string }>(`/api/rr/game/${gameId}/join`, { teamId })

export const approveMember = (gameId: string, memberId: string) =>
  api.post<{ ok: boolean }>(`/api/rr/game/${gameId}/approve/${memberId}`)

export const denyMember = (gameId: string, memberId: string) =>
  api.post<{ ok: boolean }>(`/api/rr/game/${gameId}/deny/${memberId}`)

// ── Game setup ────────────────────────────────────────────────────────────────

export const saveStations = (gameId: string, stations: { name: string; lat: number; lng: number }[]) =>
  api.post<{ created: number; stations: { id: string; name: string; lat: number; lng: number }[] }>(`/api/rr/game/${gameId}/stations`, stations)

export const saveChallenges = (gameId: string, challenges: ChallengeInput[]) =>
  api.post<{ created: number; ids: string[] }>(`/api/rr/game/${gameId}/challenges`, challenges)

// ── Stations ──────────────────────────────────────────────────────────────────

export const claimStation = (stationId: string, teamId: string, coins: number) =>
  api.post<{ ok: boolean; newBalance: number; stake: number }>(`/api/rr/station/${stationId}/claim`, { teamId, coins })

export const contestStation = (stationId: string, teamId: string, newStake: number) =>
  api.post<{ ok: boolean; newBalance: number; newStake: number; prevTeamId: string }>(`/api/rr/station/${stationId}/contest`, { teamId, newStake })

export const payToll = (stationId: string, teamId: string) =>
  api.post<{ ok: boolean; coinsPaid: number; wasPartial: boolean; newBalance: number }>(`/api/rr/station/${stationId}/toll`, { teamId })

export const getStationCeiling = (stationId: string) =>
  api.get<{ currentStake: number; stakeCeiling: number }>(`/api/rr/station/${stationId}/ceiling`)

export const reinforceStation = (stationId: string, teamId: string, coins: number) =>
  api.post<{ ok: boolean; newBalance: number; newStake: number; stakeCeiling: number }>(
    `/api/rr/station/${stationId}/reinforce`, { teamId, coins }
  )

// ── Challenges ────────────────────────────────────────────────────────────────

export const completeChallenge = (challengeId: string, teamId: string) =>
  api.post<{ ok: boolean; status: string; coinsAwarded?: number }>(`/api/rr/challenge/${challengeId}/complete`, { teamId })

export const failChallenge = (challengeId: string, teamId: string) =>
  api.post<{ ok: boolean }>(`/api/rr/challenge/${challengeId}/fail`, { teamId })

export const approveChallenge = (challengeId: string) =>
  api.post<{ ok: boolean; coinsAwarded: number }>(`/api/rr/challenge/${challengeId}/approve`)

export const rejectChallenge = (challengeId: string, reason?: string) =>
  api.post<{ ok: boolean }>(`/api/rr/challenge/${challengeId}/reject`, { reason: reason ?? '' })

export const markChallengeImpossible = (challengeId: string) =>
  api.post<{ ok: boolean }>(`/api/rr/challenge/${challengeId}/impossible`)

// ── Location ──────────────────────────────────────────────────────────────────

export const updateLocation = (teamId: string, lat: number, lng: number) =>
  api.patch<{ ok: boolean }>(`/api/rr/team/${teamId}/location`, { lat, lng })
