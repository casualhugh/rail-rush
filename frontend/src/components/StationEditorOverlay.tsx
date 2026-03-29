import { useEffect, useRef, useState, MutableRefObject } from 'react'
import maplibregl from 'maplibre-gl'
import { useGameStore } from '../store/gameStore'
import { addStation, deleteStation, connectStations, disconnectStations } from '../lib/api'
import styles from './StationEditorOverlay.module.css'

type Mode = 'place' | 'connect'

interface Props {
  gameId: string
  mapRef: MutableRefObject<maplibregl.Map | null>
  editStationHandlerRef: MutableRefObject<((id: string, x: number, y: number) => void) | null>
  onClose: () => void
}

export default function StationEditorOverlay({ gameId, mapRef, editStationHandlerRef, onClose }: Props) {
  const stations = useGameStore(s => s.stations)
  const [mode, setMode] = useState<Mode>('place')
  const [connectingFromId, setConnectingFromId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [deletePopup, setDeletePopup] = useState<{ stationId: string; x: number; y: number } | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [errorKey, setErrorKey] = useState(0)
  const modeRef = useRef<Mode>('place')
  const connectingFromIdRef = useRef<string | null>(null)
  const addingRef = useRef(false)

  // Keep refs in sync
  useEffect(() => { modeRef.current = mode }, [mode])
  useEffect(() => { connectingFromIdRef.current = connectingFromId }, [connectingFromId])
  useEffect(() => { addingRef.current = adding }, [adding])

  function showError(msg: string) {
    setErrorMsg(msg)
    setErrorKey(k => k + 1)
    setTimeout(() => setErrorMsg(null), 3000)
  }

  // Register the station click interceptor
  useEffect(() => {
    editStationHandlerRef.current = (id: string, x: number, y: number) => {
      const currentMode = modeRef.current
      if (currentMode === 'place') {
        setDeletePopup({ stationId: id, x, y })
      } else if (currentMode === 'connect') {
        handleConnectClick(id)
      }
    }
    return () => { editStationHandlerRef.current = null }
  }, [])

  // Attach map click handler for placing new stations
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    function handleMapClick(e: maplibregl.MapMouseEvent) {
      if (modeRef.current !== 'place') return
      if (addingRef.current) return
      setDeletePopup(null)
      const { lat, lng } = e.lngLat
      doAddStation(lat, lng)
    }

    map.on('click', handleMapClick)
    return () => { map.off('click', handleMapClick) }
  }, [gameId])

  async function doAddStation(lat: number, lng: number) {
    setAdding(true)
    const name = `Station ${useGameStore.getState().stations.length + 1}`
    try {
      await addStation(gameId, { name, lat, lng })
      // SSE will update the store; no manual push needed
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to add station')
    } finally {
      setAdding(false)
    }
  }

  async function doDeleteStation(stationId: string) {
    setDeletePopup(null)
    try {
      await deleteStation(stationId)
      // SSE fires a delete event → store.removeStation is called
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Failed to delete station')
    }
  }

  function handleConnectClick(clickedId: string) {
    const from = connectingFromIdRef.current
    if (!from) {
      setConnectingFromId(clickedId)
      return
    }
    if (from === clickedId) {
      setConnectingFromId(null)
      return
    }
    setConnectingFromId(null)
    doToggleConnection(from, clickedId)
  }

  async function doToggleConnection(aId: string, bId: string) {
    const stationA = useGameStore.getState().stations.find(s => s.id === aId)
    if (!stationA) return
    const alreadyConnected = stationA.connectedTo.includes(bId)

    // Guard: skip if local state already matches desired outcome
    if (alreadyConnected) {
      try { await disconnectStations(aId, bId) }
      catch (err) { showError(err instanceof Error ? err.message : 'Failed to disconnect') }
    } else {
      try { await connectStations(aId, bId) }
      catch (err) { showError(err instanceof Error ? err.message : 'Failed to connect') }
    }
  }

  const connectingStation = connectingFromId
    ? stations.find(s => s.id === connectingFromId)
    : null

  return (
    <div className={styles.overlay}>
      {/* Error toast */}
      {errorMsg && (
        <div className={styles.errorToast} key={errorKey}>
          {errorMsg}
        </div>
      )}

      {/* Connecting hint */}
      {mode === 'connect' && connectingFromId && connectingStation && (
        <div className={styles.connectingHint}>
          {connectingStation.name} → tap another station
        </div>
      )}
      {mode === 'connect' && !connectingFromId && (
        <div className={styles.connectingHint}>
          Tap a station to start a connection
        </div>
      )}

      {/* Delete popup */}
      {deletePopup && (() => {
        const s = stations.find(st => st.id === deletePopup.stationId)
        if (!s) return null
        return (
          <div
            className={styles.deletePopup}
            style={{ left: deletePopup.x, top: deletePopup.y }}
          >
            <div className={styles.deletePopupName}>{s.name}</div>
            <button className={styles.deleteBtn} onClick={() => doDeleteStation(s.id)}>
              Delete station
            </button>
          </div>
        )
      })()}

      {/* Control panel */}
      <div className={styles.panel}>
        <button
          className={`${styles.modeBtn}${mode === 'place' ? ` ${styles.active}` : ''}`}
          onClick={() => { setMode('place'); setConnectingFromId(null) }}
        >
          Place
        </button>
        <button
          className={`${styles.modeBtn}${mode === 'connect' ? ` ${styles.active}` : ''}`}
          onClick={() => { setMode('connect'); setDeletePopup(null) }}
        >
          Connect
        </button>
        <span className={styles.hint}>
          {mode === 'place' && !adding && 'Tap map to add · tap pin to delete'}
          {mode === 'place' && adding && 'Adding…'}
          {mode === 'connect' && 'Tap two pins to toggle connection'}
        </span>
        <button className={styles.doneBtn} onClick={onClose}>✕ Done</button>
      </div>
    </div>
  )
}
