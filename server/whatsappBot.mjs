/**
 * WhatsApp Bot Handler
 * Handles interactive WhatsApp conversations for document collection.
 *
 * Flow:
 * 1. Staff sends initial message (interactive button) via DB function
 * 2. Client clicks "📄 הצג מסמכים" → webhook sends document list
 * 3. Client selects a document → webhook asks to send file
 * 4. Client sends file → webhook downloads, uploads to Supabase, updates case
 * 5. Client can always type "תפריט"/"menu" to see remaining docs
 */

import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

// ── Config ──────────────────────────────────────────────────────────────
const WA_PHONE_ID   = process.env.WHATSAPP_PHONE_ID;
const WA_TOKEN      = process.env.WHATSAPP_ACCESS_TOKEN;
const WA_VERIFY     = process.env.WHATSAPP_VERIFY_TOKEN || 'dockly-wa-verify-2026-secure';
const GRAPH_API     = 'https://graph.facebook.com/v21.0';

const SUPABASE_URL  = process.env.VITE_SUPABASE_URL  || process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const DATABASE_URL  = process.env.DATABASE_URL ||
  'postgresql://postgres.mjtbahthexznbnmuyvhu:MbJu%23N%2FK6J6ANpR@aws-1-eu-west-1.pooler.supabase.com:5432/postgres';

// Supabase client (with service role for storage access)
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// ── DB Pool ─────────────────────────────────────────────────────────────
const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
});

// ── WhatsApp API helpers ────────────────────────────────────────────────

async function sendWhatsApp(to, payload) {
  const url = `${GRAPH_API}/${WA_PHONE_ID}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WA_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, ...payload }),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error('[WA] Send error:', JSON.stringify(data));
  }
  return data;
}

// ── Typing Indicator ────────────────────────────────────────────────────
// Uses WhatsApp Cloud API v21.0+ typing_indicator feature.
// Shows "typing..." bubble on client’s WhatsApp before the bot replies.
async function sendTypingIndicator(to, duration = 2000) {
  await new Promise(resolve => setTimeout(resolve, duration));
}

// ── Mark Message as Read ────────────────────────────────────────────────
export async function markMessageAsRead(messageId) {
  const url = `${GRAPH_API}/${WA_PHONE_ID}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WA_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error('[WA] Mark read error:', JSON.stringify(data));
  }
  return data;
}

async function sendTextMessage(to, text, withTyping = true) {
  if (withTyping) {
    await sendTypingIndicator(to, 1500);
  }
  const result = await sendWhatsApp(to, { type: 'text', text: { body: text } });
  return result;
}

async function sendInteractiveButtons(to, bodyText, buttons, withTyping = true) {
  if (withTyping) {
    await sendTypingIndicator(to, 1500);
  }
  const result = await sendWhatsApp(to, {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: bodyText },
      action: { buttons },
    },
  });
  return result;
}

async function sendInteractiveList(to, bodyText, buttonLabel, sections, withTyping = true) {
  if (withTyping) {
    await sendTypingIndicator(to, 1500);
  }
  const result = await sendWhatsApp(to, {
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: bodyText },
      action: { button: buttonLabel, sections },
    },
  });
  return result;
}

async function downloadWhatsAppMedia(mediaId) {
  // Step 1: Get media URL
  const metaRes = await fetch(`${GRAPH_API}/${mediaId}`, {
    headers: { 'Authorization': `Bearer ${WA_TOKEN}` },
  });
  const meta = await metaRes.json();
  if (!meta.url) {
    console.error('[WA] Media meta error:', JSON.stringify(meta));
    return null;
  }

  // Step 2: Download the actual file
  const fileRes = await fetch(meta.url, {
    headers: { 'Authorization': `Bearer ${WA_TOKEN}` },
  });
  if (!fileRes.ok) {
    console.error('[WA] Media download error:', fileRes.status);
    return null;
  }

  const buffer = Buffer.from(await fileRes.arrayBuffer());
  return {
    buffer,
    mimeType: meta.mime_type || 'application/octet-stream',
    fileSize: meta.file_size || buffer.length,
    sha256: meta.sha256,
  };
}

// ── DB helpers ──────────────────────────────────────────────────────────

async function getConversationState(phone) {
  const { rows } = await pool.query(
    `SELECT * FROM whatsapp_conversation_state WHERE phone_number = $1`,
    [phone]
  );
  return rows[0] || null;
}

