import { useState, useEffect, useRef } from 'react'
import { listMaps, getMap, MapTemplateSummary, MapTemplateDetail } from '../lib/api'
import styles from './MapGallery.module.css'

const LIMIT = 20

interface Props {
  onSelect: (template: MapTemplateDetail) => void
  onSkip: () => void
}

export default function MapGallery({ onSelect, onSkip }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MapTemplateSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [cardError, setCardError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [offset, setOffset] = useState(0)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function fetchMaps(search: string, off: number, append: boolean) {
    setLoading(true)
    try {
      const items = await listMaps(search, LIMIT, off)
      setResults(prev => append ? [...prev, ...items] : items)
      setHasMore(items.length === LIMIT)
    } catch (_) {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMaps('', 0, false)
  }, [])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  function handleSearch(q: string) {
    setQuery(q)
    setOffset(0)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      fetchMaps(q, 0, false)
    }, 300)
  }

  function handleLoadMore() {
    const next = offset + LIMIT
    setOffset(next)
    fetchMaps(query, next, true)
  }

  async function handleCardClick(id: string) {
    setLoadingId(id)
    try {
      const detail = await getMap(id)
      onSelect(detail)
    } catch (_) {
      setCardError(id)
      setTimeout(() => setCardError(null), 3000)
    } finally {
      setLoadingId(null)
    }
  }

  return (
    <div className={styles.root}>
      <button className={styles.skipBtn} onClick={onSkip}>
        Start fresh
      </button>
      <input
        className={styles.search}
        type="text"
        placeholder="Search maps by name or city..."
        value={query}
        onChange={e => handleSearch(e.target.value)}
      />
      {loading && results.length === 0 && <p className={styles.loading}>Loading...</p>}
      <div className={styles.grid}>
        {results.map(t => (
          <button
            key={t.id}
            className={styles.card}
            onClick={() => handleCardClick(t.id)}
            disabled={loadingId === t.id}
          >
            <span className={styles.cardName}>{t.name}</span>
            {t.cityName && <span className={styles.cardCity}>{t.cityName}</span>}
            <span className={styles.cardMeta}>
              {t.stationCount} station{t.stationCount !== 1 ? 's' : ''}
              {t.timesUsed > 0 && ` · used ${t.timesUsed}x`}
            </span>
            {loadingId === t.id && <span className={styles.cardLoading}> Loading...</span>}
            {cardError === t.id && <span className={styles.cardError}>Failed to load</span>}
          </button>
        ))}
      </div>
      {results.length === 0 && !loading && (
        <p className={styles.empty}>No maps found. Be the first to save one!</p>
      )}
      {hasMore && (
        <button className={styles.loadMore} onClick={handleLoadMore} disabled={loading}>
          Load more
        </button>
      )}
    </div>
  )
}
