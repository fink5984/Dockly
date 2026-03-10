import pg from 'pg';

const client = new pg.Client({
  connectionString: 'postgresql://postgres.mjtbahthexznbnmuyvhu:MbJu%23N%2FK6J6ANpR@aws-1-eu-west-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    await client.connect();
    console.log('Connected. Updating case statuses...');

    // Get all cases
    const { rows: cases } = await client.query('SELECT id FROM cases');

    for (const c of cases) {
      const { rows: docs } = await client.query(
        `SELECT status FROM case_documents WHERE case_id = $1`,
        [c.id]
      );

      const total = docs.length;
      const pending = docs.filter(d => ['missing', 'pending-upload', 'rejected'].includes(d.status)).length;
      const uploaded = docs.filter(d => ['uploaded', 'under-review'].includes(d.status)).length;
      const approved = docs.filter(d => d.status === 'approved').length;

      let newStatus;
      if (total === 0) {
        newStatus = 'new';
      } else if (approved === total) {
        newStatus = 'completed';
      } else if (uploaded > 0 && pending === 0) {
        newStatus = 'awaiting-review';
      } else if (uploaded > 0 || approved > 0) {
        newStatus = 'partial-submission';
      } else {
        newStatus = 'waiting-for-client';
      }

      await client.query(
        `UPDATE cases SET status = $1, updated_at = NOW() WHERE id = $2`,
        [newStatus, c.id]
      );

      console.log(`Case ${c.id}: ${total} docs, ${uploaded} uploaded, ${approved} approved → ${newStatus}`);
    }

    console.log('\n✅ Done! All case statuses updated.');

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await client.end();
  }
}

run();