async function setConversationState(phone, caseId, clientId, workspaceId, docId, docName) {
  await pool.query(`
    INSERT INTO whatsapp_conversation_state
      (phone_number, case_id, client_id, workspace_id, awaiting_document_id, awaiting_document_name, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
    ON CONFLICT (phone_number) DO UPDATE SET
      case_id = $2, client_id = $3, workspace_id = $4,
      awaiting_document_id = $5, awaiting_document_name = $6,
      updated_at = NOW()
  `, [phone, caseId, clientId, workspaceId, docId || null, docName || null]);
}

async function getPendingDocuments(caseId) {
  const { rows } = await pool.query(`
    SELECT cd.id, cd.document_type_id, cd.status, cd.is_required,
           dt.name AS doc_type_name, dt.description AS doc_type_desc
    FROM case_documents cd
    LEFT JOIN document_types dt ON dt.id = cd.document_type_id
    WHERE cd.case_id = $1
      AND cd.status IN ('pending', 'missing', 'rejected')
    ORDER BY cd.sort_order ASC
  `, [caseId]);
  return rows;
}

async function getAllDocuments(caseId) {
  const { rows } = await pool.query(`
    SELECT cd.id, cd.document_type_id, cd.status, cd.is_required,
           dt.name AS doc_type_name
    FROM case_documents cd
    LEFT JOIN document_types dt ON dt.id = cd.document_type_id
    WHERE cd.case_id = $1
    ORDER BY cd.sort_order ASC
  `, [caseId]);
  return rows;
}

async function markDocumentUploaded(docId, fileName, fileType, fileSize, storagePath, clientId) {
  await pool.query(`
    UPDATE case_documents SET
      status = 'uploaded',
      file_name = $2,
      file_type = $3,
      file_size = $4,
      storage_path = $5,
      storage_status = 'ready',
      uploaded_by = $6,
      uploaded_at = NOW(),
      updated_at = NOW()
    WHERE id = $1
  `, [docId, fileName, fileType, fileSize, storagePath, `whatsapp:${clientId}`]);
}

async function updateCaseStatus(caseId) {
  // Get all documents for this case
  const { rows } = await pool.query(`
    SELECT status FROM case_documents WHERE case_id = $1
  `, [caseId]);

  const total = rows.length;
  const pending = rows.filter(d => ['missing', 'pending-upload', 'rejected'].includes(d.status)).length;
  const uploaded = rows.filter(d => ['uploaded', 'under-review'].includes(d.status)).length;
  const approved = rows.filter(d => d.status === 'approved').length;

  let newStatus;
  if (approved === total && total > 0) {
    newStatus = 'completed';
  } else if (uploaded > 0 && pending === 0) {
    newStatus = 'awaiting-review';
  } else if (uploaded > 0 || approved > 0) {
    newStatus = 'partial-submission';
  } else {
    newStatus = 'waiting-for-client';
  }

  await pool.query(`
    UPDATE cases SET status = $1, updated_at = NOW() WHERE id = $2
  `, [newStatus, caseId]);
}

