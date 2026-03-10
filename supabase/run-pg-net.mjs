import pg from 'pg';

const client = new pg.Client({
  connectionString: 'postgresql://postgres.mjtbahthexznbnmuyvhu:MbJu%23N%2FK6J6ANpR@aws-1-eu-west-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    await client.connect();
    console.log('Connected.');

    // Enable pg_net extension
    await client.query(`CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;`);
    console.log('pg_net extension enabled!');

    // Add phone_id column to whatsapp_config if not exists
    await client.query(`
      ALTER TABLE whatsapp_config 
      ADD COLUMN IF NOT EXISTS phone_id TEXT,
      ADD COLUMN IF NOT EXISTS access_token TEXT;
    `);
    console.log('Added phone_id and access_token columns to whatsapp_config.');

  } catch(e) {
    console.error('Error:', e.message);
  } finally {
    await client.end();
  }
}

run();
