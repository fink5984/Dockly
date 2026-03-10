import pg from 'pg';

const client = new pg.Client({
  connectionString: 'postgresql://postgres.mjtbahthexznbnmuyvhu:MbJu%23N%2FK6J6ANpR@aws-1-eu-west-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    await client.connect();

    // Get the content column specifically
    const { rows } = await client.query(`
      SELECT id, status_code, content_type, content, timed_out, error_msg 
      FROM net._http_response 
      ORDER BY id DESC LIMIT 3
    `);
    rows.forEach(r => {
      console.log('\n--- Request ID:', r.id, '---');
      console.log('Status:', r.status_code);
      console.log('Content-Type:', r.content_type);
      console.log('Content:', r.content);
      console.log('Timed out:', r.timed_out);
      console.log('Error:', r.error_msg);
    });

    // Now test directly with fetch to get the actual error from Meta
    console.log('\n\n=== Direct WhatsApp API Test ===');
    const { rows: config } = await client.query(`
      SELECT phone_id, access_token FROM whatsapp_config WHERE is_connected = true LIMIT 1
    `);
    
    if (config.length === 0) {
      console.log('No config found');
      return;
    }

    const { phone_id, access_token } = config[0];

    // Get the payload that pg_net sent (reconstruct it)
    // First test with a simple text message to see if auth works
    const testPayload = {
      messaging_product: 'whatsapp',
      to: '972523413357',  // Israeli format
      type: 'text',
      text: { body: 'Test from Dockly bot' }
    };

    console.log('Phone ID:', phone_id);
    console.log('Token (first 20):', access_token?.substring(0, 20));
    console.log('Sending test to: 972523413357');

    const url = `https://graph.facebook.com/v18.0/${phone_id}/messages`;
    console.log('URL:', url);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testPayload),
    });

    const data = await res.json();
    console.log('Status:', res.status);
    console.log('Response:', JSON.stringify(data, null, 2));

  } catch(e) {
    console.error('Error:', e.message);
  } finally {
    await client.end();
  }
}

run();
