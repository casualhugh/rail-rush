import { useState } from 'react'
import { SlQuestion } from 'react-icons/sl'
import styles from './MapLegend.module.css'

export default function MapLegend() {
  const [open, setOpen] = useState(true)

  if (!open) {
    return (
      <button className={styles.reopenBtn} onClick={() => setOpen(true)} aria-label="Show legend">
        <SlQuestion />
      </button>
    )
  }

  return (
    <div className={styles.card}>
      <button className={styles.closeBtn} onClick={() => setOpen(false)} aria-label="Close legend">×</button>
      <div className={styles.row}>
        <span className={styles.dotUnclaimed} />
        <span className={styles.label}>Unclaimed station</span>
      </div>
      <div className={styles.row}>
        <span className={styles.dotOwned} />
        <span className={styles.label}>Owned by a team</span>
      </div>
      <div className={styles.row}>
        <span className={styles.challengeBadge}>▽</span>
        <span className={styles.label}>Active challenge</span>
      </div>
    </div>
  )
}
