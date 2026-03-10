import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import type { User, Workspace } from '@/types'
import { supabase } from '@/lib/supabase'
import { mapUser, mapWorkspace } from '@/lib/mappers'

const SESSION_KEY = 'dockly_session'

interface AuthContextType {
  user: User | null
  workspace: Workspace | null
  isAuthenticated: boolean
  isLoading: boolean
  isOnboarding: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (data: SignUpData) => Promise<void>
  signOut: () => void
  completeOnboarding: (workspace: Workspace) => void
  refreshProfile: () => Promise<void>
}

interface SignUpData {
  email: string
  password: string
  name: string
  phone: string
}

const AuthContext = createContext<AuthContextType | null>(null)

/** Load user + workspace from profiles table */
async function fetchProfile(userId: string): Promise<{ user: User; workspace: Workspace } | null> {
  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()

  if (profileErr || !profile) return null

  const { data: ws, error: wsErr } = await supabase
    .from('workspaces')
    .select('*')
    .eq('id', profile.workspace_id)
    .single()

  if (wsErr || !ws) {
    return {
      user: mapUser(profile),
      workspace: null as unknown as Workspace,
    }
  }

  const appUser = mapUser(profile)
  appUser.workspace = mapWorkspace(ws)

  return {
    user: appUser,
    workspace: mapWorkspace(ws),
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isOnboarding, setIsOnboarding] = useState(false)

  // Restore session from localStorage on mount
  useEffect(() => {
    let mounted = true

    const savedUserId = localStorage.getItem(SESSION_KEY)
    if (savedUserId) {
      fetchProfile(savedUserId).then((result) => {
        if (!mounted) return
        if (result) {
          setUser(result.user)
          setWorkspace(result.workspace)
          if (!result.workspace?.name) {
            setIsOnboarding(true)
          }
        } else {
          // Invalid saved session — clear it
          localStorage.removeItem(SESSION_KEY)
        }
        setIsLoading(false)
      })
    } else {
      setIsLoading(false)
    }

    return () => { mounted = false }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    // Query profiles table for matching email + password
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('email', email)
      .eq('password', password)
      .single()

    if (error || !profile) {
      throw new Error('Invalid email or password')
    }

    // Save session
    localStorage.setItem(SESSION_KEY, profile.id)

    // Load full profile + workspace
    const result = await fetchProfile(profile.id)
    if (result) {
      setUser(result.user)
      setWorkspace(result.workspace)
      if (!result.workspace?.name) {
        setIsOnboarding(true)
      }
    }
  }, [])

  const signUp = useCallback(async (data: SignUpData) => {
    // Check if email already exists
    const { data: existing } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', data.email)
      .maybeSingle()

    if (existing) {
      throw new Error('An account with this email already exists')
    }

    // 1. Create workspace
    const { data: ws, error: wsErr } = await supabase
      .from('workspaces')
      .insert({
        name: '',
        business_type: 'other',
        contact_person: data.name,
        phone: data.phone,
        email: data.email,
        default_language: 'en',
        timezone: 'UTC',
      })
      .select()
      .single()

    if (wsErr || !ws) {
      throw new Error('Failed to create workspace')
    }

    // 2. Create profile with password
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .insert({
        workspace_id: ws.id,
        email: data.email,
        name: data.name,
        role: 'owner',
        phone: data.phone,
        password: data.password,
      })
      .select()
      .single()

    if (profileErr || !profile) {
      // Clean up workspace if profile creation failed
      await supabase.from('workspaces').delete().eq('id', ws.id)
      throw new Error('Failed to create account')
    }

    // Save session
    localStorage.setItem(SESSION_KEY, profile.id)

    const appUser = mapUser(profile)
    appUser.workspace = mapWorkspace(ws)

    setUser(appUser)
    setWorkspace(mapWorkspace(ws))
    setIsOnboarding(true)
  }, [])

  const signOut = useCallback(() => {
    localStorage.removeItem(SESSION_KEY)
    setUser(null)
    setWorkspace(null)
    setIsOnboarding(false)
  }, [])

  const completeOnboarding = useCallback((ws: Workspace) => {
    setWorkspace(ws)
    setIsOnboarding(false)
  }, [])

  const refreshProfile = useCallback(async () => {
    const savedUserId = localStorage.getItem(SESSION_KEY)
    if (savedUserId) {
      const result = await fetchProfile(savedUserId)
      if (result) {
        setUser(result.user)
        setWorkspace(result.workspace)
      }
    }
  }, [])

  return (
    <AuthContext.Provider
      value={{
        user,
        workspace,
        isAuthenticated: !!user,
        isLoading,
        isOnboarding,
        signIn,
        signUp,
        signOut,
        completeOnboarding,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
