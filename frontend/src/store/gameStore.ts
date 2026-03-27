import { create } from 'zustand'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GameInfo {
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
}

export interface Team {
  id: string
  gameId: string
  name: string
  color: string
  coinBalance: number
  currentLat: number | null
  currentLng: number | null
  locationUpdatedAt: string | null
}

export interface Station {
  id: string
  gameId: string
  name: string
  lat: number
  lng: number
  ownerTeamId: string | null
  currentStake: number
  isChallengeLocation: boolean
  activeChallengeId: string | null
}

export interface Challenge {
  id: string
  gameId: string
  stationId: string | null
  description: string
  coinReward: number
  difficulty: 'easy' | 'medium' | 'hard'
  status: 'undrawn' | 'active' | 'pending_approval' | 'completed' | 'failed' | 'impossible'
  completedByTeamId: string | null
  attemptingTeamId: string | null
  failedTeamIds: string[]
}

export interface TeamMember {
  id: string
  teamId: string
  userId: string
  role: 'captain' | 'member'
  approvedByHost: boolean
  joinedAt: string
}

export interface EventFeedItem {
  id: string
  type: string
  teamId: string | null
  secondaryTeamId: string | null
  stationId: string | null
  challengeId: string | null
  coinsInvolved: number | null
  wasPartial: boolean | null
  meta: Record<string, unknown> | null
  created: string
}

export interface FinalScore {
  teamId: string
  teamName: string
  color: string
  stationCount: number
  totalStaked: number
  coinBalance: number
  rank: number
}

// ── Store ─────────────────────────────────────────────────────────────────────

interface GameStore {
  // State
  game: GameInfo | null
  teams: Team[]
  stations: Station[]
  challenges: Challenge[]
  teamMembers: TeamMember[]
  eventFeed: EventFeedItem[]
  finalScores: FinalScore[] | null
  myTeamId: string | null

  // Setters — called on initial load
  setGame: (game: GameInfo) => void
  setTeams: (teams: Team[]) => void
  setStations: (stations: Station[]) => void
  setChallenges: (challenges: Challenge[]) => void
  setTeamMembers: (members: TeamMember[]) => void
  setEventFeed: (items: EventFeedItem[]) => void
  setMyTeamId: (teamId: string | null) => void
  reset: () => void

  patchChallenge: (id: string, patch: Partial<Challenge>) => void

  // Real-time SSE handlers
  handleEvent: (record: Record<string, unknown>) => void
  updateTeam: (record: Record<string, unknown>) => void
  updateStation: (record: Record<string, unknown>) => void
  updateChallenge: (record: Record<string, unknown>) => void
  updateTeamMember: (record: Record<string, unknown>) => void
}

// ── Helper: map PB records to typed objects ───────────────────────────────────

function recordToTeam(r: Record<string, unknown>): Team {
  return {
    id: r.id as string,
    gameId: r.game_id as string,
    name: r.name as string,
    color: r.color as string,
    coinBalance: (r.coin_balance as number) ?? 0,
    currentLat: (r.current_lat as number) ?? null,
    currentLng: (r.current_lng as number) ?? null,
    locationUpdatedAt: (r.location_updated_at as string) ?? null,
  }
}

function recordToStation(r: Record<string, unknown>): Station {
  return {
    id: r.id as string,
    gameId: (r.game_id as string) ?? '',
    name: r.name as string,
    lat: r.lat as number,
    lng: r.lng as number,
    ownerTeamId: (r.current_owner_team_id as string) || null,
    currentStake: (r.current_stake as number) ?? 0,
    isChallengeLocation: (r.is_challenge_location as boolean) ?? false,
    activeChallengeId: (r.active_challenge_id as string) || null,
  }
}

function recordToChallenge(r: Record<string, unknown>): Challenge {
  return {
    id: r.id as string,
    gameId: (r.game_id as string) ?? '',
    stationId: (r.station_id as string) || null,
    description: r.description as string,
    coinReward: (r.coin_reward as number) ?? 0,
    difficulty: (r.difficulty as Challenge['difficulty']) ?? 'medium',
    status: (r.status as Challenge['status']) ?? 'undrawn',
    completedByTeamId: (r.completed_by_team_id as string) || null,
    attemptingTeamId: (r.attempting_team_id as string) || null,
    failedTeamIds: Array.isArray(r.failed_team_ids) ? (r.failed_team_ids as string[]) : [],
  }
}

