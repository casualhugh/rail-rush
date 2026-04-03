import { Link } from 'react-router-dom'
import styles from './PrivacyPolicy.module.css'

export default function PrivacyPolicy() {
  return (
    <div className={styles.root}>
      <div className={styles.content}>
        <Link to="/" className={styles.back}>← Back to Rail Rush</Link>

        <h1 className={styles.pageTitle}>Privacy Policy</h1>
        <p className={styles.updated}>Last updated: April 2026</p>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Data We Collect</h2>
          <ul>
            <li><strong>Email address and display name</strong> — collected when you create an account.</li>
            <li><strong>GPS coordinates</strong> — may be collected during active game sessions to support gameplay.</li>
          </ul>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Why We Collect It</h2>
          <ul>
            <li><strong>Email and name:</strong> account identity and authentication.</li>
            <li><strong>GPS:</strong> core gameplay mechanic — proximity to real-world stations is what lets you interact with them.</li>
          </ul>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>How GPS Is Used</h2>
          <ul>
            <li>GPS access is a browser-permission feature. Your browser will prompt you before any location data is accessed, and you are welcome to decline.</li>
            <li>If collected, coordinates are transmitted at most once every 8 seconds per team during an active game.</li>
            <li>Location data is stored on the server as part of the game's team records and is readable by other players in your game.</li>
            <li>It is purged automatically within 30 days of the game ending via automated cleanup.</li>
          </ul>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Third-Party Sharing</h2>
          <ul>
            <li>Your data is not sold or shared with third parties.</li>
            <li>Authentication may be handled via Google OAuth. Google's own privacy policy applies to that flow.</li>
          </ul>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Data Retention</h2>
          <ul>
            <li>Ended game records, including GPS data, are purged automatically within 30 days of the game ending.</li>
            <li>Abandoned lobby games are purged after 7 days.</li>
            <li>Account data (email, name) is retained until you request deletion.</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
