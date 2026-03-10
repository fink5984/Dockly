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
import { handleVerification, handleIncoming, shutdown } from './whatsappBot.mjs';

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
