import pg from 'pg';

const client = new pg.Client({
  connectionString: 'postgresql://postgres.mjtbahthexznbnmuyvhu:MbJu%23N%2FK6J6ANpR@aws-1-eu-west-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    await client.connect();
    console.log('Connected.\n');

    // 1. Check whatsapp_messages log
    console.log('=== WhatsApp Messages Log ===');
    const { rows: msgs } = await client.query(`
      SELECT id, direction, phone_number, message_type, status,
             LEFT(content, 80) AS content_preview,
             metadata, created_at
      FROM whatsapp_messages
      ORDER BY created_at DESC
      LIMIT 5
    `);
    if (msgs.length === 0) {
      console.log('  (no messages logged)');
    } else {
      msgs.forEach(m => console.log(JSON.stringify(m, null, 2)));
    }

    // 2. Check pg_net request log
    console.log('\n=== pg_net HTTP Requests ===');
    try {
      const { rows: requests } = await client.query(`
        SELECT id, method, url, status_code, 
               LEFT(response_body::text, 500) AS response_body,
               created
        FROM net._http_response
        ORDER BY created DESC
        LIMIT 5
      `);
      if (requests.length === 0) {
        console.log('  (no pg_net responses found)');
      } else {
        requests.forEach(r => console.log(JSON.stringify(r, null, 2)));
      }
    } catch(e) {
      console.log('  pg_net response table error:', e.message);
      // Try the request queue instead
      try {
        const { rows: queue } = await client.query(`
          SELECT * FROM net.http_request_queue ORDER BY id DESC LIMIT 5
        `);
        console.log('  Queue:', JSON.stringify(queue, null, 2));
      } catch(e2) {
        console.log('  Queue table error:', e2.message);
      }
    }

    // 3. Check conversation state
    console.log('\n=== Conversation State ===');
    const { rows: states } = await client.query(`
      SELECT * FROM whatsapp_conversation_state LIMIT 5
    `);
    if (states.length === 0) {
      console.log('  (no conversation states)');
    } else {
      states.forEach(s => console.log(JSON.stringify(s, null, 2)));
    }

    // 4. Check whatsapp_config credentials
    console.log('\n=== WhatsApp Config ===');
    const { rows: config } = await client.query(`
      SELECT id, workspace_id, is_connected, phone_number,
             LEFT(phone_id, 20) AS phone_id_prefix,
             CASE WHEN access_token IS NOT NULL AND LENGTH(access_token) > 10
                  THEN LEFT(access_token, 15) || '...[' || LENGTH(access_token)::text || ' chars]'
                  ELSE 'NULL/EMPTY'
             END AS access_token_status
      FROM whatsapp_config
    `);
    config.forEach(c => console.log(JSON.stringify(c, null, 2)));

  } catch(e) {
    console.error('Error:', e.message);
  } finally {
    await client.end();
  }
}

run();
