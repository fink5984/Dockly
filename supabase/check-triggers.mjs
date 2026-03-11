import pg from 'pg';

const client = new pg.Client({
  connectionString: 'postgresql://postgres.mjtbahthexznbnmuyvhu:MbJu%23N%2FK6J6ANpR@aws-1-eu-west-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  // Check for triggers on case_documents
  const { rows: triggers } = await client.query(`
    SELECT trigger_name, event_manipulation, action_statement 
    FROM information_schema.triggers 
    WHERE event_object_table = 'case_documents'
  `);
  console.log('Triggers on case_documents:', JSON.stringify(triggers, null, 2));

  // Check for trigger functions that reference case status
  const { rows: funcs } = await client.query(`
    SELECT p.proname, pg_get_functiondef(p.oid) as def
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
    AND pg_get_functiondef(p.oid) LIKE '%case%status%'
  `);
  console.log('\nFunctions referencing case status:', funcs.length);
  funcs.forEach(f => {
    console.log(`\n--- ${f.proname} ---`);
    console.log(f.def);
  });

  // Check the specific case
  const { rows: c } = await client.query(
    "SELECT id, status FROM cases WHERE id = 'df40f4be-9cd2-4260-b0d1-781a550af0da'"
  );
  console.log('\nCase status:', c);

  const { rows: docs } = await client.query(
    "SELECT id, status FROM case_documents WHERE case_id = 'df40f4be-9cd2-4260-b0d1-781a550af0da'"
  );
  console.log('Documents:', docs);

  await client.end();
}

run().catch(console.error);
