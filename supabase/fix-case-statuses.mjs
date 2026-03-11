import pg from 'pg';

const client = new pg.Client({
  connectionString: 'postgresql://postgres.mjtbahthexznbnmuyvhu:MbJu%23N%2FK6J6ANpR@aws-1-eu-west-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();

  // Check the specific case from the screenshot
  const { rows: c } = await client.query(
    "SELECT id, status FROM cases WHERE id = 'df40f4be-9cd2-4260-b0d1-781a550af0da'"
  );
  console.log('Case:', c);

  const { rows: docs } = await client.query(
    "SELECT id, status, file_name FROM case_documents WHERE case_id = 'df40f4be-9cd2-4260-b0d1-781a550af0da'"
  );
  console.log('Documents:', docs);

  // Check ALL cases and recalculate their statuses
  const { rows: allCases } = await client.query('SELECT id, status FROM cases');
  for (const cs of allCases) {
    const { rows: cDocs } = await client.query(
      'SELECT status FROM case_documents WHERE case_id = $1', [cs.id]
    );
    const total = cDocs.length;
    const uploaded = cDocs.filter(d => d.status === 'uploaded').length;
    const missing = cDocs.filter(d => ['missing', 'pending-upload'].includes(d.status)).length;

    let newStatus;
    if (total === 0) {
      newStatus = 'new';
    } else if (uploaded === total) {
      newStatus = 'completed';
    } else if (uploaded > 0 && missing > 0) {
      newStatus = 'partial-submission';
    } else {
      newStatus = 'waiting-for-client';
    }

    if (cs.status !== newStatus) {
      console.log(`Case ${cs.id}: ${cs.status} -> ${newStatus} (${uploaded}/${total} uploaded)`);
      await client.query(
        'UPDATE cases SET status = $1, updated_at = NOW() WHERE id = $2',
        [newStatus, cs.id]
      );
    }
  }

  console.log('\n✅ Done!');
  await client.end();
}

run().catch(console.error);
