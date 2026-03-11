import pg from 'pg'

const client = new pg.Client({
  connectionString: 'postgresql://postgres.mjtbahthexznbnmuyvhu:MbJu%23N%2FK6J6ANpR@aws-1-eu-west-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
})

try {
  await client.connect()

  // Check full policy details
  const { rows } = await client.query(`
    SELECT policyname, tablename, cmd, roles, qual::text, with_check::text 
    FROM pg_policies WHERE schemaname = 'storage'
  `)
  
  console.log('Current storage policies:')
  rows.forEach(p => console.log(`  ${p.policyname} [${p.tablename}] ${p.cmd} roles=${JSON.stringify(p.roles)}`))

  // Check if RLS is enabled on storage.objects
  const { rows: rls } = await client.query(`
    SELECT relname, relrowsecurity, relforcerowsecurity
    FROM pg_class
    WHERE oid = 'storage.objects'::regclass
  `)
  console.log('\nRLS on storage.objects:', rls[0])

  // Add SELECT policy for anon role to allow signed URL generation
  console.log('\nAdding anon SELECT policy...')
  try {
    await client.query(`
      CREATE POLICY "Allow anon select for signed urls"
      ON storage.objects FOR SELECT TO anon
      USING (bucket_id = 'documents')
    `)
    console.log('  ✅ Created anon SELECT policy')
  } catch (err) {
    if (err.message.includes('already exists')) {
      console.log('  ℹ️ Already exists')
    } else {
      console.log('  ❌', err.message)
    }
  }

  // Verify
  const { rows: after } = await client.query(`
    SELECT policyname, roles FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
  `)
  console.log('\nPolicies after:')
  after.forEach(p => console.log(`  ${p.policyname} roles=${JSON.stringify(p.roles)}`))

} catch (err) {
  console.error('Error:', err.message)
} finally {
  await client.end()
}
