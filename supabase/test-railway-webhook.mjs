// Test webhook verification on Railway
const url = 'https://dockly-production-8797.up.railway.app/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=dockly-wa-verify-2026-secure&hub.challenge=test_challenge_123';

try {
  const res = await fetch(url);
  const text = await res.text();
  console.log('Status:', res.status);
  console.log('Body:', JSON.stringify(text));
  console.log('Expected: "test_challenge_123"');
  console.log('Match:', text === 'test_challenge_123' ? '✅' : '❌');
} catch(e) {
  console.error('Error:', e.message);
}
