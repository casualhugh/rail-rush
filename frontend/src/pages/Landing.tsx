import { useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { pb } from '../lib/pb'
import styles from './Landing.module.css'

export default function Landing() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [mode, setMode] = useState<'idle' | 'login' | 'signup'>('idle')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [googleError, setGoogleError] = useState('')

  async function handleGoogleAuth() {
    setGoogleError('')
    setGoogleLoading(true)
    try {
      await pb.collection('users').authWithOAuth2({ provider: 'google' })
      navigate(searchParams.get('redirect') || '/dashboard')
    } catch (err: unknown) {
      setGoogleError(err instanceof Error ? err.message : 'Google sign-in failed')
    } finally {
      setGoogleLoading(false)
    }
  }

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mode === 'login') {
        await pb.collection('users').authWithPassword(email, password)
      } else {
        await pb.collection('users').create({ email, password, passwordConfirm: password, name })
        await pb.collection('users').authWithPassword(email, password)
      }
      navigate(searchParams.get('redirect') || '/dashboard')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={styles.root}>
      {/* Hero */}
      <div className={styles.hero}>
        <h1 className={styles.title}>Rail Rush</h1>
        <p className={styles.tagline}>Own the rails. Rule the streets.</p>
        <p className={styles.subtitle}>A real-world battle for your city's network.</p>

        {mode === 'idle' && (
          <div className={styles.ctaGroup}>
            <button className={styles.ctaGoogle} onClick={handleGoogleAuth} disabled={googleLoading}>
              {googleLoading ? '…' : 'Continue with Google'}
            </button>
            {googleError && <p className={styles.error}>{googleError}</p>}
            <div className={styles.divider}><span>or</span></div>
            <button className={styles.ctaPrimary} onClick={() => setMode('login')}>
              Sign In with Email
            </button>
          </div>
        )}

        {mode !== 'idle' && (
          <form className={styles.form} onSubmit={handleAuth}>
            <h2 className={styles.formTitle}>{'Sign In'}</h2>
            <input
              className={styles.input}
              type="email"
              placeholder="Email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
            <input
              className={styles.input}
              type="password"
              placeholder="Password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
            {error && <p className={styles.error}>{error}</p>}
            <button className={styles.ctaPrimary} type="submit" disabled={loading}>
              {loading ? '…' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
            <button type="button" className={styles.back} onClick={() => { setMode('idle'); setError('') }}>
              ← Back
            </button>
          </form>
        )}
      </div>

      {/* How to play */}
      <div className={styles.howto}>
        <h2 className={styles.howtoTitle}>How to Play</h2>
        <div className={styles.steps}>
          <div className={styles.step}>
            <span className={styles.stepNum}>1</span>
            <strong>Travel to stations</strong>
            <p>Physically travel to train or tram stations in your city.</p>
          </div>
          <div className={styles.step}>
            <span className={styles.stepNum}>2</span>
            <strong>Claim territory</strong>
            <p>Place coins to claim stations. Contest enemy stations by outbidding them, or pay a toll to pass through.</p>
          </div>
          <div className={styles.step}>
            <span className={styles.stepNum}>3</span>
            <strong>Complete challenges</strong>
            <p>Earn coins by completing challenges placed across the map. The team with the most stations wins.</p>
          </div>
        </div>
      </div>

      <footer className={styles.footer}>
        <Link to="/privacy">Privacy Policy</Link>
      </footer>
    </div>
  )
}
