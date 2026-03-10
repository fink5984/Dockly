import pg from 'pg'

const client = new pg.Client({
  connectionString: 'postgresql://postgres.mjtbahthexznbnmuyvhu:MbJu%23N%2FK6J6ANpR@aws-1-eu-west-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
})

try {
  await client.connect()
  console.log('Connected to Supabase PostgreSQL')

  // Check existing storage policies
  const { rows: policies } = await client.query(
    `SELECT policyname, tablename, cmd FROM pg_policies WHERE schemaname = 'storage'`
  )
  console.log('\n📋 Existing storage policies:')
  if (policies.length === 0) {
    console.log('  (none)')
  } else {
    policies.forEach(p => console.log(`  - ${p.policyname} [${p.tablename}] ${p.cmd}`))
  }

  // Create policies for authenticated users
  const policySQL = [
    `DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'Allow authenticated select') THEN
        CREATE POLICY "Allow authenticated select" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'documents');
      END IF;
    END $$;`,
    `DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'Allow authenticated insert') THEN
        CREATE POLICY "Allow authenticated insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'documents');
      END IF;
    END $$;`,
    `DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'Allow authenticated update') THEN
        CREATE POLICY "Allow authenticated update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'documents');
      END IF;
    END $$;`,
    `DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'Allow authenticated delete') THEN
        CREATE POLICY "Allow authenticated delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'documents');
      END IF;
    END $$;`,
  ]

  console.log('\n🔐 Creating storage RLS policies...')
  for (const sql of policySQL) {
    try {
      await client.query(sql)
      const name = sql.match(/"(Allow authenticated \w+)"/)?.[1]
      console.log(`  ✅ ${name}`)
    } catch (err) {
      console.log(`  ⚠️ ${err.message}`)
    }
  }

  // Verify
  const { rows: after } = await client.query(
    `SELECT policyname, tablename, cmd FROM pg_policies WHERE schemaname = 'storage'`
  )
  console.log('\n📋 Storage policies after update:')
  after.forEach(p => console.log(`  - ${p.policyname} [${p.tablename}] ${p.cmd}`))

  console.log('\n✅ Done!')
} catch (err) {
  console.error('❌ Error:', err.message)
  process.exit(1)
} finally {
  await client.end()
}
