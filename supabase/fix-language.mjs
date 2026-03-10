import pg from 'pg';

const client = new pg.Client({
  connectionString: 'postgresql://postgres.mjtbahthexznbnmuyvhu:MbJu%23N%2FK6J6ANpR@aws-1-eu-west-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    await client.connect();
    await client.query(`UPDATE workspaces SET default_language = 'he' WHERE id = 'fb3768eb-95de-40cf-a667-63f566dede6c'`);
    console.log('Updated Dockly workspace default_language to he');
  } catch(e) {
    console.error('Error:', e.message);
  } finally {
    await client.end();
  }
}
run();
