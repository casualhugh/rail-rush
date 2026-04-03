import { useRef, useEffect } from 'react'
import { SlTarget, SlCheck, SlClose, SlBan, SlUser, SlRocket, SlFlag } from 'react-icons/sl'
import { PiCoinVertical, PiTrain } from 'react-icons/pi'
import { LuSwords } from 'react-icons/lu'
import { CiBag1 } from 'react-icons/ci'
import { FiSend } from 'react-icons/fi'
import { useGameStore, type EventFeedItem } from '../store/gameStore'
import styles from './EventFeed.module.css'

const Coin = () => <PiCoinVertical style={{ verticalAlign: 'middle', marginBottom: '2px', height: "100%" }} />

interface Props {
  onClose: () => void
}

export default function EventFeed({ onClose }: Props) {
  const { eventFeed, teams, stations } = useGameStore()
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [eventFeed.length])

  function teamName(id: string | null) {
    if (!id) return '?'
    return teams.find(t => t.id === id)?.name ?? id.slice(0, 6)
  }

  function teamColor(id: string | null) {
    if (!id) return undefined
    return teams.find(t => t.id === id)?.color
  }

  function stationName(id: string | null) {
    if (!id) return ''
    return stations.find(s => s.id === id)?.name ?? id.slice(0, 6)
  }

  function renderEvent(ev: EventFeedItem) {
    const t = ev.teamId
    const t2 = ev.secondaryTeamId
    const s = ev.stationId
    const coins = ev.coinsInvolved

    switch (ev.type) {
      case 'claim':
        return {
          icon: <PiTrain />,
          text: <><span style={{ color: teamColor(t), fontWeight: 600 }}>{teamName(t)}</span> claimed <strong>{stationName(s)}</strong> for {coins}<Coin /></>,
          className: styles.evClaim,
        }
      case 'reinforce':
        return {
          icon: <PiCoinVertical />,
          text: <><span style={{ color: teamColor(t), fontWeight: 600 }}>{teamName(t)}</span> reinforced <strong>{stationName(s)}</strong> (+{coins}<Coin />)</>,
          className: styles.evClaim,
        }
      case 'contest':
        return {
          icon: <LuSwords />,
          text: <><span style={{ color: teamColor(t), fontWeight: 600 }}>{teamName(t)}</span> took <strong>{stationName(s)}</strong> from <span style={{ color: teamColor(t2), fontWeight: 600 }}>{teamName(t2)}</span> for {coins}<Coin /></>,
          className: styles.evContest,
        }
      case 'toll_paid':
        return {
          icon: <CiBag1 />,
          text: ev.wasPartial
            ? <em style={{ color: 'var(--color-text-muted)' }}><span style={{ color: teamColor(t) }}>{teamName(t)}</span> paid partial toll ({coins}<Coin />) to {teamName(t2)} at {stationName(s)}</em>
            : <><span style={{ color: teamColor(t), fontWeight: 600 }}>{teamName(t)}</span> paid toll ({coins}<Coin />) to <span style={{ color: teamColor(t2) }}>{teamName(t2)}</span> at <strong>{stationName(s)}</strong></>,
          className: ev.wasPartial ? styles.evTollPartial : styles.evToll,
        }
      case 'challenge_drawn':
        return {
          icon: <SlTarget />,
          text: <>Challenge drawn at <strong>{stationName(s) || '(no station)'}</strong></>,
          className: styles.evChallenge,
        }
      case 'challenge_submitted':
        return {
          icon: <FiSend />,
          text: <><span style={{ color: teamColor(t), fontWeight: 600 }}>{teamName(t)}</span> submitted challenge at <strong>{stationName(s)}</strong></>,
          className: styles.evChallenge,
        }
      case 'challenge_completed':
        return {
          icon: <SlCheck style={{ color: '#27AE60' }} />,
          text: <><span style={{ color: teamColor(t), fontWeight: 600 }}>{teamName(t)}</span> completed challenge at <strong>{stationName(s)}</strong>{coins ? <> +{coins}<Coin /></> : null}</>,
          className: styles.evApproved,
        }
      case 'challenge_failed':
        return {
          icon: <SlClose style={{ color: '#C0392B' }} />,
          text: <><span style={{ color: teamColor(t), fontWeight: 600 }}>{teamName(t)}</span> failed challenge at <strong>{stationName(s)}</strong></>,
          className: styles.evFailed,
        }
      case 'challenge_rejected':
        return {
          icon: <SlBan />,
          text: <>Challenge rejected for <span style={{ color: teamColor(t) }}>{teamName(t)}</span></>,
          className: styles.evFailed,
        }
      case 'challenge_impossible':
        return {
          icon: <SlBan />,
          text: <>Host removed challenge at <strong>{stationName(s) || '(no station)'}</strong> as impossible</>,
          className: styles.evFailed,
        }
      case 'challenge_claimed':
        return {
          icon: <SlTarget />,
          text: <><span style={{ color: teamColor(t), fontWeight: 600 }}>{teamName(t)}</span> is attempting challenge at <strong>{stationName(s)}</strong></>,
          className: styles.evChallenge,
        }
      case 'player_joined':
        return {
          icon: <SlUser />,
          text: <>Player joined <span style={{ color: teamColor(t) }}>{teamName(t)}</span></>,
          className: styles.evSystem,
        }
      case 'game_started':
        return { icon: <SlRocket />, text: <>Game started!</>, className: styles.evSystem }
      case 'game_ended':
        return { icon: <SlFlag />, text: <>Game ended</>, className: styles.evSystem }
      default:
        return { icon: '•', text: <>{ev.type}</>, className: styles.evSystem }
    }
  }

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.drawer}>
        <div className={styles.drawerHeader}>
          <h2 className={styles.drawerTitle}>Events</h2>
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div className={styles.feed}>
          {[...eventFeed].reverse().map(ev => {
            const { icon, text, className } = renderEvent(ev)
            return (
              <div key={ev.id} className={`${styles.event} ${className}`}>
                <span className={styles.eventIcon}>{icon}</span>
                <div className={styles.eventText}>{text}</div>
                <span className={styles.eventTime}>{formatTime(ev.created)}</span>
              </div>
            )
          })}
          {eventFeed.length === 0 && (
            <p className={styles.empty}>No events yet</p>
          )}
          <div ref={endRef} />
        </div>
      </div>
    </>
  )
}

function formatTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}
