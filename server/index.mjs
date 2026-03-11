/**
 * Dockly Server
 * Express server that:
 * 1. Serves the Vite production build (static files)
 * 2. Handles WhatsApp webhook API endpoints
 * 3. Provides a health check endpoint
 */

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { handleVerification, handleIncoming, sendInitialMessage, sendSupportReply, shutdown } from './whatsappBot.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const PORT       = process.env.PORT || 3000;

const app = express();

// ── Middleware ───────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));

// ── Health Check ────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── WhatsApp Webhook ────────────────────────────────────────────────────
app.get('/api/whatsapp/webhook', handleVerification);
app.post('/api/whatsapp/webhook', handleIncoming);

// ── WhatsApp Send Initial Message (from frontend) ──────────────────────
app.post('/api/whatsapp/send', async (req, res) => {
  try {
    const { workspaceId, caseId, clientId, phoneNumber, language, caseTitle, pendingCount, messageType } = req.body;
    
    if (!phoneNumber || !caseId || !workspaceId || !clientId) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    const result = await sendInitialMessage({
      workspaceId,
      caseId,
      clientId,
      phoneNumber,
      language: language || 'he',
      caseTitle: caseTitle || '',
      pendingCount: pendingCount || 0,
      messageType: messageType || 'initial',
    });

    res.json(result);
  } catch (err) {
    console.error('[API] Send WhatsApp error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Support Chat Reply (staff → client via WhatsApp) ────────────────────
app.post('/api/whatsapp/support/reply', async (req, res) => {
  try {
    const { supportRequestId, senderName, content } = req.body;
    if (!supportRequestId || !content) {
      return res.status(400).json({ success: false, error: 'Missing supportRequestId or content' });
    }
    const result = await sendSupportReply({ supportRequestId, senderName: senderName || 'צוות', content });
    res.json(result);
  } catch (err) {
    console.error('[API] Support reply error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Mark Support Messages as Read (when staff opens chat) ───────────────
app.post('/api/whatsapp/support/mark-read', async (req, res) => {
  try {
    const { supportRequestId } = req.body;
    if (!supportRequestId) {
      return res.status(400).json({ success: false, error: 'Missing supportRequestId' });
    }
    
    // Get all unread client messages with WhatsApp message IDs
    const { rows } = await pool.query(`
      SELECT whatsapp_message_id
      FROM support_messages
      WHERE request_id = $1
        AND sender_type = 'client'
        AND is_read = false
        AND whatsapp_message_id IS NOT NULL
    `, [supportRequestId]);
    
    // Mark each message as read in WhatsApp (green check marks)
    const { markMessageAsRead } = await import('./whatsappBot.mjs');
    const promises = rows.map(row => markMessageAsRead(row.whatsapp_message_id));
    await Promise.all(promises);
    
    res.json({ success: true, markedCount: rows.length });
  } catch (err) {
    console.error('[API] Mark messages read error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Serve Static Files (Vite build output) ──────────────────────────────
const distPath = join(__dirname, '..', 'dist');
app.use(express.static(distPath));

// SPA fallback — serve index.html for all non-API routes
app.get('/{*path}', (_req, res) => {
  res.sendFile(join(distPath, 'index.html'));
});

// ── Start Server ────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Dockly server running on port ${PORT}`);
  console.log(`   📡 WhatsApp webhook: /api/whatsapp/webhook`);
  console.log(`   💊 Health check:     /api/health`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await shutdown();
  process.exit(0);
});
