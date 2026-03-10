import { Outlet } from 'react-router-dom'
import { useI18n } from '@/contexts/I18nContext'
import { useApp } from '@/contexts/AppContext'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { ToastContainer } from '@/components/ui/Toast'
import { cn } from '@/lib/utils'

export function AppLayout() {
  const { direction } = useI18n()
  const { sidebarOpen } = useApp()
  const isRtl = direction === 'rtl'

  return (
    <div className="min-h-screen bg-[var(--bg-secondary)]" dir={direction}>
      <Sidebar />
      <div
        className={cn(
          'transition-all duration-300 ease-in-out',
          isRtl
            ? sidebarOpen ? 'lg:mr-64' : 'lg:mr-[72px]'
            : sidebarOpen ? 'lg:ml-64' : 'lg:ml-[72px]'
        )}
      >
        <Topbar />
        <main className="p-4 lg:p-6 max-w-[1600px] mx-auto">
          <Outlet />
        </main>
      </div>
      <ToastContainer />
    </div>
  )
}
