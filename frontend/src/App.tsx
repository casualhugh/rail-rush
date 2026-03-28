import { Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { pb } from './lib/pb'

import Landing from './pages/Landing'
import Dashboard from './pages/Dashboard'
import HostSetup from './pages/HostSetup'
import Lobby from './pages/Lobby'
import GameMap from './pages/GameMap'
import EndScreen from './pages/EndScreen'
import JoinRedirect from './pages/JoinRedirect'

function App() {
  const [authed, setAuthed] = useState(pb.authStore.isValid)

  useEffect(() => {
    // Listen for auth changes (login / logout)
    return pb.authStore.onChange(() => {
      setAuthed(pb.authStore.isValid)
    })
  }, [])

  return (
    <Routes>
      {/* Public */}
      <Route path="/" element={<Landing />} />
      <Route path="/join/:code" element={<JoinRedirect />} />

      {/* Authenticated */}
      <Route path="/dashboard" element={authed ? <Dashboard /> : <Navigate to="/" replace />} />
      <Route path="/game/new" element={authed ? <HostSetup /> : <Navigate to="/" replace />} />
      <Route path="/game/:gameId/lobby" element={authed ? <Lobby /> : <Navigate to="/" replace />} />
      <Route path="/game/:gameId" element={authed ? <GameMap /> : <Navigate to="/" replace />} />
      <Route path="/game/:gameId/end" element={authed ? <EndScreen /> : <Navigate to="/" replace />} />

      {/* Fallback */}
      <Route path="*" element={<Navigate to={authed ? '/dashboard' : '/'} replace />} />
    </Routes>
  )
}

export default App
