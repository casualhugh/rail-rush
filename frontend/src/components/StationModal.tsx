import { useState, useEffect } from 'react'
import { useGameStore, type Station, type Challenge } from '../store/gameStore'
import { getStationCeiling, reinforceStation, claimStation, contestStation, payToll } from '../lib/api'
import styles from './StationModal.module.css'

interface Props {
  station: Station
  myTeamId: string
  tollCost: number
  maxStakeIncrement: number
  onClose: () => void
  onChallengeOpen: (challenge: Challenge) => void
}

export default function StationModal({ station, myTeamId, tollCost, maxStakeIncrement, onClose, onChallengeOpen }: Props) {
  const { teams, challenges } = useGameStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Own-station ceiling state
  const [ceilingLoading, setCeilingLoading] = useState(false)
  const [ceilingError, setCeilingError] = useState<string | null>(null)
  const [stakeCeiling, setStakeCeiling] = useState<number | null>(null)
  const [reinforceCoins, setReinforceCoins] = useState(1)

  const myTeam = teams.find(t => t.id === myTeamId)
  const ownerTeam = teams.find(t => t.id === station.ownerTeamId)
  const activeChallenge = challenges.find(c => c.id === station.activeChallengeId && c.status === 'active')

  const isOwn    = station.ownerTeamId === myTeamId
  const isEnemy  = !!station.ownerTeamId && !isOwn
  const isFree   = !station.ownerTeamId

  const currentStake = station.currentStake ?? 0
  const minContest   = currentStake + 1
  const maxContest   = currentStake + maxStakeIncrement
  const myBalance    = myTeam?.coinBalance ?? 0

  // Contest slider range
  const contestMin = Math.min(minContest, myBalance)
  const contestMax = Math.min(maxContest, myBalance)
  const [contestStake, setContestStake] = useState(Math.min(minContest, myBalance))

  // Claim slider
  const [claimCoins, setClaimCoins] = useState(1)

  // Effective toll (may be partial)
  const effectiveToll = Math.min(tollCost, myBalance)
  const isPartialToll = effectiveToll < tollCost

  // Load ceiling when this is our own station. Empty [] — fires once on mount.
  useEffect(() => {
    if (isOwn) loadCeiling()
  }, [station.id])

  async function loadCeiling() {
    setCeilingLoading(true)
    setCeilingError(null)
    setStakeCeiling(null)
    try {
      const data = await getStationCeiling(station.id)
      setStakeCeiling(data.stakeCeiling)
      setReinforceCoins(1)
    } catch (err: unknown) {
      setCeilingError(err instanceof Error ? err.message : 'Could not load station info')
    } finally {
      setCeilingLoading(false)
    }
  }

  async function doClaim() {
    setError('')
    setLoading(true)
    try {
      await claimStation(station.id, myTeamId, claimCoins)
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to claim')
    } finally { setLoading(false) }
  }

  async function doContest() {
    setError('')
    setLoading(true)
    try {
      await contestStation(station.id, myTeamId, contestStake)
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to contest')
    } finally { setLoading(false) }
  }

  async function doToll() {
    setError('')
    setLoading(true)
    try {
      await payToll(station.id, myTeamId)
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to pay toll')
    } finally { setLoading(false) }
  }

  async function doReinforce() {
    setError('')
    setLoading(true)
    try {
      await reinforceStation(station.id, myTeamId, reinforceCoins)
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to reinforce')
    } finally { setLoading(false) }
  }

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.sheet}>
        <div className={styles.handle} />

        {/* Station name + owner */}
        <div className={styles.stationHeader}>
          <h2 className={styles.stationName}>{station.name}</h2>
          {ownerTeam && (
            <div className={styles.ownerTag} style={{ background: ownerTeam.color }}>
              {ownerTeam.name} · {currentStake}🪙 staked
            </div>
          )}
        </div>

        {/* Challenge badge if present */}
        {activeChallenge && (
          <button
            className={styles.challengeBanner}
            onClick={() => { onChallengeOpen(activeChallenge); onClose() }}
          >
            <span className={styles.challengeTriangle}>▽</span>
            <span className={styles.challengeBannerText}>
              <strong>{activeChallenge.description.slice(0, 60)}{activeChallenge.description.length > 60 ? '…' : ''}</strong>
              <span className={styles.challengeReward}>+{activeChallenge.coinReward}🪙</span>
            </span>
            <span className={styles.challengeArrow}>→</span>
          </button>
        )}

        {error && <p className={styles.error}>{error}</p>}

        {/* Own station */}
        {isOwn && (
          <>
            <div className={styles.ownMsg}>
              <span>✓</span> You own this station
              {stakeCeiling !== null && ` · ${currentStake}🪙 staked · ceiling ${stakeCeiling}🪙`}
            </div>

            {ceilingLoading && <p className={styles.coinNote}>Loading…</p>}

            {ceilingError !== null && (
              <div className={styles.actions}>
                <p className={styles.error}>{ceilingError}</p>
                <button className={styles.closeBtn} onClick={loadCeiling}>Retry</button>
                <button className={styles.closeBtn} onClick={onClose}>Close</button>
              </div>
            )}

            {stakeCeiling !== null && currentStake < stakeCeiling && (() => {
              const ceilingRemaining = stakeCeiling - currentStake
              return (
              <div className={styles.actions}>
                <p className={styles.actionLabel}>{currentStake}🪙 staked · ceiling {stakeCeiling}🪙</p>
                <p className={styles.actionLabel}>Reinforce</p>
                <div className={styles.sliderRow}>
                  <input
                    type="range"
                    min={1}
                    max={ceilingRemaining}
                    value={reinforceCoins}
                    onChange={e => setReinforceCoins(+e.target.value)}
                    className={styles.slider}
                  />
                  <span className={styles.sliderVal}>{reinforceCoins}🪙</span>
                </div>
                <p className={styles.coinNote}>Stake locked in</p>
                <button
                  className={styles.primaryBtn}
                  onClick={doReinforce}
                  disabled={loading || myBalance < 1}
                >
                  {loading ? '…' : `Reinforce — ${reinforceCoins} coin${reinforceCoins !== 1 ? 's' : ''}`}
                </button>
              </div>
              )
            })()}

            {stakeCeiling !== null && currentStake === stakeCeiling && (
              <p className={styles.reinforcedMsg}>Fully reinforced — {currentStake}🪙 staked</p>
            )}
          </>
        )}

        {/* Unclaimed station */}
        {isFree && (
          <div className={styles.actions}>
            <p className={styles.actionLabel}>Place coins to claim</p>
            <div className={styles.sliderRow}>
              {/* max uses maxStakeIncrement prop — previously hard-coded to 5 */}
              <input type="range" min={1} max={Math.min(maxStakeIncrement, myBalance)} value={claimCoins}
                onChange={e => setClaimCoins(+e.target.value)} className={styles.slider} />
              <span className={styles.sliderVal}>{claimCoins}🪙</span>
            </div>
            <p className={styles.coinNote}>Stake locked in · balance: {myBalance}🪙</p>
            <button className={styles.primaryBtn} onClick={doClaim} disabled={loading || myBalance < 1}>
              {loading ? '…' : `Claim — ${claimCoins} coin${claimCoins !== 1 ? 's' : ''}`}
            </button>
          </div>
        )}

        {/* Enemy station */}
        {isEnemy && (
          <div className={styles.actions}>
            <p className={styles.actionLabel}>Contest & Claim</p>
            {myBalance >= minContest ? (
              <>
                <div className={styles.sliderRow}>
                  <input type="range"
                    min={contestMin} max={Math.max(contestMin, contestMax)}
                    value={Math.min(contestStake, Math.max(contestMin, contestMax))}
                    onChange={e => setContestStake(+e.target.value)}
                    className={styles.slider} />
                  <span className={styles.sliderVal}>{Math.min(contestStake, Math.max(contestMin, contestMax))}🪙</span>
                </div>
                <p className={styles.coinNote}>Stake locked in · balance: {myBalance}🪙</p>
                <button className={styles.primaryBtn} onClick={doContest} disabled={loading}>
                  {loading ? '…' : `Contest — ${Math.min(contestStake, Math.max(contestMin, contestMax))} coins`}
                </button>
              </>
            ) : (
              <p className={styles.cantAfford}>Need at least {minContest}🪙 to contest (you have {myBalance}🪙)</p>
            )}

            <div className={styles.divider} />

            <button className={styles.tollBtn} onClick={doToll} disabled={loading}>
              {isPartialToll
                ? `Pay Toll — ${effectiveToll}🪙 (all you have) → ${ownerTeam?.name}`
                : `Pay Toll — ${tollCost}🪙 → ${ownerTeam?.name}`}
              <span className={styles.tollNote}>Goes to {ownerTeam?.name}</span>
            </button>
          </div>
        )}

        <button className={styles.closeBtn} onClick={onClose}>Close</button>
      </div>
    </>
  )
}
