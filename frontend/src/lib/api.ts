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
  startedAt: string | null
  endedAt: string | null
  teams: {
    id: string; name: string; color: string; coinBalance: number
    currentLat: number | null; currentLng: number | null
  }[]
  stations: {
    id: string; name: string; lat: number; lng: number
    ownerTeamId: string | null; currentStake: number; stakeCeiling: number
    isChallengeLocation: boolean; activeChallengeId: string | null
  }[]
  challenges: {
    id: string; stationId: string | null; description: string
    coinReward: number; difficulty: string; status: string
    completedByTeamId: string | null
    attemptingTeamId?: string | null
    failedTeamIds?: string[]
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
  startingCoins: number
  maxStakeIncrement?: number
  tollCost?: number
  maxActiveChallenges?: number
  requireHostApproval?: boolean
  teams: { name: string; color: string }[]
}) => api.post<{ gameId: string; inviteCode: string; teams: { id: string; name: string; color: string }[] }>('/api/rr/game', body)

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

export const stakeStation = (stationId: string, teamId: string, stake: number) =>
  api.post<{ ok: boolean; newBalance: number; stake: number; prevTeamId?: string }>(`/api/rr/station/${stationId}/stake`, { teamId, stake })

export const payToll = (stationId: string, teamId: string) =>
  api.post<{ ok: boolean; coinsPaid: number; wasPartial: boolean; newBalance: number }>(`/api/rr/station/${stationId}/toll`, { teamId })

export const reinforceStation = (stationId: string, teamId: string, coins: number) =>
  api.post<{ ok: boolean; newBalance: number; newStake: number; stakeCeiling: number }>(
    `/api/rr/station/${stationId}/reinforce`, { teamId, coins }
  )

export const addStation = (gameId: string, body: { name: string; lat: number; lng: number }) =>
  api.post<{ id: string; name: string; lat: number; lng: number }>(`/api/rr/game/${gameId}/station/add`, body)

export const deleteStation = (stationId: string) =>
  api.delete<{ ok: boolean; coinsRefunded: number; refundedTeamId: string | null }>(`/api/rr/station/${stationId}`)

export const connectStations = (stationId: string, neighborId: string) =>
  api.post<{ ok: boolean }>(`/api/rr/station/${stationId}/connect`, { neighborId })

export const disconnectStations = (stationId: string, neighborId: string) =>
  api.post<{ ok: boolean }>(`/api/rr/station/${stationId}/disconnect`, { neighborId })

export const moveStation = (stationId: string, lat: number, lng: number) =>
  api.patch<{ ok: boolean }>(`/api/rr/station/${stationId}/move`, { lat, lng })

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

export const claimChallenge = (challengeId: string, teamId: string) =>
  api.post<{ ok: boolean }>(`/api/rr/challenge/${challengeId}/claim`, { teamId })

// ── Location ──────────────────────────────────────────────────────────────────

export const updateLocation = (teamId: string, lat: number, lng: number) =>
  api.patch<{ ok: boolean }>(`/api/rr/team/${teamId}/location`, { lat, lng })

// ── Map templates ─────────────────────────────────────────────────────────────

// StationPin shared type — local to HostSetup.tsx but re-declared here so
// MapTemplateDetail and MapGallery can reference it without a circular import.
export interface StationPin {
  name: string
  lat: number
  lng: number
  tempId: string
  osmNodeId?: number
}

export interface MapTemplateSummary {
  id: string
  name: string
  cityName: string | null
  stationCount: number
  timesUsed: number
}

export interface MapTemplateDetail {
  id: string
  name: string
  cityName: string | null
  mapBounds: [[number, number], [number, number]]
  stations: StationPin[]
  connections: [string, string][]
  stationCount: number
  timesUsed: number
}

export const listMaps = (search: string, limit: number, offset: number) => {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (search) params.set('search', search)
  return api.get<MapTemplateSummary[]>(`/api/rr/maps?${params}`)
}

export const getMap = (id: string) =>
  api.get<MapTemplateDetail>(`/api/rr/maps/${id}`)

export const saveMap = (body: {
  name: string
  cityName?: string
  mapBounds: [[number, number], [number, number]]
  stations: StationPin[]
  connections: [string, string][]
}) => api.post<{ id: string }>('/api/rr/maps', body)
