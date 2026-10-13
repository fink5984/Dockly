import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, createRoutesFromElements, Navigate, Outlet, Route, RouterProvider, useLocation, useParams } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { AppLayout } from '@/components/layout/AppLayout'
import { FullPageLoader } from '@/components/layout/PageLoader'
import { ErrorBoundary } from '@/components/layout/ErrorBoundary'
import { ToastViewport } from '@/components/ui/Toast'

// Route-level code splitting: each screen is its own chunk.
const SignInPage = lazy(() => import('@/pages/auth/SignInPage'))
const SignUpPage = lazy(() => import('@/pages/auth/SignUpPage'))
const ForgotPasswordPage = lazy(() => import('@/pages/auth/ForgotPasswordPage'))
const InvitePage = lazy(() => import('@/pages/auth/InvitePage'))
const OnboardingPage = lazy(() => import('@/pages/onboarding/OnboardingPage'))
const DashboardPage = lazy(() => import('@/pages/dashboard/DashboardPage'))
const RequestsPage = lazy(() => import('@/pages/requests/RequestsPage'))
const RequestCreatePage = lazy(() => import('@/pages/requests/RequestCreatePage'))
const RequestDetailPage = lazy(() => import('@/pages/requests/RequestDetailPage'))
const ClientsPage = lazy(() => import('@/pages/clients/ClientsPage'))
const ClientProfilePage = lazy(() => import('@/pages/clients/ClientProfilePage'))
const SignaturesPage = lazy(() => import('@/pages/signatures/SignaturesPage'))
const SignatureCreatePage = lazy(() => import('@/pages/signatures/SignatureCreatePage'))
const SignatureDetailPage = lazy(() => import('@/pages/signatures/SignatureDetailPage'))
const DocumentsPage = lazy(() => import('@/pages/documents/DocumentsPage'))
const ActivityPage = lazy(() => import('@/pages/activity/ActivityPage'))
const TemplatesPage = lazy(() => import('@/pages/templates/TemplatesPage'))
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage'))
const ClientPortalPage = lazy(() => import('@/pages/portal/ClientPortalPage'))
const SignPage = lazy(() => import('@/pages/portal/SignPage'))
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))

function Protected({ children }: { children: ReactNode }) {
  const { isAuthenticated, isOnboarding, isLoading } = useAuth()
  const location = useLocation()
  if (isLoading) return <FullPageLoader />
  if (!isAuthenticated) return <Navigate to="/auth/signin" replace state={{ from: location.pathname + location.search }} />
  if (isOnboarding) return <Navigate to="/onboarding" replace />
  return <>{children}</>
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { isAuthenticated, isOnboarding, isLoading } = useAuth()
  if (isLoading) return <FullPageLoader />
  if (isAuthenticated) return <Navigate to={isOnboarding ? '/onboarding' : '/'} replace />
  return <>{children}</>
}

function OnboardingOnly({ children }: { children: ReactNode }) {
  const { isAuthenticated, isOnboarding, isLoading } = useAuth()
  if (isLoading) return <FullPageLoader />
  if (!isAuthenticated) return <Navigate to="/auth/signin" replace />
  if (!isOnboarding) return <Navigate to="/" replace />
  return <>{children}</>
}

function LegacyCaseRedirect() {
  const { id } = useParams()
  return <Navigate to={id ? `/requests/${id}` : '/requests'} replace />
}

function Root() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<FullPageLoader />}>
        <Outlet />
      </Suspense>
      <ToastViewport />
    </ErrorBoundary>
  )
}

const router = createBrowserRouter(createRoutesFromElements(
  <Route element={<Root />}>
    <Route path="/auth/signin" element={<GuestOnly><SignInPage /></GuestOnly>} />
    <Route path="/auth/signup" element={<GuestOnly><SignUpPage /></GuestOnly>} />
    <Route path="/auth/forgot-password" element={<GuestOnly><ForgotPasswordPage /></GuestOnly>} />
    <Route path="/auth/invite/:token" element={<GuestOnly><InvitePage /></GuestOnly>} />
    <Route path="/onboarding" element={<OnboardingOnly><OnboardingPage /></OnboardingOnly>} />

    {/* Public client-facing pages (token links) */}
    <Route path="/p/:token" element={<ClientPortalPage />} />
    <Route path="/upload/:token" element={<ClientPortalPage />} />
    <Route path="/sign/:token" element={<SignPage />} />

    <Route element={<Protected><AppLayout /></Protected>}>
      <Route index element={<DashboardPage />} />
      <Route path="requests" element={<RequestsPage />} />
      <Route path="requests/new" element={<RequestCreatePage />} />
      <Route path="requests/:id" element={<RequestDetailPage />} />
      <Route path="clients" element={<ClientsPage />} />
      <Route path="clients/:id" element={<ClientProfilePage />} />
      <Route path="signatures" element={<SignaturesPage />} />
      <Route path="signatures/new" element={<SignatureCreatePage />} />
      <Route path="signatures/:id" element={<SignatureDetailPage />} />
      <Route path="documents" element={<DocumentsPage />} />
      <Route path="activity" element={<ActivityPage />} />
      <Route path="templates" element={<TemplatesPage />} />
      <Route path="settings" element={<SettingsPage />} />
      <Route path="settings/:section" element={<SettingsPage />} />

      {/* Legacy URLs */}
      <Route path="cases" element={<Navigate to="/requests" replace />} />
      <Route path="cases/:id" element={<LegacyCaseRedirect />} />
      <Route path="requests/create" element={<Navigate to="/requests/new" replace />} />
      <Route path="signatures/create" element={<Navigate to="/signatures/new" replace />} />
      <Route path="document-types" element={<Navigate to="/templates?tab=types" replace />} />
      <Route path="whatsapp" element={<Navigate to="/settings/integrations" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Route>
  </Route>,
))

export function App() {
  return <RouterProvider router={router} />
}
