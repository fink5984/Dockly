import pg from 'pg';

const client = new pg.Client({
  connectionString: 'postgresql://postgres.mjtbahthexznbnmuyvhu:MbJu%23N%2FK6J6ANpR@aws-1-eu-west-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    await client.connect();
    const result = await client.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'whatsapp_config' ORDER BY ordinal_position`
    );
    console.log(JSON.stringify(result.rows, null, 2));
  } catch(e) {
    console.error('Error:', e.message);
  } finally {
    await client.end();
  }
}

run();
