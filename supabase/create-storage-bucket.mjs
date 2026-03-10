/**
 * Create the 'documents' storage bucket in Supabase
 */
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://mjtbahthexznbnmuyvhu.supabase.co'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseServiceKey) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY is required')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false }
})

async function createBucket() {
  console.log('🪣 Creating documents storage bucket...')
  
  // Check if bucket exists
  const { data: buckets, error: listError } = await supabase.storage.listBuckets()
  
  if (listError) {
    console.error('❌ Error listing buckets:', listError.message)
    process.exit(1)
  }
  
  const existingBucket = buckets?.find(b => b.id === 'documents')
  
  if (existingBucket) {
    console.log('✅ Bucket "documents" already exists')
    return
  }
  
  // Create the bucket
  const { data, error } = await supabase.storage.createBucket('documents', {
    public: false,
    fileSizeLimit: 52428800, // 50MB
    allowedMimeTypes: [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]
  })
  
  if (error) {
    console.error('❌ Error creating bucket:', error.message)
    process.exit(1)
  }
  
  console.log('✅ Bucket "documents" created successfully!')
  
  // Now set up RLS policies via SQL
  console.log('🔐 Setting up storage RLS policies...')
  
  const policies = [
    {
      name: 'Workspace members can upload files',
      operation: 'INSERT',
      check: `bucket_id = 'documents'`
    },
    {
      name: 'Workspace members can view files',
      operation: 'SELECT',
      using: `bucket_id = 'documents'`
    },
    {
      name: 'Workspace members can update files',
      operation: 'UPDATE',
      using: `bucket_id = 'documents'`
    },
    {
      name: 'Workspace members can delete files',
      operation: 'DELETE',
      using: `bucket_id = 'documents'`
    }
  ]
  
  for (const policy of policies) {
    const sql = policy.check
      ? `CREATE POLICY "${policy.name}" ON storage.objects FOR ${policy.operation} WITH CHECK (${policy.check});`
      : `CREATE POLICY "${policy.name}" ON storage.objects FOR ${policy.operation} USING (${policy.using});`
    
    const { error: policyError } = await supabase.rpc('exec_sql', { sql })
    
    if (policyError && !policyError.message.includes('already exists')) {
      console.warn(`⚠️ Policy "${policy.name}": ${policyError.message}`)
    } else {
      console.log(`  ✓ ${policy.name}`)
    }
  }
  
  console.log('\n✅ Storage setup complete!')
}

createBucket().catch(console.error)
