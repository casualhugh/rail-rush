import { useState } from 'react'
import { PiCoinVertical, PiTrain } from 'react-icons/pi'
import { useGameStore } from '../store/gameStore'
import styles from './ScorePanel.module.css'

export default function ScorePanel() {
  const [open, setOpen] = useState(false)
  const { teams, stations } = useGameStore()

  const scores = teams.map(t => {
    const owned = stations.filter(s => s.ownerTeamId === t.id)
    return { ...t, stationCount: owned.length, totalStaked: owned.reduce((s, x) => s + x.currentStake, 0) }
  }).sort((a, b) => b.stationCount !== a.stationCount
    ? b.stationCount - a.stationCount
    : b.totalStaked - a.totalStaked
  )

  return (
    <div className={`${styles.panel} ${open ? styles.open : ''}`}>
      <button className={styles.toggle} onClick={() => setOpen(o => !o)}>
        {open ? '▾ Scores' : '▸ Scores'}
      </button>
      {open && (
        <div className={styles.list}>
          {scores.map((t, i) => (
            <div key={t.id} className={styles.row}>
              <span className={styles.rank}>#{i + 1}</span>
              <div className={styles.dot} style={{ background: t.color }} />
              <span className={styles.name}>{t.name}</span>
              <span className={styles.stations}>{t.stationCount} <PiTrain style={{ verticalAlign: 'middle' }} /></span>
              <span className={styles.coins}>{t.coinBalance} <PiCoinVertical style={{ verticalAlign: 'middle', height: "100%" }} /></span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
