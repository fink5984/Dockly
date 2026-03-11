import pg from 'pg';

const DATABASE_URL = 'postgresql://postgres.mjtbahthexznbnmuyvhu:MbJu%23N%2FK6J6ANpR@aws-1-eu-west-1.pooler.supabase.com:5432/postgres';
const client = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();
  const { rowCount } = await client.query(
    `UPDATE whatsapp_conversation_state SET support_mode = false, support_request_id = NULL WHERE phone_number = '972523413357'`
  );
  console.log('Fixed:', rowCount, 'rows');
  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
