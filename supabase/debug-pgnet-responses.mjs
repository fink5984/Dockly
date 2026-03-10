import pg from 'pg';

const client = new pg.Client({
  connectionString: 'postgresql://postgres.mjtbahthexznbnmuyvhu:MbJu%23N%2FK6J6ANpR@aws-1-eu-west-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    await client.connect();

    // Check what columns exist in net._http_response
    const { rows: cols } = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'net' AND table_name = '_http_response'
      ORDER BY ordinal_position
    `);
    console.log('net._http_response columns:', cols.map(c => c.column_name).join(', '));

    // Get the actual responses
    const { rows } = await client.query(`
      SELECT * FROM net._http_response ORDER BY id DESC LIMIT 5
    `);
    rows.forEach(r => {
      console.log('\n--- Request ID:', r.id, '---');
      console.log('Status:', r.status_code);
      console.log('Headers:', typeof r.headers === 'string' ? r.headers.substring(0, 200) : JSON.stringify(r.headers)?.substring(0, 200));
      const body = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
      console.log('Body:', body?.substring(0, 1000));
      console.log('Error:', r.error_msg || r.error || 'none');
    });

  } catch(e) {
    console.error('Error:', e.message);
  } finally {
    await client.end();
  }
}

run();
