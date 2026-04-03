import { useState } from 'react'
import { PiCoinVertical, PiTrain } from 'react-icons/pi'
import { useGameStore, type Station, type Challenge } from '../store/gameStore'
import { reinforceStation, stakeStation, payToll } from '../lib/api'
import styles from './StationModal.module.css'

const Coin = () => <PiCoinVertical style={{ verticalAlign: 'middle', marginBottom: '2px', height: "100%" }} />

interface Props {
  station: Station
  myTeamId: string
  tollCost: number
  maxStakeIncrement: number
  onClose: () => void
  onChallengeOpen: (challenge: Challenge) => void
}

export default function StationModal({ station, myTeamId, tollCost, maxStakeIncrement, onClose, onChallengeOpen }: Props) {
  const { teams, challenges, stations } = useGameStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [reinforceCoins, setReinforceCoins] = useState(1)

  const myTeam = teams.find(t => t.id === myTeamId)
  const ownerTeam = teams.find(t => t.id === station.ownerTeamId)
  const activeChallenge = challenges.find(c => c.id === station.activeChallengeId && c.status === 'active')

  const isOwn    = station.ownerTeamId === myTeamId
  const isEnemy  = !!station.ownerTeamId && !isOwn
  const isFree   = !station.ownerTeamId
  const connectedStations = (station.connectedTo ?? [])
    .map(id => stations.find(s => s.id === id))
    .filter((s): s is NonNullable<typeof s> => s != null)

  const currentStake = station.currentStake ?? 0
  const stakeCeiling = station.stakeCeiling ?? 0
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

  async function doStake(stake: number) {
    setError('')
    setLoading(true)
    try {
      await stakeStation(station.id, myTeamId, stake)
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to stake')
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
          <h2 className={styles.stationName}><PiTrain style={{ verticalAlign: 'middle' }} /> {station.name}</h2>
          {ownerTeam && (
            <div className={styles.ownerTag} style={{ background: ownerTeam.color }}>
              {ownerTeam.name} · {currentStake}<Coin /> staked
            </div>
          )}
        </div>

        {/* Connected stations */}
        {connectedStations.length > 0 && (
          <div className={styles.connections}>
            <span className={styles.connectionsLabel}><PiTrain style={{ verticalAlign: 'middle' }} /> Connects to</span>
            <div className={styles.connectionsList}>
              {connectedStations.map(s => (
                <span key={s.id} className={styles.connectionChip}>{s.name}</span>
              ))}
            </div>
          </div>
        )}

        {/* Challenge badge if present */}
        {activeChallenge && (
          <button
            className={styles.challengeBanner}
            onClick={() => { onChallengeOpen(activeChallenge); onClose() }}
          >
            <span className={styles.challengeTriangle}>▽</span>
            <span className={styles.challengeBannerText}>
              <strong>{activeChallenge.description.slice(0, 60)}{activeChallenge.description.length > 60 ? '…' : ''}</strong>
              <span className={styles.challengeReward}>+{activeChallenge.coinReward}<Coin /></span>
            </span>
            <span className={styles.challengeArrow}>→</span>
          </button>
        )}

        {error && <p className={styles.error}>{error}</p>}

        {/* Own station */}
        {isOwn && (
          <>
            <div className={styles.ownMsg}>
              <span>✓</span> You own this station · {currentStake}<Coin /> staked · ceiling {stakeCeiling}<Coin />
            </div>

            {currentStake < stakeCeiling && (() => {
              const ceilingRemaining = stakeCeiling - currentStake
              return (
              <div className={styles.actions}>
                <p className={styles.actionLabel}>{currentStake}<Coin /> staked · ceiling {stakeCeiling}<Coin /></p>
                <p className={styles.actionLabel}>Reinforce</p>
                <div className={styles.sliderRow}>
                  <input
                    type="range"
                    min={1}
                    max={Math.min(ceilingRemaining, myBalance)}
                    value={reinforceCoins}
                    onChange={e => setReinforceCoins(+e.target.value)}
                    className={styles.slider}
                  />
                  <span className={styles.sliderVal}>{reinforceCoins}<Coin /></span>
                </div>
                <p className={styles.coinNote}>Stake locked in</p>
                <button
                  className={styles.primaryBtn}
                  onClick={doReinforce}
                  disabled={loading || myBalance < 1}
                >
                  {loading ? '…' : `Reinforce: ${reinforceCoins} coin${reinforceCoins !== 1 ? 's' : ''}`}
                </button>
              </div>
              )
            })()}

            {currentStake === stakeCeiling && (
              <p className={styles.reinforcedMsg}>Fully reinforced ({currentStake}<Coin /> staked)</p>
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
              <span className={styles.sliderVal}>{claimCoins}<Coin /></span>
            </div>
            <p className={styles.coinNote}>Stake locked in · balance: {myBalance}<Coin /></p>
            <button className={styles.primaryBtn} onClick={() => doStake(claimCoins)} disabled={loading || myBalance < 1}>
              {loading ? '…' : `Claim: ${claimCoins} coin${claimCoins !== 1 ? 's' : ''}`}
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
                  <span className={styles.sliderVal}>{Math.min(contestStake, Math.max(contestMin, contestMax))}<Coin /></span>
                </div>
                <p className={styles.coinNote}>Stake locked in · balance: {myBalance}<Coin /></p>
                <button className={styles.primaryBtn} onClick={() => doStake(Math.min(contestStake, Math.max(contestMin, contestMax)))} disabled={loading}>
                  {loading ? '…' : `Contest: ${Math.min(contestStake, Math.max(contestMin, contestMax))} coins`}
                </button>
              </>
            ) : (
              <p className={styles.cantAfford}>Need at least {minContest}<Coin /> to contest (you have {myBalance}<Coin />)</p>
            )}

            <div className={styles.divider} />

            <button className={styles.tollBtn} onClick={doToll} disabled={loading || myBalance >= minContest || myBalance === 0}>
              <span>
                {isPartialToll
                  ? <>Pay Toll: {effectiveToll}<Coin /> (all you have) to {ownerTeam?.name}</>
                  : <>Pay Toll: {tollCost}<Coin /> to {ownerTeam?.name}</>}
              </span>
              <span className={styles.tollNote}>Goes to {ownerTeam?.name}</span>
            </button>
            {myBalance >= minContest && myBalance > 0 && (
              <p className={styles.tollGateNote}>Pay a toll once you no longer have enough coins to contest.</p>
            )}
          </div>
        )}

        <button className={styles.closeBtn} onClick={onClose}>Close</button>
      </div>
    </>
  )
}
