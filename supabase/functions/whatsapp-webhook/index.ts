// supabase/functions/whatsapp-webhook/index.ts
// Supabase Edge Function: WhatsApp Webhook
// Handles:
//   1. Webhook verification (GET) from Meta
//   2. Incoming messages (POST) — when client sends documents via WhatsApp
//   3. Status updates (delivered, read, etc.)
//
// Environment variables:
//   WHATSAPP_VERIFY_TOKEN  – Token you set in Meta webhook config
//   SUPABASE_URL           – auto-injected
//   SUPABASE_SERVICE_ROLE_KEY – auto-injected

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  const url = new URL(req.url)

  // ---- GET: Webhook verification ----
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const challenge = url.searchParams.get('hub.challenge')

    const verifyToken = Deno.env.get('WHATSAPP_VERIFY_TOKEN') || 'dockly-whatsapp-verify'

    if (mode === 'subscribe' && token === verifyToken) {
      console.log('Webhook verified successfully')
      return new Response(challenge, { status: 200 })
    }

    return new Response('Forbidden', { status: 403 })
  }

  // ---- POST: Incoming messages & status updates ----
  if (req.method === 'POST') {
    try {
      const body = await req.json()
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      )

      // Meta sends data in entry[].changes[].value
      const entries = body.entry ?? []

      for (const entry of entries) {
        const changes = entry.changes ?? []

        for (const change of changes) {
          const value = change.value
          if (!value) continue

          // ---- Status updates ----
          if (value.statuses) {
            for (const status of value.statuses) {
              // Update message status in our DB
              await supabase
                .from('whatsapp_messages')
                .update({ status: status.status }) // 'sent' | 'delivered' | 'read' | 'failed'
                .eq('wa_message_id', status.id)

              console.log(`Message ${status.id} status: ${status.status}`)
            }
          }

          // ---- Incoming messages ----
          if (value.messages) {
            for (const message of value.messages) {
              const from = message.from // sender phone number
              const msgType = message.type // text, image, document, etc.
              const timestamp = message.timestamp

              console.log(`Incoming ${msgType} message from ${from}`)

              // Try to find the client by phone number
              const { data: clients } = await supabase
                .from('clients')
                .select('id, workspace_id, name')
                .ilike('phone', `%${from.slice(-10)}%`) // match last 10 digits
                .limit(1)

              const client = clients?.[0]

              if (!client) {
                console.log(`No client found for phone ${from}`)
                continue
              }

              // Find the latest active case for this client
              const { data: activeCases } = await supabase
                .from('cases')
                .select('id, case_type, workspaces!cases_workspace_id_fkey(name)')
                .eq('client_id', client.id)
                .not('status', 'in', '("completed","closed")')
                .order('created_at', { ascending: false })
                .limit(1)

              const activeCase = activeCases?.[0]

              // Handle document/image uploads via WhatsApp
              if (['document', 'image'].includes(msgType)) {
                const mediaId = message[msgType]?.id
                const mimeType = message[msgType]?.mime_type
                const fileName = message[msgType]?.filename || `whatsapp_${msgType}_${Date.now()}`

                if (mediaId && activeCase) {
                  // Download media from WhatsApp
                  const waAccessToken = Deno.env.get('WHATSAPP_ACCESS_TOKEN')

                  if (waAccessToken) {
                    // Step 1: Get media URL
                    const mediaUrlRes = await fetch(
                      `https://graph.facebook.com/v18.0/${mediaId}`,
                      { headers: { 'Authorization': `Bearer ${waAccessToken}` } }
                    )
                    const mediaUrlData = await mediaUrlRes.json()

                    if (mediaUrlData.url) {
                      // Step 2: Download the file
                      const fileRes = await fetch(mediaUrlData.url, {
                        headers: { 'Authorization': `Bearer ${waAccessToken}` },
                      })
                      const fileBlob = await fileRes.blob()

                      // Step 3: Find a pending document slot in the case
                      const { data: pendingDocs } = await supabase
                        .from('case_documents')
                        .select('id, document_type_id')
                        .eq('case_id', activeCase.id)
                        .in('status', ['missing', 'pending-upload'])
                        .order('sort_order', { ascending: true })
                        .limit(1)

                      const targetDoc = pendingDocs?.[0]

                      if (targetDoc) {
                        // Step 4: Upload to S3 via server API with readable path
                        // Resolve document type name
                        const { data: dtRow } = await supabase
                          .from('document_types')
                          .select('name')
                          .eq('id', targetDoc.document_type_id)
                          .single()
                        const docTypeName = dtRow?.name || 'document'
                        const workspaceName = (activeCase as any)?.workspaces?.name || client.workspace_id
                        const caseType = (activeCase as any)?.case_type || 'general'

                        const pathInfo = {
                          type: 'document',
                          workspaceName,
                          clientName: client.name || from,
                          caseType,
                          documentTypeName: docTypeName,
                          fileName,
                        }

                        // Convert blob to base64 for server upload
                        const arrayBuf = await fileBlob.arrayBuffer()
                        const base64Data = btoa(String.fromCharCode(...new Uint8Array(arrayBuf)))

                        const serverUrl = Deno.env.get('APP_SERVER_URL') || 'https://dockly-production.up.railway.app'
                        const uploadRes = await fetch(`${serverUrl}/api/storage/upload-buffer`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ pathInfo, base64Data, contentType: mimeType }),
                        })
                        const uploadResult = await uploadRes.json()

                        if (uploadResult.success) {
                          const storagePath = uploadResult.key
                          // Step 5: Update case_document record
                          await supabase
                            .from('case_documents')
                            .update({
                              status: 'uploaded',
                              file_name: fileName,
                              file_type: mimeType,
                              file_size: fileBlob.size,
                              storage_path: storagePath,
                              storage_status: 'ready',
                              uploaded_by: `whatsapp:${from}`,
                              uploaded_at: new Date().toISOString(),
                            })
                            .eq('id', targetDoc.id)

                          console.log(`Document uploaded to case ${activeCase.id}, doc ${targetDoc.id}`)
                        }
                      }
                    }
                  }
                }
              }

              // Log incoming message
              await supabase.from('whatsapp_messages').insert({
                workspace_id: client.workspace_id,
                case_id: activeCase?.id || null,
                client_id: client.id,
                direction: 'inbound',
                phone_number: from,
                message_type: msgType,
                content: message.text?.body || `[${msgType}]`,
                status: 'received',
                wa_message_id: message.id,
                metadata: { timestamp, msgType },
              })

              // Update whatsapp_config counters
              await supabase
                .from('whatsapp_config')
                .update({ messages_received: supabase.rpc ? undefined : 0 })
                .eq('workspace_id', client.workspace_id)
                .then(() => {
                  // Increment messages_received
                  return supabase.rpc('increment_wa_messages_received', { ws_id: client.workspace_id })
                })
                .catch(() => { /* ignore counter errors */ })
            }
          }
        }
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    } catch (err) {
      console.error('Webhook error:', err)
      // Always return 200 to WhatsApp to prevent retries
      return new Response(
        JSON.stringify({ error: err.message }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }
  }

  return new Response('Method not allowed', { status: 405 })
})