async function logWhatsAppMessage(workspaceId, caseId, clientId, direction, phone, msgType, content, status, metadata) {
  await pool.query(`
    INSERT INTO whatsapp_messages
      (workspace_id, case_id, client_id, direction, phone_number, message_type, content, status, metadata)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [workspaceId, caseId, clientId, direction, phone, msgType, content, status, metadata ? JSON.stringify(metadata) : null]);
}

// ── Support Chat helpers ────────────────────────────────────────────────

async function getClientName(clientId) {
  const { rows } = await pool.query(`SELECT name FROM clients WHERE id = $1`, [clientId]);
  return rows[0]?.name || 'לקוח';
}

async function findOrCreateSupportRequest(caseId, clientId) {
  // Look for an existing open support request for this case
  const { rows: existing } = await pool.query(`
    SELECT id FROM support_requests
    WHERE case_id = $1 AND status NOT IN ('closed', 'resolved')
    ORDER BY created_at DESC LIMIT 1
  `, [caseId]);
  if (existing.length > 0) return existing[0].id;

  // Create a new one
  const clientName = await getClientName(clientId);
  const { rows: created } = await pool.query(`
    INSERT INTO support_requests (case_id, client_id, subject, status, issue_description, opened_at)
    VALUES ($1, $2, $3, 'open', $4, NOW())
    RETURNING id
  `, [caseId, clientId, `שיחת תמיכה – ${clientName}`, 'פנייה מוואטסאפ']);
  return created[0].id;
}

async function addSupportMessage(requestId, senderType, senderName, content, whatsappMessageId = null) {
  const { rows } = await pool.query(`
    INSERT INTO support_messages (request_id, sender_type, sender_name, content, whatsapp_message_id)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id
  `, [requestId, senderType, senderName, content, whatsappMessageId]);

  // Update request status based on who sent the message
  const newStatus = senderType === 'client' ? 'waiting-for-staff' : 'waiting-for-client';
  await pool.query(`UPDATE support_requests SET status = $1 WHERE id = $2`, [newStatus, requestId]);
  
  return rows[0].id; // Return the message ID
}

async function enterSupportMode(phone, state) {
  const requestId = await findOrCreateSupportRequest(state.case_id, state.client_id);
  await pool.query(`
    UPDATE whatsapp_conversation_state
    SET support_mode = true, support_request_id = $1, awaiting_document_id = NULL, awaiting_document_name = NULL, updated_at = NOW()
    WHERE phone_number = $2
  `, [requestId, phone]);
  return requestId;
}

async function exitSupportMode(phone) {
  await pool.query(`
    UPDATE whatsapp_conversation_state
    SET support_mode = false, support_request_id = NULL, updated_at = NOW()
    WHERE phone_number = $1
  `, [phone]);
}

// ── File extension from MIME ────────────────────────────────────────────

function extFromMime(mime) {
  const map = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
    'image/heic': 'heic', 'image/heif': 'heif',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  };
  return map[mime] || 'bin';
}

// ── Bot Logic ───────────────────────────────────────────────────────────

/**
 * Send the document list for a case as a WhatsApp interactive list.
 */
async function sendDocumentList(phone, caseId, state) {
  const pendingDocs = await getPendingDocuments(caseId);

  if (pendingDocs.length === 0) {
    await sendTextMessage(phone,
      '🎉 כל הכבוד! כל המסמכים הועלו בהצלחה.\nאין מסמכים נוספים להעלאה.'
    );
    return;
  }

  // WhatsApp list supports max 10 rows per section
  const rows = pendingDocs.slice(0, 10).map(doc => ({
    id: `upload_${doc.id}`,
    title: (doc.doc_type_name || 'מסמך').slice(0, 24),
    description: doc.is_required ? '⚠️ חובה' : '📎 רשות',
  }));

  await sendInteractiveList(
    phone,
    `📋 *מסמכים להעלאה (${pendingDocs.length}):*\n\nבחר מסמך מהרשימה כדי להעלות אותו.\nלאחר הבחירה, שלח את הקובץ (תמונה או מסמך).`,
    '📋 בחר מסמך',
    [{ title: 'מסמכים נדרשים', rows }]
  );

  // Log
  if (state) {
    await logWhatsAppMessage(
      state.workspace_id, caseId, state.client_id,
      'outbound', phone, 'interactive_list',
      `Document list sent (${pendingDocs.length} pending)`, 'sent', null
    );
  }
}

/**
 * Handle "show documents" button click.
 */
async function handleShowDocuments(phone, caseId) {
  const state = await getConversationState(phone);

  // Clear any previous "awaiting upload" state
  if (state) {
    await setConversationState(phone, caseId, state.client_id, state.workspace_id, null, null);
  }

  await sendDocumentList(phone, caseId, state);
}

/**
 * Handle document selection from the list.
 */
async function handleDocumentSelected(phone, docId) {
  const state = await getConversationState(phone);
  if (!state) {
    await sendTextMessage(phone, '❌ לא נמצא תיק פעיל. בקש מהמשרד לשלוח לך הודעה חדשה.');
    return;
  }

  // Get the document info
  const { rows } = await pool.query(`
    SELECT cd.id, cd.status, dt.name AS doc_type_name
    FROM case_documents cd
    LEFT JOIN document_types dt ON dt.id = cd.document_type_id
    WHERE cd.id = $1
  `, [docId]);

  if (rows.length === 0) {
    await sendTextMessage(phone, '❌ המסמך לא נמצא. נסה שוב.');
    return;
  }

  const doc = rows[0];
  const docName = doc.doc_type_name || 'מסמך';

  // Set state: waiting for file upload for this document
  await setConversationState(
    phone, state.case_id, state.client_id, state.workspace_id,
    docId, docName
  );

  await sendTextMessage(phone,
    `📎 *${docName}*\n\nשלח את הקובץ עכשיו — תמונה 📷 או מסמך PDF 📄\n\nפשוט צרף את הקובץ וישלח.`
  );

  await logWhatsAppMessage(
    state.workspace_id, state.case_id, state.client_id,
    'outbound', phone, 'text',
    `Requested upload for: ${docName}`, 'sent', { docId }
  );
}

/**
 * Handle media (image/document) upload from user.
 */
async function handleMediaUpload(phone, mediaId, mimeType, fileName) {
  const state = await getConversationState(phone);

  if (!state) {
    await sendTextMessage(phone, '❌ לא נמצא תיק פעיל. בקש מהמשרד לשלוח לך הודעה חדשה.');
    return;
  }

  if (!state.awaiting_document_id) {
    // User sent a file without selecting a document first — show the list
    await sendTextMessage(phone,
      '⚠️ קודם צריך לבחור איזה מסמך אתה מעלה.\nבחר מהרשימה:'
    );
    await sendDocumentList(phone, state.case_id, state);
    return;
  }

  // Download from WhatsApp
  const media = await downloadWhatsAppMedia(mediaId);
  if (!media) {
    await sendTextMessage(phone, '❌ לא הצלחנו להוריד את הקובץ. נסה לשלוח שוב.');
    return;
  }

  const ext = extFromMime(media.mimeType);
  // Use UUID-based filename for storage (Supabase doesn't allow Hebrew chars)
  const safeFileName = `${state.awaiting_document_id}_${Date.now()}.${ext}`;
  const storagePath = `${state.workspace_id}/${state.case_id}/${state.awaiting_document_id}/${safeFileName}`;
  // Keep original name for display
  const displayName = fileName || state.awaiting_document_name || 'document';

  try {
    // Upload to Supabase Storage
    const { error: uploadErr } = await supabase.storage
      .from('documents')
      .upload(storagePath, media.buffer, {
        contentType: media.mimeType,
        cacheControl: '3600',
        upsert: true,
      });

    if (uploadErr) {
      console.error('[Storage] Upload error:', uploadErr);
      await sendTextMessage(phone, '❌ שגיאה בהעלאת הקובץ. נסה שוב.');
      return;
    }

    // Update case_documents
    await markDocumentUploaded(
      state.awaiting_document_id,
      displayName,
      media.mimeType,
      media.fileSize,
      storagePath,
      state.client_id
    );

    // Update case status based on documents progress
    await updateCaseStatus(state.case_id);

    // Log inbound media
    await logWhatsAppMessage(
      state.workspace_id, state.case_id, state.client_id,
      'inbound', phone, 'media',
      `Uploaded: ${state.awaiting_document_name} (${safeFileName})`, 'delivered',
      { mediaId, storagePath, docId: state.awaiting_document_id }
    );

    // Clear awaiting state
    await setConversationState(
      phone, state.case_id, state.client_id, state.workspace_id,
      null, null
    );

    // Check remaining documents
    const remaining = await getPendingDocuments(state.case_id);

    if (remaining.length === 0) {
      // All done!
      await sendTextMessage(phone,
        `✅ *${state.awaiting_document_name}* הועלה בהצלחה!\n\n` +
        `🎉 מעולה! כל המסמכים הועלו!\nתודה רבה! 🙏`
      );
    } else {
      // More documents needed — show button to continue
      await sendInteractiveButtons(phone,
        `✅ *${state.awaiting_document_name}* הועלה בהצלחה!\n\n` +
        `📄 נותרו עוד *${remaining.length}* מסמכים להעלאה.`,
        [{
          type: 'reply',
          reply: { id: `show_docs_${state.case_id}`, title: '📄 המשך להעלות' },
        }]
      );
    }

  } catch (err) {
    console.error('[Bot] Upload processing error:', err);
    await sendTextMessage(phone, '❌ שגיאה בעיבוד הקובץ. נסה שוב.');
  }
}

/**
 * Handle text messages (menu, help, etc.)
 */
async function handleTextInput(phone, text, messageId = null) {
  const normalized = text.trim().toLowerCase();
  const state = await getConversationState(phone);

  // ── Exit support mode keywords ──
  if (['חזור', 'back', 'תפריט', 'menu', 'מסמכים', 'documents', 'רשימה', 'list'].includes(normalized) && state?.support_mode) {
    await exitSupportMode(phone);
    await sendTextMessage(phone, '✅ יצאת ממצב תמיכה. חוזרים לתפריט הרגיל.');
    await sendDocumentList(phone, state.case_id, state);
    return;
  }

  // ── If in support mode, relay message to support chat ──
  if (state?.support_mode && state?.support_request_id) {
    const clientName = await getClientName(state.client_id);
    await addSupportMessage(state.support_request_id, 'client', clientName, text.trim(), messageId);
    await logWhatsAppMessage(
      state.workspace_id, state.case_id, state.client_id,
      'inbound', phone, 'support_chat', text.trim(), 'delivered',
      { supportRequestId: state.support_request_id }
    );
    await sendTextMessage(phone,
      '✉️ ההודעה שלך נשלחה לצוות. נחזור אליך בהקדם.\n💡 כתוב *חזור* לחזור לתפריט המסמכים.'
    );
    return;
  }

  // ── Enter support mode keywords ──
  if (['תמיכה', 'support', 'עזרה', 'help'].includes(normalized)) {
    if (!state) {
      await sendTextMessage(phone, 'אין כרגע תיק פעיל. בקש מהמשרד לשלוח לך הודעה חדשה.');
      return;
    }
    const requestId = await enterSupportMode(phone, state);
    await sendTextMessage(phone,
      '💬 *מצב תמיכה*\n\nכתוב את ההודעה שלך והצוות יקבל התראה ויענה לך ישירות כאן.\n\n💡 כתוב *חזור* כדי לחזור לתפריט המסמכים.'
    );
    await logWhatsAppMessage(
      state.workspace_id, state.case_id, state.client_id,
      'inbound', phone, 'text', 'Entered support mode', 'delivered',
      { supportRequestId: requestId }
    );
    return;
  }

  // ── Menu / docs keywords ──
  if (['תפריט', 'menu', 'מסמכים', 'documents', 'רשימה', 'list', 'start', 'hi', 'שלום'].includes(normalized)) {
    if (!state) {
      await sendTextMessage(phone,
        'שלום! 👋\nאין כרגע תיק פעיל. בקש מהמשרד לשלוח לך הודעה חדשה.'
      );
      return;
    }
    await sendDocumentList(phone, state.case_id, state);
    return;
  }

  if (['סטטוס', 'status'].includes(normalized)) {
    if (!state) {
      await sendTextMessage(phone, 'אין תיק פעיל.');
      return;
    }
    const allDocs = await getAllDocuments(state.case_id);
    const pending = allDocs.filter(d => ['pending', 'missing', 'rejected'].includes(d.status));
    const uploaded = allDocs.filter(d => ['uploaded', 'approved'].includes(d.status));

    let statusText = `📊 *סטטוס מסמכים:*\n\n`;
    if (uploaded.length > 0) {
      statusText += `✅ הועלו (${uploaded.length}):\n`;
      uploaded.forEach(d => { statusText += `  • ${d.doc_type_name}\n`; });
    }
    if (pending.length > 0) {
      statusText += `\n⏳ ממתינים (${pending.length}):\n`;
      pending.forEach(d => { statusText += `  • ${d.doc_type_name}\n`; });
    }
    if (pending.length === 0) {
      statusText += `\n🎉 כל המסמכים הועלו!`;
    }
    await sendTextMessage(phone, statusText);
    return;
  }

  // Default response — include support option
  if (state) {
    if (state.awaiting_document_id) {
      await sendTextMessage(phone,
        `📎 אני מחכה שתשלח את הקובץ עבור *${state.awaiting_document_name}*.\n` +
        `שלח תמונה 📷 או מסמך PDF 📄.\n\n` +
        `💡 כתוב *תפריט* לרשימת המסמכים\n💡 כתוב *תמיכה* לפנייה לצוות`
      );
    } else {
      await sendInteractiveButtons(phone,
        '👋 שלום! אני הבוט של Dockly.\n\n💡 לחץ על הכפתור כדי לראות את המסמכים.\n📞 כתוב *תמיכה* לשיחה עם הצוות.',
        [
          { type: 'reply', reply: { id: `show_docs_${state.case_id}`, title: '📄 הצג מסמכים' } },
          { type: 'reply', reply: { id: `support_${state.case_id}`, title: '💬 תמיכה' } },
        ]
      );
    }
  } else {
    await sendTextMessage(phone,
      'שלום! 👋\nאני הבוט של Dockly.\nאין כרגע תיק פעיל. בקש מהמשרד לשלוח לך הודעה חדשה.'
    );
  }
}

// ── Main Webhook Handler ────────────────────────────────────────────────

/**
 * Handle GET request for webhook verification.
 */
export function handleVerification(req, res) {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === WA_VERIFY) {
    console.log('[Webhook] Verification successful');
    return res.status(200).send(challenge);
  }
  console.warn('[Webhook] Verification failed — token mismatch');
  return res.sendStatus(403);
}

/**
 * Handle POST request with incoming messages.
 */
export async function handleIncoming(req, res) {
  // Always respond 200 quickly to avoid Meta retries
  res.sendStatus(200);

  try {
    const body = req.body;
    if (!body?.entry?.[0]?.changes?.[0]?.value?.messages) return;

    const value    = body.entry[0].changes[0].value;
    const messages = value.messages;

    for (const msg of messages) {
      const from = msg.from; // phone number (no +)
      const messageId = msg.id;
      console.log(`[Bot] Message from ${from} — type: ${msg.type}, id: ${messageId}`);

      try {
        // Check if user is in support mode
        const st = await getConversationState(from);
        const isInSupportMode = st?.support_mode;

        // Mark incoming message as read (blue checks on client’s WhatsApp)
        // ── In BOT mode: mark immediately (automated flow, instant blue checks)
        // ── In SUPPORT mode: do NOT mark — staff sees green check only when they open the chat
        if (!isInSupportMode) {
          markMessageAsRead(messageId).catch(err => 
            console.error('[Bot] Failed to mark message as read:', err)
          );
        }

        switch (msg.type) {
          case 'interactive': {
            const interactive = msg.interactive;
            if (interactive.type === 'button_reply') {
              const buttonId = interactive.button_reply.id;
              if (buttonId.startsWith('show_docs_')) {
                const caseId = buttonId.replace('show_docs_', '');
                await handleShowDocuments(from, caseId);
              } else if (buttonId.startsWith('support_')) {
                // Enter support mode via button
                const st = await getConversationState(from);
                if (st) {
                  const rid = await enterSupportMode(from, st);
                  await sendTextMessage(from,
                    '💬 *מצב תמיכה*\n\nכתוב את ההודעה שלך והצוות יקבל התראה ויענה לך ישירות כאן.\n\n💡 כתוב *חזור* כדי לחזור לתפריט המסמכים.'
                  );
                }
              } else if (buttonId === 'exit_support') {
                await exitSupportMode(from);
                const st2 = await getConversationState(from);
                if (st2) await sendDocumentList(from, st2.case_id, st2);
              }
            } else if (interactive.type === 'list_reply') {
              const listId = interactive.list_reply.id;
              if (listId.startsWith('upload_')) {
                const docId = listId.replace('upload_', '');
                await handleDocumentSelected(from, docId);
              }
            }
            break;
          }

          case 'image':
          case 'document': {
            const media = msg[msg.type]; // msg.image or msg.document
            const mediaId = media.id;
            const mimeType = media.mime_type;
            const fileName = media.filename || null; // documents have filename, images don't
            await handleMediaUpload(from, mediaId, mimeType, fileName);
            break;
          }

          case 'text': {
            await handleTextInput(from, msg.text.body, messageId);
            break;
          }

          default:
            console.log(`[Bot] Unhandled message type: ${msg.type}`);
            break;
        }
      } catch (err) {
        console.error(`[Bot] Error handling message from ${from}:`, err);
      }
    }
  } catch (err) {
    console.error('[Webhook] Error processing request:', err);
  }
}

// ── Send Initial Message (from frontend) ───────────────────────────────

/**
 * Send the initial WhatsApp message to a client with a button to view documents.
 * Called from the frontend via /api/whatsapp/send endpoint.
 */
export async function sendInitialMessage({ workspaceId, caseId, clientId, phoneNumber, language, caseTitle, pendingCount }) {
  try {
    // Format phone number: remove non-digits, convert Israeli local to international
    let phone = phoneNumber.replace(/[^0-9]/g, '');
    // Israeli local numbers: 05x → 9725x
    if (phone.startsWith('05') && phone.length === 10) {
      phone = '972' + phone.slice(1);
    } else if (phone.startsWith('00')) {
      phone = phone.slice(2);
    }

    // Build message text
    const isHebrew = language === 'he';
    const bodyText = isHebrew
      ? `שלום! 👋\n\nיש מסמכים שצריך להעלות עבור התיק: *${caseTitle}*\n📄 מספר מסמכים להעלאה: *${pendingCount}*\n\nלחץ על הכפתור למטה כדי לראות את רשימת המסמכים ולהעלות אותם ישירות כאן בוואטסאפ.`
      : `Hello! 👋\n\nThere are documents to upload for case: *${caseTitle}*\n📄 Documents to upload: *${pendingCount}*\n\nClick the button below to see the document list and upload them directly here in WhatsApp.`;

    const buttonTitle = isHebrew ? 'הצג מסמכים' : 'Show Documents';

    // Send interactive button message
    const result = await sendInteractiveButtons(phone, bodyText, [
      {
        type: 'reply',
        reply: {
          id: `show_docs_${caseId}`,
          title: buttonTitle,
        },
      },
    ]);

    // Set conversation state
    await setConversationState(phone, caseId, clientId, workspaceId, null, null);

    // Log outbound message
    await logWhatsAppMessage(
      workspaceId, caseId, clientId,
      'outbound', phone, 'interactive_button',
      `Initial message sent for ${caseTitle}`, 'sent',
      { pendingCount, language }
    );

    return {
      success: !result.error,
      messageId: result.messages?.[0]?.id,
      error: result.error?.message,
    };
  } catch (err) {
    console.error('[Bot] sendInitialMessage error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Send a staff reply to a client via WhatsApp.
 * Called from the frontend via /api/whatsapp/support/reply endpoint.
 */
export async function sendSupportReply({ supportRequestId, senderName, content }) {
  try {
    // 1. Save message to support_messages and get the message ID
    const messageDbId = await addSupportMessage(supportRequestId, 'staff', senderName, content);

    // 2. Find the client's phone from conversation state
    const { rows } = await pool.query(`
      SELECT wcs.phone_number, wcs.case_id, wcs.client_id, wcs.workspace_id
      FROM whatsapp_conversation_state wcs
      WHERE wcs.support_request_id = $1
      LIMIT 1
    `, [supportRequestId]);

    if (rows.length === 0) {
      // Client might not be in support mode anymore — find phone from support_request → client
      const { rows: sr } = await pool.query(`
        SELECT sr.case_id, sr.client_id, c.phone, cas.workspace_id
        FROM support_requests sr
        JOIN clients c ON c.id = sr.client_id
        JOIN cases cas ON cas.id = sr.case_id
        WHERE sr.id = $1
      `, [supportRequestId]);

      if (sr.length === 0) {
        return { success: false, error: 'Support request not found' };
      }

      let phone = sr[0].phone?.replace(/[^0-9]/g, '') || '';
      if (phone.startsWith('05') && phone.length === 10) phone = '972' + phone.slice(1);
      if (!phone) return { success: false, error: 'Client has no phone number' };

      // Send with typing
      const result = await sendTextMessage(phone, `💬 *הודעה מהצוות:*\n\n${content}`);
      
      // Update DB with WhatsApp message ID
      if (result.messages?.[0]?.id) {
        await pool.query(`
          UPDATE support_messages 
          SET whatsapp_message_id = $1 
          WHERE id = $2
        `, [result.messages[0].id, messageDbId]);
      }

      await logWhatsAppMessage(
        sr[0].workspace_id, sr[0].case_id, sr[0].client_id,
        'outbound', phone, 'support_chat', content, 'sent',
        { supportRequestId }
      );

      return { success: true };
    }

    const { phone_number, case_id, client_id, workspace_id } = rows[0];

    // 3. Send WhatsApp message to client with typing
    const result = await sendTextMessage(phone_number, `💬 *הודעה מהצוות:*\n\n${content}`);
    
    // Update DB with WhatsApp message ID
    if (result.messages?.[0]?.id) {
      await pool.query(`
        UPDATE support_messages 
        SET whatsapp_message_id = $1 
        WHERE id = $2
      `, [result.messages[0].id, messageDbId]);
    }

    // 4. Log
    await logWhatsAppMessage(
      workspace_id, case_id, client_id,
      'outbound', phone_number, 'support_chat', content, 'sent',
      { supportRequestId }
    );

    return { success: true };
  } catch (err) {
    console.error('[Bot] sendSupportReply error:', err);
    return { success: false, error: err.message };
  }
}

export async function shutdown() {
  await pool.end();
}
