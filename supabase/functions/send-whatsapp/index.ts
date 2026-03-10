// supabase/functions/send-whatsapp/index.ts
// Supabase Edge Function: Send WhatsApp message to client with document upload link
//
// Environment variables (set in Supabase Dashboard → Edge Functions → Secrets):
//   WHATSAPP_ACCESS_TOKEN  – Meta WhatsApp Cloud API permanent token
//   WHATSAPP_PHONE_ID      – WhatsApp Business phone number ID
//   WHATSAPP_VERIFY_TOKEN  – Webhook verification token (for incoming)
//   APP_BASE_URL           – e.g. https://app.dockly.io
//   SUPABASE_URL           – auto-injected
//   SUPABASE_SERVICE_ROLE_KEY – auto-injected

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { action, workspaceId, caseId, clientId, phoneNumber, language } = await req.json()

    if (action === 'send_document_request') {
      // 1. Fetch case details with required documents
      const { data: caseData, error: caseErr } = await supabase
        .from('cases')
        .select('*')
        .eq('id', caseId)
        .single()

      if (caseErr || !caseData) {
        return new Response(
          JSON.stringify({ error: 'Case not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // 2. Fetch required documents for this case
      const { data: caseDocs } = await supabase
        .from('case_documents')
        .select('id, document_type_id, status, is_required')
        .eq('case_id', caseId)

      // 3. Fetch document type names
      const docTypeIds = (caseDocs ?? []).map((d: any) => d.document_type_id)
      const { data: docTypes } = await supabase
        .from('document_types')
        .select('id, name')
        .in('id', docTypeIds)

      const docTypeMap = new Map((docTypes ?? []).map((dt: any) => [dt.id, dt.name]))

      // 4. Filter only missing/pending documents
      const pendingDocs = (caseDocs ?? []).filter((d: any) =>
        ['missing', 'pending-upload', 'rejected'].includes(d.status)
      )

      if (pendingDocs.length === 0) {
        return new Response(
          JSON.stringify({ error: 'No pending documents to request' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // 5. Generate a secure upload token
      const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days

      const { error: tokenErr } = await supabase
        .from('client_upload_tokens')
        .insert({
          workspace_id: workspaceId,
          case_id: caseId,
          client_id: clientId,
          token,
          expires_at: expiresAt,
        })

      if (tokenErr) {
        return new Response(
          JSON.stringify({ error: 'Failed to create upload token', details: tokenErr.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // 6. Build upload URL
      const appBaseUrl = Deno.env.get('APP_BASE_URL') || 'https://app.dockly.io'
      const uploadUrl = `${appBaseUrl}/upload/${token}`

      // 7. Build WhatsApp message
      const docList = pendingDocs
        .map((d: any, i: number) => `${i + 1}. ${docTypeMap.get(d.document_type_id) || 'Document'}`)
        .join('\n')

      // Fetch client name
      const { data: client } = await supabase
        .from('clients')
        .select('name')
        .eq('id', clientId)
        .single()

      const clientName = client?.name || 'Client'

      const isHebrew = language === 'he'
      const messageBody = isHebrew
        ? `שלום ${clientName} 👋\n\nאנחנו צריכים ממך את המסמכים הבאים:\n\n${docList}\n\n📎 לחץ על הקישור כדי להעלות את המסמכים:\n${uploadUrl}\n\n⏰ הקישור בתוקף ל-7 ימים.\nתודה! 🙏`
        : `Hi ${clientName} 👋\n\nWe need the following documents from you:\n\n${docList}\n\n📎 Click the link to upload your documents:\n${uploadUrl}\n\n⏰ This link is valid for 7 days.\nThank you! 🙏`

      // 8. Send via WhatsApp Cloud API
      const waAccessToken = Deno.env.get('WHATSAPP_ACCESS_TOKEN')
      const waPhoneId = Deno.env.get('WHATSAPP_PHONE_ID')

      let waMessageId = null
      let sendStatus = 'pending'
      let errorMessage = null

      if (waAccessToken && waPhoneId) {
        // Format phone number (ensure it starts with country code, no + sign)
        const formattedPhone = phoneNumber.replace(/[^0-9]/g, '')

        const waResponse = await fetch(
          `https://graph.facebook.com/v18.0/${waPhoneId}/messages`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${waAccessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              to: formattedPhone,
              type: 'text',
              text: { body: messageBody },
            }),
          }
        )

        const waResult = await waResponse.json()

        if (waResponse.ok && waResult.messages?.[0]?.id) {
          waMessageId = waResult.messages[0].id
          sendStatus = 'sent'
        } else {
          sendStatus = 'failed'
          errorMessage = waResult.error?.message || 'Unknown WhatsApp API error'
        }
      } else {
        // No WhatsApp credentials configured — store as pending
        sendStatus = 'pending'
        errorMessage = 'WhatsApp API credentials not configured'
      }

      // 9. Log the message
      await supabase.from('whatsapp_messages').insert({
        workspace_id: workspaceId,
        case_id: caseId,
        client_id: clientId,
        direction: 'outbound',
        phone_number: phoneNumber,
        message_type: 'text',
        content: messageBody,
        status: sendStatus,
        wa_message_id: waMessageId,
        template_name: 'document_request',
        error_message: errorMessage,
        metadata: { upload_token: token, upload_url: uploadUrl, pending_docs: pendingDocs.length },
      })

      // 10. Update counters
      if (sendStatus === 'sent') {
        await supabase.rpc('increment_wa_messages_sent', { ws_id: workspaceId }).catch(() => {
          // If RPC doesn't exist, do a manual update
          return supabase
            .from('whatsapp_config')
            .update({ messages_sent: caseData.messages_sent + 1 })
            .eq('workspace_id', workspaceId)
        })
      }

      return new Response(
        JSON.stringify({
          success: true,
          messageId: waMessageId,
          status: sendStatus,
          uploadUrl,
          uploadToken: token,
          pendingDocuments: pendingDocs.length,
          error: errorMessage,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // ---- Validate upload token ----
    if (action === 'validate_token') {
      const { token: uploadToken } = await req.json()

      const { data: tokenData, error: tokenErr } = await supabase
        .from('client_upload_tokens')
        .select('*, cases(*), clients(name, phone, email)')
        .eq('token', uploadToken)
        .single()

      if (tokenErr || !tokenData) {
        return new Response(
          JSON.stringify({ valid: false, error: 'Token not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      const isExpired = new Date(tokenData.expires_at) < new Date()

      return new Response(
        JSON.stringify({
          valid: !isExpired && !tokenData.is_used,
          expired: isExpired,
          used: tokenData.is_used,
          caseId: tokenData.case_id,
          clientId: tokenData.client_id,
          workspaceId: tokenData.workspace_id,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ error: 'Unknown action' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
