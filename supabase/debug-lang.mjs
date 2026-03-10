import pg from 'pg';

const client = new pg.Client({
  connectionString: 'postgresql://postgres.mjtbahthexznbnmuyvhu:MbJu%23N%2FK6J6ANpR@aws-1-eu-west-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    await client.connect();

    // Check workspace default_language
    const { rows: ws } = await client.query(`SELECT id, name, default_language FROM workspaces`);
    console.log('Workspaces:', JSON.stringify(ws, null, 2));

    // Check last pg_net response (did the fix work?)
    const { rows: resp } = await client.query(`
      SELECT id, status_code, content FROM net._http_response ORDER BY id DESC LIMIT 2
    `);
    console.log('\nLatest pg_net responses:');
    resp.forEach(r => {
      console.log(`  ID ${r.id}: status=${r.status_code} content=${r.content}`);
    });

  } catch(e) {
    console.error('Error:', e.message);
  } finally {
    await client.end();
  }
}

run();
