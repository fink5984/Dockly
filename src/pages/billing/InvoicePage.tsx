import { useParams } from 'react-router-dom'
import { ExternalLink, Printer } from 'lucide-react'
import { useI18n } from '@/contexts/I18nContext'
import { useApi } from '@/hooks/useApi'
import { billingApi } from '@/services'
import { catalog, money } from '@/lib/billing'
import { PageHeader } from '@/components/ui/Misc'
import { Card, CardBody, DetailRow } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ErrorState, ListSkeleton } from '@/components/ui/States'
import { Logo } from '@/components/brand/Logo'

const LINE_NAMES: Record<string, string> = { proration: 'billing.invoices.kind.proration' }

/** Printable payment summary. The tax document itself is issued by the payment provider. */
export default function InvoicePage() {
  const { id = '' } = useParams()
  const { t, fmt, language } = useI18n()
  const { data, error, refetch } = useApi(`billing:invoice:${id}`, () => billingApi.invoice(id))
  const lineName = (code: string) => {
    if (LINE_NAMES[code]) return t(LINE_NAMES[code])
    const plan = catalog.plans.find((p) => p.code === code)
    if (plan) return `${t(`billing.family.${plan.family}`)} · ${t(`billing.tier.${plan.tier}`)}`
    if (catalog.addons.some((a) => a.code === code)) return t(`billing.addons.${code}`)
    if (catalog.packs.some((p) => p.code === code)) return t(`billing.packs.${code}`)
    return code
  }
  return (
    <>
      <PageHeader
        title={t('billing.invoices.receiptTitle')}
        breadcrumbs={[{ label: t('billing.title'), to: '/app/billing' }, { label: data?.number || '' }]}
        actions={data && <>
          {data.documentUrl && <Button icon={<ExternalLink className="size-4" />} onClick={() => window.open(data.documentUrl!, '_blank', 'noopener')}>{t('billing.invoices.taxDoc')}</Button>}
          <Button icon={<Printer className="size-4" />} onClick={() => window.print()}>{t('billing.invoices.print')}</Button>
        </>}
      />
      <Card className="mx-auto max-w-2xl print:border-0 print:shadow-none">
        {error ? <ErrorState onRetry={refetch} /> : !data ? <ListSkeleton rows={6} /> : (
          <CardBody className="space-y-6 pt-6">
            <div className="flex items-start justify-between gap-4">
              <Logo className="h-8" />
              <div className="text-end text-sm">
                <p className="font-semibold tabular" dir="ltr">{data.number}</p>
                <p className="text-fg-3">{fmt.date(data.paidAt || data.createdAt)}</p>
                <Badge tone={data.status === 'paid' ? 'success' : 'neutral'}>{t(`billing.invoices.st.${data.status}`)}</Badge>
              </div>
            </div>
            <dl className="divide-y divide-line">
              <DetailRow label={t('billing.invoices.billedTo')}>{data.billedTo.name}{data.billedTo.taxId ? ` · ${data.billedTo.taxId}` : ''}</DetailRow>
              {data.periodStart && data.periodEnd && <DetailRow label={t('billing.invoices.period')}>{fmt.date(data.periodStart)} – {fmt.date(data.periodEnd)}</DetailRow>}
              {data.documentNumber && <DetailRow label={t('billing.invoices.taxDoc')}>{data.documentNumber}</DetailRow>}
            </dl>
            <table className="w-full text-sm">
              <caption className="sr-only">{t('billing.invoices.description')}</caption>
              <tbody className="divide-y divide-line">
                {data.lines.map((l, i) => (
                  <tr key={i}>
                    <td className="py-2.5">{lineName(l.code)}{l.qty > 1 ? ` × ${l.qty}` : ''}</td>
                    <td className="py-2.5 text-end tabular">{money(l.total, language)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-line">
                <tr><td className="pt-3 text-fg-3">{t('billing.action.subtotal')}</td><td className="pt-3 text-end tabular">{money(data.subtotal, language)}</td></tr>
                <tr><td className="text-fg-3">{t('billing.action.vat', { rate: Math.round(catalog.vatRate * 100) })}</td><td className="text-end tabular">{money(data.vat, language)}</td></tr>
                <tr><td className="pt-1 font-semibold">{t('billing.action.total')}</td><td className="pt-1 text-end text-md font-semibold tabular">{money(data.total, language)}</td></tr>
              </tfoot>
            </table>
            <p className="rounded-md bg-surface-2 px-3 py-2 text-xs text-fg-3">{data.provider === 'sandbox' ? t('billing.invoices.sandboxNote') : t('billing.invoices.notTax')}</p>
          </CardBody>
        )}
      </Card>
    </>
  )
}
