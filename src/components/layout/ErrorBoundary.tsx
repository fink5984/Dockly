import { Component, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { translate } from '@/i18n'

interface State { error: Error | null }

/** Catches render errors so one broken view doesn't blank the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    // Lazy chunk failed after a deploy → reload once to fetch the new build.
    if (/Failed to fetch dynamically imported module|Importing a module script failed/.test(error.message) && !sessionStorage.getItem('dockly-reloaded')) {
      sessionStorage.setItem('dockly-reloaded', '1')
      window.location.reload()
    }
  }

  render() {
    if (!this.state.error) return this.props.children
    const lang = document.documentElement.lang === 'he' ? 'he' : 'en'
    return (
      <div role="alert" className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
        <div className="mb-4 flex size-11 items-center justify-center rounded-full bg-danger-soft text-danger"><AlertTriangle className="size-5" /></div>
        <h2 className="text-lg font-semibold">{translate(lang, 'errors.crashTitle')}</h2>
        <p className="mt-1 text-sm text-fg-3">{translate(lang, 'errors.crashBody')}</p>
        <button type="button" onClick={() => window.location.reload()} className="mt-5 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-brand-fg hover:bg-brand-700">
          {translate(lang, 'errors.reload')}
        </button>
      </div>
    )
  }
}
