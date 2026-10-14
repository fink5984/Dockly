import { Compass } from 'lucide-react'
import { useI18n } from '@/contexts/I18nContext'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/States'

export default function NotFoundPage() {
  const { t } = useI18n()
  return (
    <EmptyState
      icon={<Compass />}
      title={t('errors.notFoundTitle')}
      description={t('errors.notFoundBody')}
      action={<Button to="/app" variant="primary">{t('errors.goHome')}</Button>}
    />
  )
}
