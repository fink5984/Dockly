import { Suspense } from 'react'
import { Outlet } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useApp } from '@/contexts/AppContext'
import { useI18n } from '@/contexts/I18nContext'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { CommandPalette } from './CommandPalette'
import { PageLoader } from './PageLoader'
import { ErrorBoundary } from './ErrorBoundary'
import { BillingBanner } from '@/components/billing/BillingBanner'
import { UpgradeDialog } from '@/components/billing/UpgradeDialog'

export function AppLayout() {
  const { sidebarCollapsed } = useApp()
  const { t } = useI18n()
  return (
    <div className="min-h-dvh bg-canvas">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-[400] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow-lg">
        {t('nav.skipToContent')}
      </a>
      <Sidebar />
      <div className={cn('flex min-h-dvh flex-col transition-[padding] duration-200', sidebarCollapsed ? 'lg:ps-[68px]' : 'lg:ps-60')}>
        <Topbar />
        <BillingBanner />
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 focus:outline-none sm:px-6 lg:px-8 lg:py-8">
          <ErrorBoundary>
            <Suspense fallback={<PageLoader />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
      <CommandPalette />
      <UpgradeDialog />
    </div>
  )
}
