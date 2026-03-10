import pg from 'pg';

// UPDATE THIS with your new Meta access token
const NEW_ACCESS_TOKEN = 'EAAUw3U38gfcBQ3t7BuL95QZCgT1aOvzTTrNq3NDueuYWBGpeDxB0FpA8hZCspoeVU1qdbaRzalTze7NGYZB8u4lCK2LmupBf1DmrIGFUG1wsBoi9vfGFVU4sV9PsyW5p8qe0HbRTQefEQY8jkZArpmIFYLWVhWRnOkmiTIscnTW2wvCjrYleQG3qw076S4CpYzYW2soL8Q1KTNRiC3OTfd2ADJqUmdP2H4PjFgpnMCcWJFteN60QxNAsvZC4B60etPnd0ZA6DZCMmRv8at7D5Jwilbx';
const PHONE_ID = '399038049967920';

const client = new pg.Client({
  connectionString: 'postgresql://postgres.mjtbahthexznbnmuyvhu:MbJu%23N%2FK6J6ANpR@aws-1-eu-west-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    await client.connect();
    console.log('Connected to database.');

    // Check current config
    const { rows: existing } = await client.query('SELECT phone_id, is_connected, created_at FROM whatsapp_config');
    console.log('Current config:', existing);

    if (existing.length === 0) {
      // Insert new config
      await client.query(`
        INSERT INTO whatsapp_config (phone_id, access_token, is_connected)
        VALUES ($1, $2, true)
      `, [PHONE_ID, NEW_ACCESS_TOKEN]);
      console.log('✅ Created new WhatsApp config');
    } else {
      // Update existing config
      await client.query(`
        UPDATE whatsapp_config
        SET access_token = $1, phone_id = $2, is_connected = true, updated_at = NOW()
        WHERE id = (SELECT id FROM whatsapp_config LIMIT 1)
      `, [NEW_ACCESS_TOKEN, PHONE_ID]);
      console.log('✅ Updated WhatsApp config with new token');
    }

    console.log('\nDone! WhatsApp config updated.');
    console.log('Make sure the token has whatsapp_business_messaging permission.');

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

run();
