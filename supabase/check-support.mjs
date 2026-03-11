import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://postgres.mjtbahthexznbnmuyvhu:MbJu%23N%2FK6J6ANpR@aws-1-eu-west-1.pooler.supabase.com:5432/postgres';

const client = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();

  // 1. Check support_requests columns
  const { rows: cols } = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'support_requests'
    ORDER BY ordinal_position
  `);
  console.log('\n=== support_requests columns ===');
  console.table(cols);

  // 2. Check conversation state for test phone
  const { rows: state } = await client.query(`
    SELECT * FROM whatsapp_conversation_state WHERE phone_number = '972523413357'
  `);
  console.log('\n=== conversation state for 972523413357 ===');
  console.log(JSON.stringify(state, null, 2));

  // 3. Check if the case_id in state still exists
  if (state.length > 0 && state[0].case_id) {
    const { rows: caseCheck } = await client.query(
      'SELECT id, case_type, status FROM cases WHERE id = $1', [state[0].case_id]
    );
    console.log('\n=== case exists? ===');
    console.log(caseCheck.length > 0 ? caseCheck[0] : 'NOT FOUND');
  }

  // 4. Check existing support requests
  const { rows: srs } = await client.query(`
    SELECT id, case_id, client_id, status FROM support_requests ORDER BY created_at DESC LIMIT 5
  `);
  console.log('\n=== recent support_requests ===');
  console.table(srs);

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
