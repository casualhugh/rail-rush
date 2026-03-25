import { useState } from 'react'
import { api } from '../lib/pb'
import { useGameStore, type Station, type Team, type Challenge } from '../store/gameStore'
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
  const [stakeInput, setStakeInput] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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

  async function doClaim() {
    setError('')
    setLoading(true)
    try {
      await api.post(`/api/rr/station/${station.id}/claim`, { teamId: myTeamId, coins: claimCoins })
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to claim')
    } finally { setLoading(false) }
  }

  async function doContest() {
    setError('')
    setLoading(true)
    try {
      await api.post(`/api/rr/station/${station.id}/contest`, { teamId: myTeamId, newStake: contestStake })
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to contest')
    } finally { setLoading(false) }
  }

  async function doToll() {
    setError('')
    setLoading(true)
    try {
      await api.post(`/api/rr/station/${station.id}/toll`, { teamId: myTeamId })
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to pay toll')
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
          <div className={styles.ownMsg}>
            <span>✓</span> You own this station · {currentStake}🪙 staked
          </div>
        )}

        {/* Unclaimed station */}
        {isFree && (
          <div className={styles.actions}>
            <p className={styles.actionLabel}>Place coins to claim</p>
            <div className={styles.sliderRow}>
              <input type="range" min={1} max={Math.min(5, myBalance)} value={claimCoins}
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
            {/* Contest */}
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

            {/* Toll */}
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
