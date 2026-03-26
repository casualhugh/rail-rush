import { useState } from 'react'
import { api } from '../lib/pb'
import { markChallengeImpossible } from '../lib/api'
import { useGameStore, type Challenge } from '../store/gameStore'
import styles from './ChallengeModal.module.css'

interface Props {
  challenge: Challenge
  myTeamId: string
  isHost: boolean
  onClose: () => void
}

const DIFF_COLOR: Record<string, string> = {
  easy: '#27AE60', medium: '#F0AC2B', hard: '#E8622A'
}

export default function ChallengeModal({ challenge, myTeamId, isHost, onClose }: Props) {
  const { game } = useGameStore()
  const [loading, setLoading] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [markingImpossible, setMarkingImpossible] = useState(false)

  const isPending  = challenge.status === 'pending_approval'
  const isActive   = challenge.status === 'active'
  const requireApproval = game?.requireHostApproval

  async function doComplete() {
    setError('')
    setLoading(true)
    try {
      await api.post(`/api/rr/challenge/${challenge.id}/complete`, { teamId: myTeamId })
      setDone(true)
      setTimeout(onClose, 1200)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally { setLoading(false) }
  }

  async function doFail() {
    setError('')
    setLoading(true)
    try {
      await api.post(`/api/rr/challenge/${challenge.id}/fail`, { teamId: myTeamId })
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally { setLoading(false) }
  }

  async function doApprove() {
    setError('')
    setLoading(true)
    try {
      await api.post(`/api/rr/challenge/${challenge.id}/approve`)
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to approve')
    } finally { setLoading(false) }
  }

  async function doMarkImpossible() {
    if (!window.confirm('Mark this challenge as impossible and remove it?')) return
    setMarkingImpossible(true)
    try {
      await markChallengeImpossible(challenge.id)
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally { setMarkingImpossible(false) }
  }

  async function doReject() {
    setError('')
    setLoading(true)
    try {
      await api.post(`/api/rr/challenge/${challenge.id}/reject`, { reason: rejectReason })
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to reject')
    } finally { setLoading(false) }
  }

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.sheet}>
        <div className={styles.handle} />

        {/* Header */}
        <div className={styles.header}>
          <span className={styles.triangle}>▽</span>
          <div className={styles.meta}>
            <span className={styles.diff} style={{ color: DIFF_COLOR[challenge.difficulty] }}>
              {challenge.difficulty}
            </span>
            <span className={styles.reward}>+{challenge.coinReward}🪙</span>
          </div>
        </div>

        <p className={styles.description}>{challenge.description}</p>

        {error && <p className={styles.error}>{error}</p>}

        {/* Success state */}
        {done && (
          <div className={styles.successMsg}>
            {requireApproval
              ? '📹 Submit your video to the group chat, then wait for host approval.'
              : `+${challenge.coinReward}🪙 earned!`}
          </div>
        )}

        {/* Active challenge — team actions */}
        {isActive && !done && (
          <div className={styles.actions}>
            {isPending ? null : (
              <>
                <button className={styles.completeBtn} onClick={doComplete} disabled={loading}>
                  {loading ? '…' : 'Mark Complete'}
                </button>
                {requireApproval && (
                  <p className={styles.approvalNote}>
                    📹 Send your video to the group chat before submitting.
                  </p>
                )}
                <button className={styles.failBtn} onClick={doFail} disabled={loading}>
                  Mark Failed
                </button>
                {isHost && (
                  <button className={styles.impossibleBtn} onClick={doMarkImpossible} disabled={markingImpossible}>
                    {markingImpossible ? '…' : 'Mark Impossible'}
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {/* Pending approval state */}
        {isPending && !isHost && (
          <div className={styles.pendingMsg}>
            <div className={styles.spinner} />
            <div>
              <p><strong>Waiting for host approval…</strong></p>
              <p className={styles.pendingHint}>📹 Send your video to the group chat before submitting.</p>
            </div>
          </div>
        )}

        {/* Host: approve/reject pending */}
        {isPending && isHost && (
          <div className={styles.hostActions}>
            <p className={styles.pendingHint}>Team submitted — review their video then:</p>
            {!showRejectForm ? (
              <>
                <button className={styles.approveBtn} onClick={doApprove} disabled={loading}>
                  ✓ Approve (+{challenge.coinReward}🪙)
                </button>
                <button className={styles.rejectToggleBtn} onClick={() => setShowRejectForm(true)}>
                  ✕ Reject
                </button>
              </>
            ) : (
              <>
                <textarea
                  className={styles.reasonInput}
                  placeholder="Rejection reason (optional)"
                  value={rejectReason}
                  onChange={e => setRejectReason(e.target.value)}
                  rows={2}
                />
                <button className={styles.rejectBtn} onClick={doReject} disabled={loading}>
                  {loading ? '…' : 'Confirm Reject'}
                </button>
                <button className={styles.cancelBtn} onClick={() => setShowRejectForm(false)}>
                  Cancel
                </button>
              </>
            )}
          </div>
        )}

        <button className={styles.closeBtn} onClick={onClose}>Close</button>
      </div>
    </>
  )
}