function recordToMember(r: Record<string, unknown>): TeamMember {
  return {
    id: r.id as string,
    teamId: r.team_id as string,
    userId: r.user_id as string,
    role: (r.role as TeamMember['role']) ?? 'member',
    approvedByHost: (r.approved_by_host as boolean) ?? false,
    joinedAt: (r.joined_at as string) ?? '',
  }
}

// ── Store implementation ──────────────────────────────────────────────────────

export const useGameStore = create<GameStore>((set, get) => ({
  game: null,
  teams: [],
  stations: [],
  challenges: [],
  teamMembers: [],
  eventFeed: [],
  finalScores: null,
  myTeamId: null,

  setGame: (game) => set({ game }),
  setTeams: (teams) => set({ teams }),
  setStations: (stations) => set({ stations }),
  setChallenges: (challenges) => set({ challenges }),
  setTeamMembers: (members) => set({ teamMembers: members }),
  setEventFeed: (items) => set({ eventFeed: items }),
  patchChallenge: (id, patch) => set(s => ({
    challenges: s.challenges.map(c => c.id === id ? { ...c, ...patch } : c),
  })),
  setMyTeamId: (teamId) => set({ myTeamId: teamId }),

  reset: () => set({
    game: null, teams: [], stations: [], challenges: [],
    teamMembers: [], eventFeed: [], finalScores: null, myTeamId: null,
  }),

  // Real-time: add to event feed + handle game_ended special case
  handleEvent: (record) => {
    const item: EventFeedItem = {
      id: record.id as string,
      type: record.type as string,
      teamId: (record.team_id as string) || null,
      secondaryTeamId: (record.secondary_team_id as string) || null,
      stationId: (record.station_id as string) || null,
      challengeId: (record.challenge_id as string) || null,
      coinsInvolved: (record.coins_involved as number) ?? null,
      wasPartial: (record.was_partial as boolean) ?? null,
      meta: (record.meta as Record<string, unknown>) ?? null,
      created: record.created as string,
    }

    set(s => ({ eventFeed: [item, ...s.eventFeed].slice(0, 200) }))

    // Handle game-level state transitions
    if (item.type === 'game_started') {
      set(s => ({ game: s.game ? { ...s.game, status: 'active' } : s.game }))
    }
    if (item.type === 'game_ended') {
      const scores = (item.meta?.final_scores as FinalScore[]) ?? null
      set(s => ({
        game: s.game ? { ...s.game, status: 'ended' } : s.game,
        finalScores: scores,
      }))
    }
  },

  updateTeam: (record) => {
    const updated = recordToTeam(record)
    set(s => ({
      teams: s.teams.some(t => t.id === updated.id)
        ? s.teams.map(t => t.id === updated.id ? updated : t)
        : [...s.teams, updated],
    }))
  },

  updateStation: (record) => {
    const updated = recordToStation(record)
    set(s => ({
      stations: s.stations.some(st => st.id === updated.id)
        ? s.stations.map(st => st.id === updated.id ? updated : st)
        : [...s.stations, updated],
    }))
  },

  updateChallenge: (record) => {
    const updated = recordToChallenge(record)
    set(s => ({
      challenges: s.challenges.some(c => c.id === updated.id)
        ? s.challenges.map(c => c.id === updated.id ? updated : c)
        : [...s.challenges, updated],
    }))
  },

  updateTeamMember: (record) => {
    const updated = recordToMember(record)
    set(s => {
      const isKnownTeam = s.teams.some(t => t.id === updated.teamId)
      if (!isKnownTeam && !s.teamMembers.some(m => m.id === updated.id)) return s
      return {
        teamMembers: s.teamMembers.some(m => m.id === updated.id)
          ? s.teamMembers.map(m => m.id === updated.id ? updated : m)
          : [...s.teamMembers, updated],
      }
    })
  },
}))
