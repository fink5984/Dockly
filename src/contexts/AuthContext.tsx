import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { authApi, type Me } from '@/services'
import { onUnauthorized } from '@/lib/api'
import { clearCache } from '@/hooks/useApi'
import { startLive, stopLive, subscribeLive } from '@/lib/live'
import type { Language, Role, User, Workspace } from '@/types'
import type { BillingSummary } from '@/types/billing'
import { disablePush } from '@/lib/push'
import { markPasskeyOnDevice, signInWithPasskey } from '@/lib/passkeys'

interface AuthContextType {
  user: User | null
  workspace: Workspace | null
  /** Subscription summary (trial, plan, read-only) for banners and gating. Server enforces the real limits. */
  billing: BillingSummary | null
  isAuthenticated: boolean
  isLoading: boolean
  /** Workspace exists but onboarding (business name) isn't complete. */
  isOnboarding: boolean
  /**
   * Password sign-in. With `defer`, the session is created but the app isn't
   * entered until `enter(me)` (lets the sign-in page ask a follow-up first).
   */
  signIn: (email: string, password: string, opts?: { defer?: boolean }) => Promise<Me>
  enter: (me: Me) => void
  /** Fingerprint / face / device-lock sign-in with a passkey saved on this device. */
  signInWithPasskey: () => Promise<void>
  signUp: (d: { email: string; password: string; name: string; phone?: string; language?: Language; attribution?: Record<string, string> }) => Promise<void>
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
  const [state, setState] = useState<Me>({ user: null, workspace: null, billing: null })
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

  // Plan changes (checkout completed, trial ended, …) arrive as live events.
  useEffect(() => subscribeLive((evt) => { if (evt.topic === 'billing') refresh() }, { connect: false }), [refresh])

  // Session expired / revoked elsewhere → drop to signed-out state.
  useEffect(() => onUnauthorized(() => {
    clearCache()
    apply({ user: null, workspace: null })
  }), [apply])

  const value = useMemo<AuthContextType>(() => ({
    user: state.user,
    workspace: state.workspace,
    billing: state.billing ?? null,
    isAuthenticated: Boolean(state.user),
    isLoading,
    isOnboarding: Boolean(state.user && state.workspace && !state.workspace.name),
    signIn: async (email, password, opts) => {
      const me = await authApi.signIn(email, password)
      clearCache()
      if (!opts?.defer) apply(me)
      return me
    },
    enter: (me) => { clearCache(); apply(me) },
    signInWithPasskey: async () => {
      const me = await signInWithPasskey()
      if (me.user) markPasskeyOnDevice(me.user.id)
      clearCache()
      apply(me)
    },
    signUp: async (d) => { clearCache(); apply(await authApi.signUp(d)) },
    acceptInvite: async (token, name, password) => { clearCache(); apply(await authApi.acceptInvite(token, name, password)) },
    signOut: async () => {
      // Stop this device getting the signed-out user's notifications (needs the session, so first).
      await disablePush().catch(() => {})
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
