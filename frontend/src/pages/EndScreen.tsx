import { useEffect, useState } from 'react'
import { PiCoinVertical, PiTrain } from 'react-icons/pi'
import { useParams, useNavigate } from 'react-router-dom'
import { pb } from '../lib/pb'
import { getGame } from '../lib/api'
import styles from './EndScreen.module.css'

interface Score {
  teamId: string
  teamName: string
  color: string
  stationCount: number
  totalStaked: number
  coinBalance: number
  rank: number
}

const RANK_MEDALS = ['🥇', '🥈', '🥉']

export default function EndScreen() {
  const { gameId } = useParams<{ gameId: string }>()
  const navigate = useNavigate()
  const [scores, setScores] = useState<Score[]>([])
  const [gameName, setGameName] = useState('')
  const [revealed, setRevealed] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!gameId) return

    async function load() {
      try {
        const state = await getGame(gameId!)
        setGameName(state.name)

        if (state.status !== 'ended') {
          // Game not ended yet — go back to map
          navigate(`/game/${gameId}`, { replace: true })
          return
        }

        // Build scores from teams + stations
        const computed: Score[] = state.teams.map(t => {
          const owned = state.stations.filter(s => s.ownerTeamId === t.id)
          return {
            teamId: t.id,
            teamName: t.name,
            color: t.color,
            stationCount: owned.length,
            totalStaked: owned.reduce((sum, s) => sum + s.currentStake, 0),
            coinBalance: t.coinBalance,
            rank: 0,
          }
        })
        computed.sort((a, b) =>
          b.stationCount !== a.stationCount
            ? b.stationCount - a.stationCount
            : b.totalStaked - a.totalStaked
        )
        computed.forEach((s, i) => { s.rank = i + 1 })
        setScores(computed)
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [gameId, navigate])

  // Animate rank reveal: reveal one per second (bottom to top)
  useEffect(() => {
    if (scores.length === 0) return
    const timer = setInterval(() => {
      setRevealed(r => {
        if (r >= scores.length) { clearInterval(timer); return r }
        return r + 1
      })
    }, 600)
    return () => clearInterval(timer)
  }, [scores.length])

  if (loading) {
    return <div className={styles.loading}>Loading results…</div>
  }

  const _isHost = scores.length > 0 && pb.authStore.model?.id !== undefined

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <h1 className={styles.title}>Game Over</h1>
        <p className={styles.subtitle}>{gameName}</p>
      </div>

      <div className={styles.podium}>
        {scores.map((s, i) => {
          const visible = i < revealed
          const medal = RANK_MEDALS[i] ?? `#${i + 1}`
          return (
            <div
              key={s.teamId}
              className={`${styles.scoreRow} ${visible ? styles.visible : styles.hidden}`}
              style={{ '--team-color': s.color } as React.CSSProperties}
            >
              <span className={styles.medal}>{medal}</span>
              <div className={styles.teamDot} style={{ background: s.color }} />
              <div className={styles.teamInfo}>
                <span className={styles.teamName}>{s.teamName}</span>
                <span className={styles.teamStats}>
                  <PiTrain style={{ verticalAlign: 'middle' }} /> {s.stationCount} station{s.stationCount !== 1 ? 's' : ''}
                  {s.totalStaked > 0 ? ` · ${s.totalStaked} staked` : ''}
                  {' · '}{s.coinBalance}<PiCoinVertical style={{ verticalAlign: 'middle', marginBottom: '2px', height: "100%" }} /> remaining
                </span>
              </div>
            </div>
          )
        })}
      </div>

      <div className={styles.actions}>
        <button className={styles.homeBtn} onClick={() => navigate('/dashboard')}>
          Back to Dashboard
        </button>
      </div>
    </div>
  )
}
