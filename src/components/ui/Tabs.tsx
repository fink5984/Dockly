import { useState } from 'react'
import { cn } from '@/lib/utils'

interface Tab {
  id: string
  key?: string
  label: string
  badge?: string | number
}

interface TabsProps {
  tabs: Tab[]
  activeTab: string
  onChange: (key: string) => void
  className?: string
}

export function Tabs({ tabs, activeTab, onChange, className }: TabsProps) {
  return (
    <div className={cn('flex gap-1 border-b border-[var(--border-primary)]', className)}>
      {tabs.map((tab) => {
        const tabKey = tab.id || tab.key!
        return (
        <button
          key={tabKey}
          onClick={() => onChange(tabKey)}
          className={cn(
            'relative px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap',
            activeTab === tabKey
              ? 'text-primary-600 dark:text-primary-400'
              : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
          )}
        >
          <span className="flex items-center gap-2">
            {tab.label}
            {tab.badge !== undefined && tab.badge !== 0 && (
              <span className={cn(
                'text-[10px] font-bold px-1.5 py-0.5 rounded-full',
                activeTab === tabKey ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400' : 'bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]'
              )}>
                {tab.badge}
              </span>
            )}
          </span>
          {activeTab === tabKey && (
            <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary-600 dark:bg-primary-400 rounded-full" />
          )}
        </button>
        )
      })}
    </div>
  )
}

export function useTabState(initialTabs: Tab[] | string) {
  const defaultTab = typeof initialTabs === 'string' ? initialTabs : initialTabs[0]?.id || ''
  const tabs = typeof initialTabs === 'string' ? [] : initialTabs
  const [activeTab, setActiveTab] = useState(defaultTab)
  return { activeTab, setActiveTab, tabs }
}
