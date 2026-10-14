import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, createRoutesFromElements, Navigate, Outlet, Route, RouterProvider, useLocation, useParams } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { AppLayout } from '@/components/layout/AppLayout'
import { FullPageLoader } from '@/components/layout/PageLoader'
import { ErrorBoundary } from '@/components/layout/ErrorBoundary'
import { ToastViewport } from '@/components/ui/Toast'
import type { MarketingPageKey } from '@/marketing/routes'

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
const BillingPage = lazy(() => import('@/pages/billing/BillingPage'))
const CheckoutReturnPage = lazy(() => import('@/pages/billing/CheckoutReturnPage'))
const InvoicePage = lazy(() => import('@/pages/billing/InvoicePage'))
const SandboxCheckoutPage = lazy(() => import('@/pages/billing/SandboxCheckoutPage'))
const ClientPortalPage = lazy(() => import('@/pages/portal/ClientPortalPage'))
const SignPage = lazy(() => import('@/pages/portal/SignPage'))
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'))
// In production the marketing pages are prerendered static HTML served by the
// API server; this client-side version is used in development and for
// in-app navigation to a marketing URL.
const MarketingRoute = lazy(() => import('@/marketing/MarketingRoute'))

/** Dashboard routes now live under /app; these are the paths used before. */
export const LEGACY_APP_PREFIXES = ['requests', 'cases', 'clients', 'signatures', 'documents', 'document-types', 'activity', 'templates', 'settings', 'whatsapp']

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
  if (isAuthenticated) return <Navigate to={isOnboarding ? '/onboarding' : '/app'} replace />
  return <>{children}</>
}

function OnboardingOnly({ children }: { children: ReactNode }) {
  const { isAuthenticated, isOnboarding, isLoading } = useAuth()
  if (isLoading) return <FullPageLoader />
  if (!isAuthenticated) return <Navigate to="/auth/signin" replace />
  if (!isOnboarding) return <Navigate to="/app" replace />
  return <>{children}</>
}

/** Owners and admins see billing; everyone else is sent to the overview. */
function BillingAccess({ children }: { children: ReactNode }) {
  const { can } = useAuth()
  return can('admin') ? <>{children}</> : <Navigate to="/app" replace />
}

/** `/` shows the marketing home to visitors and the dashboard to signed-in users. */
function Home() {
  const { isAuthenticated, isLoading } = useAuth()
  if (isLoading) return <FullPageLoader />
  if (isAuthenticated) return <Navigate to="/app" replace />
  return <MarketingRoute page="home" lang="he" />
}

/** /requests/123?x=1 → /app/requests/123?x=1 (bookmarks, old emails, stored notifications). */
function LegacyAppRedirect() {
  const { pathname, search, hash } = useLocation()
  return <Navigate to={`/app${pathname}${search}${hash}`} replace />
}

function LegacyCaseRedirect() {
  const { id } = useParams()
  return <Navigate to={id ? `/app/requests/${id}` : '/app/requests'} replace />
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

const marketing: { path: string; page: MarketingPageKey; lang: 'he' | 'en' }[] = [
  { path: '/en', page: 'home', lang: 'en' },
  { path: '/pricing', page: 'pricing', lang: 'he' }, { path: '/en/pricing', page: 'pricing', lang: 'en' },
  { path: '/privacy', page: 'privacy', lang: 'he' }, { path: '/en/privacy', page: 'privacy', lang: 'en' },
  { path: '/terms', page: 'terms', lang: 'he' }, { path: '/en/terms', page: 'terms', lang: 'en' },
  { path: '/accessibility', page: 'accessibility', lang: 'he' }, { path: '/en/accessibility', page: 'accessibility', lang: 'en' },
]

const router = createBrowserRouter(createRoutesFromElements(
  <Route element={<Root />}>
    {/* Public marketing site */}
    <Route index element={<Home />} />
    {marketing.map((m) => <Route key={m.path} path={m.path} element={<MarketingRoute page={m.page} lang={m.lang} />} />)}

    <Route path="/auth/signin" element={<GuestOnly><SignInPage /></GuestOnly>} />
    <Route path="/auth/signup" element={<GuestOnly><SignUpPage /></GuestOnly>} />
    <Route path="/auth/forgot-password" element={<GuestOnly><ForgotPasswordPage /></GuestOnly>} />
    <Route path="/auth/invite/:token" element={<GuestOnly><InvitePage /></GuestOnly>} />
    <Route path="/onboarding" element={<OnboardingOnly><OnboardingPage /></OnboardingOnly>} />

    {/* Public client-facing pages (token links) — unchanged */}
    <Route path="/p/:token" element={<ClientPortalPage />} />
    <Route path="/upload/:token" element={<ClientPortalPage />} />
    <Route path="/sign/:token" element={<SignPage />} />

    {/* Simulated payment page (sandbox provider only) */}
    <Route path="/billing/sandbox/:ref" element={<SandboxCheckoutPage />} />

    {/* Authenticated dashboard */}
    <Route path="/app" element={<Protected><AppLayout /></Protected>}>
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
      <Route path="settings/billing" element={<Navigate to="/app/billing" replace />} />
      <Route path="settings/:section" element={<SettingsPage />} />
      <Route path="billing" element={<BillingAccess><BillingPage /></BillingAccess>} />
      <Route path="billing/return" element={<BillingAccess><CheckoutReturnPage /></BillingAccess>} />
      <Route path="billing/invoices/:id" element={<BillingAccess><InvoicePage /></BillingAccess>} />

      {/* Older URL shapes inside the app */}
      <Route path="cases" element={<Navigate to="/app/requests" replace />} />
      <Route path="cases/:id" element={<LegacyCaseRedirect />} />
      <Route path="requests/create" element={<Navigate to="/app/requests/new" replace />} />
      <Route path="signatures/create" element={<Navigate to="/app/signatures/new" replace />} />
      <Route path="document-types" element={<Navigate to="/app/templates?tab=types" replace />} />
      <Route path="whatsapp" element={<Navigate to="/app/settings/integrations" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Route>

    {/* Dashboard URLs from before /app existed */}
    {LEGACY_APP_PREFIXES.map((p) => <Route key={p} path={`/${p}/*`} element={<LegacyAppRedirect />} />)}

    <Route path="*" element={<MarketingRoute page="notFound" lang="he" />} />
  </Route>,
))

export function App() {
  return <RouterProvider router={router} />
}
