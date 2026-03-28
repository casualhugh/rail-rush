import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { pb } from '../lib/pb'

export default function JoinRedirect() {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()

  useEffect(() => {
    if (!code) { navigate('/'); return }
    if (!pb.authStore.isValid) {
      navigate(`/?redirect=/join/${code}`, { replace: true })
      return
    }
    resolveGame(code.toUpperCase())
  }, [code])

  async function resolveGame(inviteCode: string) {
    try {
      const results = await pb.collection('games').getList(1, 1, {
        filter: `invite_code = "${inviteCode}"`,
      })
      if (results.items.length === 0) {
        navigate('/dashboard')
        return
      }
      navigate(`/game/${results.items[0].id}/lobby`, { replace: true })
    } catch {
      navigate('/dashboard')
    }
  }

  return null
}
