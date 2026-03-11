import pg from 'pg'

const connectionString =
  'postgresql://postgres.mjtbahthexznbnmuyvhu:MbJu%23N%2FK6J6ANpR@aws-1-eu-west-1.pooler.supabase.com:5432/postgres'

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })

try {
  console.log('Connecting to Supabase...')
  await client.connect()
  console.log('Connected.')

  console.log('1. Adding public_token column...')
  await client.query('ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS public_token TEXT UNIQUE')
  console.log('   Done.')

  console.log('2. Creating index...')
  await client.query('CREATE INDEX IF NOT EXISTS idx_cases_public_token ON public.cases(public_token)')
  console.log('   Done.')

  console.log('3. Backfilling existing cases with tokens...')
  const r = await client.query(`
    UPDATE public.cases 
    SET public_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
    WHERE public_token IS NULL
  `)
  console.log(`   Backfilled ${r.rowCount} rows.`)

  // Enable anon access for public portal queries
  console.log('4. Setting up RLS policy for public token access...')
  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE policyname = 'allow_public_token_read' AND tablename = 'cases'
      ) THEN
        CREATE POLICY allow_public_token_read ON public.cases
          FOR SELECT USING (public_token IS NOT NULL);
      END IF;
    END $$;
  `)
  console.log('   Done.')

  console.log('\n✓ Migration completed successfully!')
} catch (err) {
  console.error('✗ Migration failed:', err.message)
  process.exit(1)
} finally {
  await client.end()
}
