import { useState, useEffect, useRef } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { QRCodeSVG } from 'qrcode.react'
import { pb, api } from '../lib/pb'
import styles from './Lobby.module.css'

interface GameData {
  id: string
  name: string
  status: string
  hostUserId: string
  inviteCode: string
  teams: Array<{ id: string; name: string; color: string }>
}

interface MemberRecord {
  id: string
  team_id: string
  user_id: string
  display_name: string
  approved_by_host: boolean
  joined_at: string
}

export default function Lobby() {
  const { gameId } = useParams<{ gameId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const user = pb.authStore.model!

  const [game, setGame] = useState<GameData | null>(null)
  const [members, setMembers] = useState<MemberRecord[]>([])
  const [myMember, setMyMember] = useState<MemberRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const [showQR, setShowQR] = useState(false)
  const unsubRef = useRef<Array<() => void>>([])
  const teamIdsRef = useRef<string[]>([])

  const isHost = game?.hostUserId === user.id

  useEffect(() => {
    if (!gameId) return
    init()
    return () => { unsubRef.current.forEach(fn => fn()) }
  }, [gameId])

  async function init() {
    try {
      // Load game state
      const g = await api.get<GameData>(`/api/rr/game/${gameId}`)
      teamIdsRef.current = g.teams.map(t => t.id)
      setGame(g)

      // If game already started, redirect
      if (g.status === 'active') { navigate(`/game/${gameId}`); return }
      if (g.status === 'ended') { navigate(`/game/${gameId}/end`); return }

      await loadMembers()
      subscribeToLobby()
    } catch (err) {
      setError('Failed to load lobby')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  async function loadMembers() {
    const ids = teamIdsRef.current
    if (ids.length === 0) { setMembers([]); return }
    const filter = ids.map(id => `team_id = "${id}"`).join(' || ')
    const res = await pb.collection('team_members').getList(1, 100, {
      filter,
      requestKey: null,
    })
    const items = res.items as unknown as MemberRecord[]
    setMembers(items)
    const mine = items.find(m => m.user_id === user.id)
    setMyMember(mine ?? null)
  }

  async function subscribeToLobby() {
    // Subscribe to team_members changes
    const unsubMembers = await pb.collection('team_members').subscribe('*', async (e) => {
      await loadMembers()
      // If my record got approved, show it
      if (e.record.user_id === user.id && e.record.approved_by_host) {
        setMyMember(e.record as unknown as MemberRecord)
      }
    })
    unsubRef.current.push(unsubMembers)

    // Subscribe to game status changes (host starts game)
    const unsubGame = await pb.collection('games').subscribe(gameId!, (e) => {
      if (e.record.status === 'active') navigate(`/game/${gameId}`)
    })
    unsubRef.current.push(unsubGame)
  }

  async function handleApprove(memberId: string) {
    await api.post(`/api/rr/game/${gameId}/approve/${memberId}`)
    await loadMembers()
  }

  async function handleDeny(memberId: string) {
    await api.post(`/api/rr/game/${gameId}/deny/${memberId}`)
    await loadMembers()
  }

  async function handleLeave() {
    try {
      await api.post(`/api/rr/game/${gameId}/leave`)
      await loadMembers()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to leave team')
    }
  }

  async function handleCancel() {
    if (!confirm('Delete this game and all its data?')) return
    await api.delete(`/api/rr/game/${gameId}`)
    navigate('/dashboard')
  }

  async function handleStart() {
    setError('')
    setStarting(true)
    try {
      await api.post(`/api/rr/game/${gameId}/start`)
      navigate(`/game/${gameId}`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start game')
      setStarting(false)
    }
  }

  if (loading) return <div className={styles.loading}>Loading lobby…</div>
  if (!game) return <div className={styles.loading}>Game not found</div>

  const approved = members.filter(m => m.approved_by_host)
  const pending  = members.filter(m => !m.approved_by_host)

  // Teams with their approved members
  const teamsWithMembers = game.teams.map(t => ({
    ...t,
    approvedMembers: approved.filter(m => m.team_id === t.id),
    pendingMembers:  pending.filter(m => m.team_id === t.id),
  }))

  // Check start eligibility — all teams must have ≥1 approved member, and at least 2 teams total
  const readyTeams = teamsWithMembers.filter(t => t.approvedMembers.length > 0)
  const canStart = readyTeams.length >= 2 && readyTeams.length === teamsWithMembers.length

  // My approval status
  const myApproved = myMember?.approved_by_host ?? false
  const myTeam = game.teams.find(t => t.id === myMember?.team_id)

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <h1 className={styles.gameName}>{game.name}</h1>
        <div className={styles.headerRight}>
          {game.inviteCode && (
            <button className={styles.gameCodeBtn} onClick={() => setShowQR(true)}>
              <span className={styles.gameCodeLabel}>Game code</span>
              <span className={styles.gameCode}>{game.inviteCode}</span>
            </button>
          )}
        </div>
      </header>

      <div className={styles.main}>
        {/* Player: waiting state */}
        {!isHost && (
          <div className={styles.playerStatus}>
            {!myMember ? (
              <p className={styles.waitMsg}>Waiting to join… Select a team below.</p>
            ) : !myApproved ? (
              <div className={styles.waitingApproval}>
                <div className={styles.spinner} />
                <p>Waiting for host approval…</p>
              </div>
            ) : (
              <div className={styles.approved}>
                <span className={styles.checkmark}>✓</span>
                <div>
                  <p><strong>You're in!</strong></p>
                  {myTeam && (
                    <p style={{ color: myTeam.color }}>● {myTeam.name}</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Teams grid */}
        <div className={styles.teamsGrid}>
          {teamsWithMembers.map(team => (
            <div key={team.id} className={styles.teamCard} style={{ borderColor: team.color }}>
              <div className={styles.teamHeader}>
                <div className={styles.teamDot} style={{ background: team.color }} />
                <span className={styles.teamName}>{team.name}</span>
              </div>

              {/* Approved members */}
              {team.approvedMembers.map(m => (
                <div key={m.id} className={styles.memberRow}>
                  <span className={styles.memberName}>
                    {m.display_name || 'Player'}
                  </span>
                  <span className={styles.approvedBadge}>✓</span>
                </div>
              ))}

              {/* Pending members (host sees approve/deny) */}
              {team.pendingMembers.map(m => (
                <div key={m.id} className={styles.memberRow}>
                  <span className={styles.memberName}>
                    {m.display_name || 'Player'}
                  </span>
                  {isHost ? (
                    <div className={styles.hostActions}>
                      <button className={styles.approveBtn} onClick={() => handleApprove(m.id)}>✓</button>
                      <button className={styles.denyBtn} onClick={() => handleDeny(m.id)}>✕</button>
                    </div>
                  ) : (
                    <span className={styles.pendingBadge}>pending</span>
                  )}
                </div>
              ))}

              {/* Join button when not yet on any team */}
              {!myMember && (
                <button
                  className={styles.joinTeamBtn}
                  style={{ borderColor: team.color, color: team.color }}
                  onClick={() => api.post(`/api/rr/game/${gameId}/join`, { teamId: team.id })
                    .then(loadMembers)
                    .catch(err => setError(err instanceof Error ? err.message : 'Failed to join'))
                  }
                >
                  Join {team.name}
                </button>
              )}
              {/* Leave button on own team — lets player switch teams */}
              {myMember?.team_id === team.id && (
                <button className={styles.leaveBtn} onClick={handleLeave}>
                  Leave
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Host: start game */}
        {isHost && (
          <div className={styles.hostFooter}>
            {error && <p className={styles.error}>{error}</p>}
            {!canStart && (
              <p className={styles.startHint}>Need ≥2 teams with ≥1 approved player each to start.</p>
            )}
            <button
              className={styles.startBtn}
              onClick={handleStart}
              disabled={!canStart || starting}
            >
              {starting ? 'Starting…' : 'Start Game'}
            </button>
            <button className={styles.cancelBtn} onClick={handleCancel}>
              Cancel Game
            </button>
          </div>
        )}

        {!isHost && error && <p className={styles.error}>{error}</p>}
      </div>

      {showQR && game.inviteCode && (
        <div className={styles.qrOverlay} onClick={() => setShowQR(false)}>
          <div className={styles.qrModal} onClick={e => e.stopPropagation()}>
            <p className={styles.qrTitle}>{game.name}</p>
            <QRCodeSVG
              value={`${window.location.origin}/join/${game.inviteCode}`}
              size={220}
              bgColor="#fff"
              fgColor="#1a1a1a"
              level="M"
            />
            <p className={styles.qrCode}>{game.inviteCode}</p>
            <p className={styles.qrHint}>Scan to join the game</p>
            <button className={styles.qrClose} onClick={() => setShowQR(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  )
}
