import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://mjtbahthexznbnmuyvhu.supabase.co'
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qdGJhaHRoZXh6bmJubXV5dmh1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzEzNzg4MCwiZXhwIjoyMDg4NzEzODgwfQ.uF6kec_6IqBynH1UOzutK1kH-g0w-0zE3mMof-0VSr0'

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false }
})

async function main() {
  // Check storage policies via SQL
  const { data, error } = await supabase.rpc('exec_sql', {
    sql: `SELECT policyname, tablename, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'storage'`
  })
  
  if (error) {
    console.log('exec_sql not available, trying alternative...')
    
    // Check bucket config
    const { data: buckets } = await supabase.storage.listBuckets()
    console.log('Buckets:', JSON.stringify(buckets, null, 2))
    
    // Try to create policies directly
    console.log('\n📋 Setting up storage RLS policies...')
    
    const policyStatements = [
      // Allow authenticated users to SELECT (view/download) from documents bucket
      `CREATE POLICY IF NOT EXISTS "Allow authenticated read" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'documents')`,
      // Allow authenticated users to INSERT (upload) to documents bucket  
      `CREATE POLICY IF NOT EXISTS "Allow authenticated insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'documents')`,
      // Allow authenticated users to UPDATE in documents bucket
      `CREATE POLICY IF NOT EXISTS "Allow authenticated update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'documents')`,
      // Allow authenticated users to DELETE from documents bucket
      `CREATE POLICY IF NOT EXISTS "Allow authenticated delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'documents')`,
    ]
    
    for (const sql of policyStatements) {
      console.log(`\nRunning: ${sql.substring(0, 60)}...`)
      const resp = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
        },
        body: JSON.stringify({ sql }),
      })
      const text = await resp.text()
      console.log(`Status: ${resp.status}`, text ? text.substring(0, 200) : 'OK')
    }
  } else {
    console.log('Storage policies:', JSON.stringify(data, null, 2))
  }
}

main().catch(console.error)
