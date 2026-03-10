import pg from 'pg';

const client = new pg.Client({
  connectionString: 'postgresql://postgres.mjtbahthexznbnmuyvhu:MbJu%23N%2FK6J6ANpR@aws-1-eu-west-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    await client.connect();
    console.log('Connected to database.');

    // Enable realtime for tables
    const tables = ['cases', 'case_documents', 'clients', 'activity_log', 'support_requests', 'document_types'];
    
    for (const table of tables) {
      try {
        await client.query(`ALTER PUBLICATION supabase_realtime ADD TABLE ${table}`);
        console.log(`✅ Enabled realtime for: ${table}`);
      } catch (err) {
        if (err.message.includes('already member')) {
          console.log(`ℹ️  Already enabled: ${table}`);
        } else {
          console.error(`❌ Error enabling ${table}:`, err.message);
        }
      }
    }

    console.log('\n✅ Done! Realtime enabled for all tables.');
    console.log('Data will now auto-refresh when documents are uploaded via WhatsApp.');

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

run();
