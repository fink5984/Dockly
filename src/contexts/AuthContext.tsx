import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { authApi, type Me } from '@/services'
import { onUnauthorized } from '@/lib/api'
import { clearCache } from '@/hooks/useApi'
import { startLive, stopLive } from '@/lib/live'
import type { Language, Role, User, Workspace } from '@/types'

interface AuthContextType {
  user: User | null
  workspace: Workspace | null
  isAuthenticated: boolean
  isLoading: boolean
  /** Workspace exists but onboarding (business name) isn't complete. */
  isOnboarding: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (d: { email: string; password: string; name: string; phone?: string; language?: Language }) => Promise<void>
  acceptInvite: (token: string, name: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  refresh: () => Promise<void>
  setWorkspace: (ws: Workspace) => void
  setUser: (u: User) => void
  can: (minimum: Role) => boolean
}

const AuthContext = createContext<AuthContextType | null>(null)
const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Me>({ user: null, workspace: null })
  const [isLoading, setIsLoading] = useState(true)

  const apply = useCallback((me: Me) => {
    setState(me)
    if (me.user) startLive()
    else stopLive()
  }, [])

  const refresh = useCallback(async () => {
    try {
      apply(await authApi.me())
    } catch {
      apply({ user: null, workspace: null })
    }
  }, [apply])

  useEffect(() => {
    refresh().finally(() => setIsLoading(false))
  }, [refresh])

  // Session expired / revoked elsewhere → drop to signed-out state.
  useEffect(() => onUnauthorized(() => {
    clearCache()
    apply({ user: null, workspace: null })
  }), [apply])

  const value = useMemo<AuthContextType>(() => ({
    user: state.user,
    workspace: state.workspace,
    isAuthenticated: Boolean(state.user),
    isLoading,
    isOnboarding: Boolean(state.user && state.workspace && !state.workspace.name),
    signIn: async (email, password) => { clearCache(); apply(await authApi.signIn(email, password)) },
    signUp: async (d) => { clearCache(); apply(await authApi.signUp(d)) },
    acceptInvite: async (token, name, password) => { clearCache(); apply(await authApi.acceptInvite(token, name, password)) },
    signOut: async () => {
      try { await authApi.signOut() } finally {
        clearCache()
        apply({ user: null, workspace: null })
      }
    },
    refresh,
    setWorkspace: (ws) => setState((s) => ({ ...s, workspace: ws })),
    setUser: (u) => setState((s) => ({ ...s, user: u })),
    can: (minimum) => Boolean(state.user && RANK[state.user.role] >= RANK[minimum]),
  }), [state, isLoading, apply, refresh])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
