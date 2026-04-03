import { useEffect, useRef, useState } from 'react'
import { PiCoinVertical } from 'react-icons/pi'
import styles from './CoinHUD.module.css'

interface Props {
  balance: number
}

export default function CoinHUD({ balance }: Props) {
  const prevRef = useRef(balance)
  const [delta, setDelta] = useState<number | null>(null)
  const [animKey, setAnimKey] = useState(0)

  useEffect(() => {
    const diff = balance - prevRef.current
    if (diff !== 0) {
      setDelta(diff)
      setAnimKey(k => k + 1)
      const t = setTimeout(() => setDelta(null), 1200)
      prevRef.current = balance
      return () => clearTimeout(t)
    }
  }, [balance])

  return (
    <div className={styles.hud}>
      <PiCoinVertical className={styles.icon} />
      <span className={styles.balance}>{balance}</span>
      {delta !== null && (
        <span
          key={animKey}
          className={`${styles.delta} ${delta > 0 ? styles.gain : styles.loss}`}
        >
          {delta > 0 ? `+${delta}` : delta}
        </span>
      )}
    </div>
  )
}
