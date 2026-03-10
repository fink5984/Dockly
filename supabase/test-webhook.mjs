// Quick test of webhook verification
const url = 'http://localhost:4000/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=dockly-wa-verify-2026-secure&hub.challenge=test123';
const res = await fetch(url);
console.log('Status:', res.status);
console.log('Body:', await res.text());
