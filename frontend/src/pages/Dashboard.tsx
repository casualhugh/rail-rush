import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { pb, api } from '../lib/pb'
import styles from './Dashboard.module.css'

interface GameSummary {
  id: string
  name: string
  status: 'lobby' | 'active' | 'ended'
  city_name: string
  created: string
  host_user_id: string
}

export default function Dashboard() {
  const navigate = useNavigate()
  const user = pb.authStore.model
  const [games, setGames] = useState<GameSummary[]>([])
  const [joinCode, setJoinCode] = useState('')
  const [joinError, setJoinError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadGames()
  }, [])

  async function loadGames() {
    try {
      // Find games where user is host or a team member
      const hosted = await pb.collection('games').getList(1, 10, {
        filter: `host_user_id = "${user?.id}"`,
        sort: '-created',
        requestKey: null,
      })

      // Find games user has joined via team_members
      const memberRecords = await pb.collection('team_members').getList(1, 20, {
        filter: `user_id = "${user?.id}"`,
        expand: 'team_id',
        requestKey: null,
      })
      const joinedGameIds = new Set<string>()
      const joinedGames: GameSummary[] = []

      for (const m of memberRecords.items) {
        const team = m.expand?.team_id as { game_id: string } | undefined
        if (team?.game_id && !joinedGameIds.has(team.game_id)) {
          joinedGameIds.add(team.game_id)
          try {
            const g = await pb.collection('games').getOne(team.game_id)
            joinedGames.push(g as unknown as GameSummary)
          } catch (_) {}
        }
      }

      const all = [...hosted.items as unknown as GameSummary[], ...joinedGames]
      const unique = all.filter((g, i) => all.findIndex(x => x.id === g.id) === i)
      setGames(unique.sort((a, b) => (b.created || '').localeCompare(a.created || '')))
    } catch (e) {
      console.error('Failed to load games', e)
    } finally {
      setLoading(false)
    }
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault()
    setJoinError('')
    const code = joinCode.trim().toUpperCase()
    if (!code) return

    try {
      // Find game by invite code
      const results = await pb.collection('games').getList(1, 1, {
        filter: `invite_code = "${code}"`,
      })
      if (results.items.length === 0) {
        setJoinError('No game found with that code')
        return
      }
      const game = results.items[0]
      navigate(`/game/${game.id}/lobby`)
    } catch (err) {
      setJoinError('Invalid code')
    }
  }

  async function handleDelete(gameId: string) {
    if (!confirm('Delete this game and all its data?')) return
    try {
      await api.delete(`/api/rr/game/${gameId}`)
      setGames(prev => prev.filter(g => g.id !== gameId))
    } catch (err) {
      console.error('Failed to delete game', err)
    }
  }

  function handleLogout() {
    pb.authStore.clear()
    navigate('/')
  }

  const statusLabel = (s: string) => s === 'lobby' ? 'In Lobby' : s === 'active' ? 'Live' : 'Ended'
  const statusColor = (s: string) => s === 'active' ? 'var(--color-teal)' : s === 'lobby' ? 'var(--color-amber)' : 'var(--color-text-muted)'

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <h1 className={styles.logo}>Rail Rush</h1>
        <div className={styles.headerRight}>
          <span className={styles.username}>{user?.name || user?.email}</span>
          <button className={styles.logoutBtn} onClick={handleLogout}>Sign Out</button>
        </div>
      </header>

      <main className={styles.main}>
        {/* Join + Create */}
        <div className={styles.actions}>
          <form className={styles.joinForm} onSubmit={handleJoin}>
            <input
              className={styles.joinInput}
              type="text"
              placeholder="Enter invite code"
              value={joinCode}
              onChange={e => setJoinCode(e.target.value)}
              maxLength={8}
            />
            <button className={styles.joinBtn} type="submit">Join Game</button>
          </form>
          {joinError && <p className={styles.error}>{joinError}</p>}

          <button className={styles.createBtn} onClick={() => navigate('/game/new')}>
            + Create Game
          </button>
        </div>

        {/* Games list */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Your Games</h2>
          {loading ? (
            <p className={styles.muted}>Loading…</p>
          ) : games.length === 0 ? (
            <p className={styles.muted}>No games yet — create one or join with a code.</p>
          ) : (
            <div className={styles.gameList}>
              {games.map(g => (
                <div key={g.id} className={styles.gameCard}>
                  <button
                    className={styles.gameCardMain}
                    onClick={() => {
                      if (g.status === 'lobby') navigate(`/game/${g.id}/lobby`)
                      else if (g.status === 'active') navigate(`/game/${g.id}`)
                      else navigate(`/game/${g.id}/end`)
                    }}
                  >
                    <div className={styles.gameCardLeft}>
                      <span className={styles.gameName}>{g.name}</span>
                      {g.city_name && <span className={styles.gameCity}>{g.city_name}</span>}
                    </div>
                    <span
                      className={styles.gameStatus}
                      style={{ color: statusColor(g.status) }}
                    >
                      {statusLabel(g.status)}
                    </span>
                  </button>
                  {g.host_user_id === user?.id && (
                    <button
                      className={styles.deleteBtn}
                      onClick={() => handleDelete(g.id)}
                      title="Delete game"
                    >✕</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
