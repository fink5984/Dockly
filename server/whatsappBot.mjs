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
const GRAPH_API     = 'https://graph.facebook.com/v18.0';

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

async function sendTextMessage(to, text) {
  return sendWhatsApp(to, { type: 'text', text: { body: text } });
}

async function sendInteractiveButtons(to, bodyText, buttons) {
  return sendWhatsApp(to, {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: bodyText },
      action: { buttons },
    },
  });
}

async function sendInteractiveList(to, bodyText, buttonLabel, sections) {
  return sendWhatsApp(to, {
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: bodyText },
      action: { button: buttonLabel, sections },
    },
  });
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

async function logWhatsAppMessage(workspaceId, caseId, clientId, direction, phone, msgType, content, status, metadata) {
  await pool.query(`
    INSERT INTO whatsapp_messages
      (workspace_id, case_id, client_id, direction, phone_number, message_type, content, status, metadata)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  `, [workspaceId, caseId, clientId, direction, phone, msgType, content, status, metadata ? JSON.stringify(metadata) : null]);
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
  const safeName = fileName || `${state.awaiting_document_name || 'document'}_${Date.now()}.${ext}`;
  const storagePath = `${state.workspace_id}/${state.case_id}/${state.awaiting_document_id}/${safeName}`;

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
      safeName,
      media.mimeType,
      media.fileSize,
      storagePath,
      state.client_id
    );

    // Log inbound media
    await logWhatsAppMessage(
      state.workspace_id, state.case_id, state.client_id,
      'inbound', phone, 'media',
      `Uploaded: ${state.awaiting_document_name} (${safeName})`, 'delivered',
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
async function handleTextInput(phone, text) {
  const normalized = text.trim().toLowerCase();
  const state = await getConversationState(phone);

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

  // Default response
  if (state) {
    if (state.awaiting_document_id) {
      await sendTextMessage(phone,
        `📎 אני מחכה שתשלח את הקובץ עבור *${state.awaiting_document_name}*.\n` +
        `שלח תמונה 📷 או מסמך PDF 📄.\n\n` +
        `💡 כתוב *תפריט* כדי לחזור לרשימת המסמכים.`
      );
    } else {
      await sendInteractiveButtons(phone,
        '👋 שלום! אני הבוט של Dockly.\n\n💡 לחץ על הכפתור כדי לראות את המסמכים שצריך להעלות.',
        [{
          type: 'reply',
          reply: { id: `show_docs_${state.case_id}`, title: '📄 הצג מסמכים' },
        }]
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
      console.log(`[Bot] Message from ${from} — type: ${msg.type}`);

      try {
        switch (msg.type) {
          case 'interactive': {
            const interactive = msg.interactive;
            if (interactive.type === 'button_reply') {
              const buttonId = interactive.button_reply.id;
              if (buttonId.startsWith('show_docs_')) {
                const caseId = buttonId.replace('show_docs_', '');
                await handleShowDocuments(from, caseId);
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
            await handleTextInput(from, msg.text.body);
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

export async function shutdown() {
  await pool.end();
}
