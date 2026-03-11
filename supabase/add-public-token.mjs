/**
 * Migration: Add public_token column to cases table
 * Run: node supabase/add-public-token.mjs
 *
 * This adds a unique, auto-generated public token per case
 * so each case can be shared via a permanent public link.
 */
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://mjtbahthexznbnmuyvhu.supabase.co'
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceKey)

async function migrate() {
  console.log('Adding public_token column to cases table...')

  const { error: e1 } = await supabase.rpc('exec_sql', {
    sql: `
      ALTER TABLE public.cases
      ADD COLUMN IF NOT EXISTS public_token TEXT UNIQUE;
    `
  }).single()

  // Try direct SQL if rpc doesn't work
  if (e1) {
    console.log('RPC exec_sql not available, trying raw query...')
    const { error: e2 } = await supabase.from('cases').select('public_token').limit(1)
    if (e2 && e2.message.includes('does not exist')) {
      console.log('Column does not exist. Please run this SQL in Supabase SQL Editor:')
      console.log(`
-- Add public_token column to cases
ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS public_token TEXT UNIQUE;

-- Create index for fast lookup
CREATE INDEX IF NOT EXISTS idx_cases_public_token ON public.cases(public_token);

-- Generate tokens for existing cases that don't have one
UPDATE public.cases 
SET public_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
WHERE public_token IS NULL;
      `)
    } else {
      console.log('Column already exists or was added successfully.')
    }
  } else {
    console.log('Column added.')

    // Create index
    await supabase.rpc('exec_sql', {
      sql: `CREATE INDEX IF NOT EXISTS idx_cases_public_token ON public.cases(public_token);`
    })

    // Backfill existing cases
    await supabase.rpc('exec_sql', {
      sql: `
        UPDATE public.cases 
        SET public_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
        WHERE public_token IS NULL;
      `
    })

    console.log('Backfilled existing cases with tokens.')
  }

  console.log('Done!')
}

migrate().catch(console.error)
