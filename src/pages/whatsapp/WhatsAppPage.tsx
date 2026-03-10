import { useState } from 'react'
import { useI18n } from '@/contexts/I18nContext'
import { useAuth } from '@/contexts/AuthContext'
import { Card, CardHeader, CardContent } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Textarea, Select } from '@/components/ui/Input'
import { Tabs, useTabState } from '@/components/ui/Tabs'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/lib/utils'
import { useSupabaseData } from '@/hooks/useSupabaseData'
import { getWhatsAppConfig, getMessageTemplates, getAutomationRules } from '@/services/settingsService'
import {
  MessageCircle, Wifi, WifiOff, Phone, QrCode, Plus, Edit2, Trash2, Play, Pause,
  Send, Clock, Zap, FileText, CheckCircle, Bell, Settings, RefreshCw, Copy
} from 'lucide-react'

const defaultWaConfig = { connected: false, isConnected: false, phoneNumber: '', lastSync: '', connectedAt: '', messagesSent: 0, messagesReceived: 0 }

export function WhatsAppPage() {
  const { t } = useI18n()
  const { workspace } = useAuth()

  const { data: waConfig } = useSupabaseData(
    () => workspace ? getWhatsAppConfig(workspace.id) : Promise.resolve(null),
    null,
    [workspace?.id]
  )
  const { data: templates } = useSupabaseData(getMessageTemplates, [])
  const { data: rules } = useSupabaseData(getAutomationRules, [])

  const whatsappConfig = waConfig ?? defaultWaConfig

  const { activeTab, setActiveTab, tabs } = useTabState([
    { id: 'connection', label: t('whatsapp.connection') },
    { id: 'templates', label: t('whatsapp.templates'), badge: templates.length },
    { id: 'automation', label: t('whatsapp.automation'), badge: rules.length },
    { id: 'conversations', label: t('whatsapp.conversations') },
  ])

  const [showTemplateModal, setShowTemplateModal] = useState(false)

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <MessageCircle className="w-6 h-6 text-green-500" />
            {t('whatsapp.title')}
          </h1>
          <p className="text-sm text-[var(--text-tertiary)] mt-1">{t('whatsapp.subtitle')}</p>
        </div>
        <Badge variant="status" status={whatsappConfig.isConnected ? 'approved' : 'missing'} size="md">
          {whatsappConfig.isConnected ? (
            <span className="flex items-center gap-1"><Wifi className="w-3 h-3" /> {t('whatsapp.connected')}</span>
          ) : (
            <span className="flex items-center gap-1"><WifiOff className="w-3 h-3" /> {t('whatsapp.disconnected')}</span>
          )}
        </Badge>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {/* Connection */}
      {activeTab === 'connection' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader title={t('whatsapp.connectionStatus')} />
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center gap-4 p-4 bg-green-50 dark:bg-green-950/20 rounded-xl border border-green-200 dark:border-green-800">
                  <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center">
                    <MessageCircle className="w-6 h-6 text-green-600" />
                  </div>
                  <div>
                    <p className="font-medium text-green-700 dark:text-green-400">{t('whatsapp.whatsappBusiness')}</p>
                    <p className="text-sm text-green-600 dark:text-green-300">{whatsappConfig.phoneNumber}</p>
                    <p className="text-xs text-green-500">{t('whatsapp.connectedSince')}: {whatsappConfig.connectedAt || 'Jan 15, 2025'}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 bg-[var(--bg-tertiary)] rounded-lg text-center">
                    <p className="text-2xl font-bold text-primary-600">{whatsappConfig.messagesSent}</p>
                    <p className="text-xs text-[var(--text-tertiary)]">{t('whatsapp.messagesSent')}</p>
                  </div>
                  <div className="p-3 bg-[var(--bg-tertiary)] rounded-lg text-center">
                    <p className="text-2xl font-bold text-green-600">{whatsappConfig.messagesReceived}</p>
                    <p className="text-xs text-[var(--text-tertiary)]">{t('whatsapp.messagesReceived')}</p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button variant="outline" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} className="flex-1">{t('whatsapp.refreshConnection')}</Button>
                  <Button variant="danger" size="sm" icon={<WifiOff className="w-3.5 h-3.5" />} className="flex-1">{t('whatsapp.disconnect')}</Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader title={t('whatsapp.integrationReadiness')} />
            <CardContent>
              <div className="space-y-3">
                {[
                  { label: t('whatsapp.accountConnected'), ready: whatsappConfig.isConnected, icon: Phone },
                  { label: t('whatsapp.templatesConfigured'), ready: templates.length > 0, icon: FileText },
                  { label: t('whatsapp.automationRules'), ready: rules.some(r => r.isActive), icon: Zap },
                  { label: t('whatsapp.webhookSetup'), ready: true, icon: Settings },
                ].map((item, i) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-[var(--bg-tertiary)] rounded-lg">
                    <div className="flex items-center gap-2">
                      <item.icon className="w-4 h-4 text-[var(--text-tertiary)]" />
                      <p className="text-sm">{item.label}</p>
                    </div>
                    {item.ready ? (
                      <CheckCircle className="w-5 h-5 text-green-500" />
                    ) : (
                      <Badge variant="status" status="warning" size="sm">{t('whatsapp.setup')}</Badge>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Templates */}
      {activeTab === 'templates' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setShowTemplateModal(true)} icon={<Plus className="w-4 h-4" />}>{t('whatsapp.createTemplate')}</Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map(tpl => (
              <Card key={tpl.id} hover>
                <div className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-green-500" />
                      <p className="text-sm font-semibold">{tpl.name}</p>
                    </div>
                    <Badge variant="status" status={tpl.isActive ? 'approved' : 'missing'} size="sm">
                      {tpl.isActive ? t('common.active') : t('common.inactive')}
                    </Badge>
                  </div>
                  <p className="text-xs text-[var(--text-tertiary)] mb-2 capitalize">{tpl.trigger.replace(/_/g, ' ')}</p>
                  <div className="p-2.5 bg-[var(--bg-tertiary)] rounded-lg mb-3">
                    <p className="text-xs leading-relaxed line-clamp-3">{tpl.bodyTemplate}</p>
                  </div>
                  <div className="flex items-center justify-between text-xs text-[var(--text-tertiary)]">
                    <span>{tpl.language.toUpperCase()}</span>
                    <div className="flex gap-1">
                      <button className="p-1 rounded hover:bg-[var(--bg-hover)]"><Edit2 className="w-3 h-3" /></button>
                      <button className="p-1 rounded hover:bg-[var(--bg-hover)]"><Copy className="w-3 h-3" /></button>
                      <button className="p-1 rounded hover:bg-[var(--bg-hover)] text-red-400"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          <Modal isOpen={showTemplateModal} onClose={() => setShowTemplateModal(false)} title={t('whatsapp.createTemplate')} size="md">
            <div className="space-y-4">
              <Input label={t('whatsapp.templateName')} placeholder="e.g., Document Reminder" />
              <Select
                label={t('whatsapp.trigger')}
                options={[
                  { value: 'document_reminder', label: 'Document Reminder' },
                  { value: 'case_created', label: 'Case Created' },
                  { value: 'document_approved', label: 'Document Approved' },
                  { value: 'document_rejected', label: 'Document Rejected' },
                  { value: 'case_completed', label: 'Case Completed' },
                ]}
              />
              <Select label={t('common.language')} options={[{ value: 'en', label: 'English' }, { value: 'he', label: 'Hebrew' }]} />
              <Textarea label={t('whatsapp.messageBody')} rows={4} placeholder="Hi {{clientName}}, ..." />
              <p className="text-xs text-[var(--text-tertiary)]">{t('whatsapp.variablesHint')}: {'{{clientName}}, {{caseName}}, {{documentName}}, {{deadline}}'}</p>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => setShowTemplateModal(false)}>{t('common.cancel')}</Button>
                <Button onClick={() => setShowTemplateModal(false)}>{t('common.create')}</Button>
              </div>
            </div>
          </Modal>
        </div>
      )}

      {/* Automation */}
      {activeTab === 'automation' && (
        <div className="space-y-3">
          {rules.map(rule => (
            <Card key={rule.id}>
              <div className="p-4 flex items-center gap-4">
                <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', rule.isActive ? 'bg-green-100 dark:bg-green-900' : 'bg-gray-100 dark:bg-gray-800')}>
                  <Zap className={cn('w-5 h-5', rule.isActive ? 'text-green-600' : 'text-gray-400')} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">{rule.name}</p>
                    <Badge variant="status" status={rule.isActive ? 'approved' : 'missing'} size="sm">
                      {rule.isActive ? t('common.active') : t('common.inactive')}
                    </Badge>
                  </div>
                  <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                    {t('whatsapp.trigger')}: <span className="font-medium capitalize">{rule.trigger.replace(/_/g, ' ')}</span>
                    {rule.delayMinutes > 0 && <> • {t('whatsapp.delay')}: {rule.delayMinutes} min</>}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)]">
                    {rule.isActive ? <Pause className="w-4 h-4 text-amber-500" /> : <Play className="w-4 h-4 text-green-500" />}
                  </button>
                  <button className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)]"><Edit2 className="w-4 h-4 text-[var(--text-tertiary)]" /></button>
                  <button className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] text-red-400"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            </Card>
          ))}
          <Button variant="outline" icon={<Plus className="w-4 h-4" />} className="w-full">{t('whatsapp.addRule')}</Button>
        </div>
      )}

      {/* Conversations */}
      {activeTab === 'conversations' && (
        <Card>
          <CardContent className="py-8">
            <div className="text-center space-y-3">
              <div className="w-16 h-16 rounded-2xl bg-green-100 dark:bg-green-900 flex items-center justify-center mx-auto">
                <MessageCircle className="w-8 h-8 text-green-500" />
              </div>
              <h3 className="text-lg font-semibold">{t('whatsapp.conversationsPreview')}</h3>
              <p className="text-sm text-[var(--text-tertiary)] max-w-md mx-auto">{t('whatsapp.conversationsDesc')}</p>
              <div className="flex justify-center gap-2 pt-2">
                <Badge variant="status" status="info" size="sm">{t('whatsapp.comingSoon')}</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
