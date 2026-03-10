import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { AppLayout } from '@/components/layout/AppLayout'

// Auth pages
import { SignInPage } from '@/pages/auth/SignInPage'
import { SignUpPage } from '@/pages/auth/SignUpPage'
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage'
import { OnboardingPage } from '@/pages/onboarding/OnboardingPage'

// App pages
import { DashboardPage } from '@/pages/dashboard/DashboardPage'
import { ClientsPage } from '@/pages/clients/ClientsPage'
import { ClientProfilePage } from '@/pages/clients/ClientProfilePage'
import { CasesPage } from '@/pages/cases/CasesPage'
import { CaseCreatePage } from '@/pages/cases/CaseCreatePage'
import { CaseDetailPage } from '@/pages/cases/CaseDetailPage'
import { DocumentsPage } from '@/pages/documents/DocumentsPage'
import { DocumentTypesPage } from '@/pages/document-types/DocumentTypesPage'
import { ActivityPage } from '@/pages/activity/ActivityPage'
import { WhatsAppPage } from '@/pages/whatsapp/WhatsAppPage'
import { SettingsPage } from '@/pages/settings/SettingsPage'

// Public pages (no auth required)
import { ClientUploadPortal } from '@/pages/upload/ClientUploadPortal'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isOnboarding, isLoading } = useAuth()
  if (isLoading) return null
  if (!isAuthenticated) return <Navigate to="/auth/signin" replace />
  if (isOnboarding) return <Navigate to="/onboarding" replace />
  return <>{children}</>
}

function AuthRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isOnboarding, isLoading } = useAuth()
  if (isLoading) return null
  if (isAuthenticated && isOnboarding) return <Navigate to="/onboarding" replace />
  if (isAuthenticated) return <Navigate to="/" replace />
  return <>{children}</>
}

function OnboardingRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isOnboarding, isLoading } = useAuth()
  if (isLoading) return null
  if (!isAuthenticated) return <Navigate to="/auth/signin" replace />
  if (!isOnboarding) return <Navigate to="/" replace />
  return <>{children}</>
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Auth routes */}
        <Route path="/auth/signin" element={<AuthRoute><SignInPage /></AuthRoute>} />
        <Route path="/auth/signup" element={<AuthRoute><SignUpPage /></AuthRoute>} />
        <Route path="/auth/forgot-password" element={<AuthRoute><ForgotPasswordPage /></AuthRoute>} />

        {/* Onboarding */}
        <Route path="/onboarding" element={<OnboardingRoute><OnboardingPage /></OnboardingRoute>} />

        {/* Public client upload portal (no auth) */}
        <Route path="/upload/:token" element={<ClientUploadPortal />} />

        {/* Protected app routes */}
        <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          <Route index element={<DashboardPage />} />
          <Route path="clients" element={<ClientsPage />} />
          <Route path="clients/:id" element={<ClientProfilePage />} />
          <Route path="requests" element={<CasesPage />} />
          <Route path="requests/create" element={<CaseCreatePage />} />
          <Route path="requests/:id" element={<CaseDetailPage />} />
          {/* Legacy redirects */}
          <Route path="cases" element={<Navigate to="/requests" replace />} />
          <Route path="cases/create" element={<Navigate to="/requests/create" replace />} />
          <Route path="cases/:id" element={<Navigate to="/requests" replace />} />
          <Route path="documents" element={<Navigate to="/requests" replace />} />
          <Route path="document-types" element={<DocumentTypesPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="whatsapp" element={<WhatsAppPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
