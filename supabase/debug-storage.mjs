/**
 * Debug storage: verify files exist and signed URLs work
 */
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://mjtbahthexznbnmuyvhu.supabase.co'
const serviceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qdGJhaHRoZXh6bmJubXV5dmh1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzEzNzg4MCwiZXhwIjoyMDg4NzEzODgwfQ.uF6kec_6IqBynH1UOzutK1kH-g0w-0zE3mMof-0VSr0'
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qdGJhaHRoZXh6bmJubXV5dmh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxMzc4ODAsImV4cCI6MjA4ODcxMzg4MH0.nxP-yTXhgEdrCoNRxb4OpjgY3M_w3qLaaMPKcjU8slU'

const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false }
})

const supabaseAnon = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false }
})

async function main() {
  console.log('=== Storage Debug ===\n')

  // 1. Check bucket exists
  const { data: buckets } = await supabaseAdmin.storage.listBuckets()
  const docBucket = buckets?.find(b => b.id === 'documents')
  console.log('1. Documents bucket:', docBucket ? `✅ exists (public: ${docBucket.public})` : '❌ NOT FOUND')
  if (!docBucket) return

  // 2. Get all case_documents with storage_path
  const { data: docs, error: docsErr } = await supabaseAdmin
    .from('case_documents')
    .select('id, case_id, storage_path, file_name, file_type, status, storage_status')
    .not('storage_path', 'is', null)
    .limit(10)

  if (docsErr) {
    console.log('2. Error fetching docs:', docsErr.message)
    return
  }

  console.log(`\n2. Found ${docs.length} documents with storage_path:\n`)

  for (const doc of docs) {
    console.log(`  📄 Doc ${doc.id}`)
    console.log(`     Path: ${doc.storage_path}`)
    console.log(`     File: ${doc.file_name} (${doc.file_type})`)
    console.log(`     Status: ${doc.status} / ${doc.storage_status}`)

    // 3. Check if file actually exists in storage
    const pathParts = doc.storage_path.split('/')
    const folder = pathParts.slice(0, -1).join('/')
    const fileName = pathParts[pathParts.length - 1]

    const { data: files, error: listErr } = await supabaseAdmin.storage
      .from('documents')
      .list(folder)

    if (listErr) {
      console.log(`     ❌ List error: ${listErr.message}`)
    } else {
      const found = files?.find(f => f.name === fileName)
      console.log(`     Storage: ${found ? `✅ exists (${found.metadata?.size || '?'} bytes)` : '❌ FILE NOT IN STORAGE'}`)
      if (!found && files?.length) {
        console.log(`     Files in folder: ${files.map(f => f.name).join(', ')}`)
      }
    }

    // 4. Try signed URL with service role
    const { data: signedAdmin, error: signErrAdmin } = await supabaseAdmin.storage
      .from('documents')
      .createSignedUrl(doc.storage_path, 60)
    console.log(`     SignedURL (service): ${signedAdmin ? '✅ OK' : `❌ ${signErrAdmin?.message}`}`)

    // 5. Try signed URL with anon key
    const { data: signedAnon, error: signErrAnon } = await supabaseAnon.storage
      .from('documents')
      .createSignedUrl(doc.storage_path, 60)
    console.log(`     SignedURL (anon):    ${signedAnon ? '✅ OK' : `❌ ${signErrAnon?.message}`}`)

    console.log('')
  }
}

main().catch(console.error)
