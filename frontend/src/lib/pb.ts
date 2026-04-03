import PocketBase from 'pocketbase'

const pbUrl = import.meta.env.VITE_PB_URL ?? 'https://api.railrushgame.com'

// Singleton PocketBase client — import this everywhere
export const pb = new PocketBase(pbUrl)

// Convenience: current authenticated user
export const currentUser = () => pb.authStore.model

export const isAuthenticated = () => pb.authStore.isValid

// Generic authenticated POST/GET helpers for custom /api/rr/* routes
async function rr<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${pbUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: pb.authStore.token ? `Bearer ${pb.authStore.token}` : '',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`)
  return data as T
}

export const api = {
  get:    <T>(path: string)                => rr<T>('GET',    path),
  post:   <T>(path: string, body?: unknown) => rr<T>('POST',   path, body),
  patch:  <T>(path: string, body?: unknown) => rr<T>('PATCH',  path, body),
  delete: <T>(path: string)                => rr<T>('DELETE', path),
}
