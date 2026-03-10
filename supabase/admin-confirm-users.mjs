/**
 * Admin script: auto-confirm all unconfirmed users using service_role key.
 * Usage: node supabase/admin-confirm-users.mjs
 */

const SUPABASE_URL = 'https://mjtbahthexznbnmuyvhu.supabase.co'
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1qdGJhaHRoZXh6bmJubXV5dmh1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzEzNzg4MCwiZXhwIjoyMDg4NzEzODgwfQ.uF6kec_6IqBynH1UOzutK1kH-g0w-0zE3mMof-0VSr0'

async function main() {
  // 1. List all users
  console.log('Fetching users...')
  const listRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=50`, {
    headers: {
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'apikey': SERVICE_ROLE_KEY,
    },
  })
  const listData = await listRes.json()
  const users = listData.users || []
  console.log(`Found ${users.length} user(s)`)

  for (const user of users) {
    console.log(`  - ${user.email} | confirmed: ${!!user.email_confirmed_at} | id: ${user.id}`)
    
    if (!user.email_confirmed_at) {
      console.log(`    → Auto-confirming ${user.email}...`)
      const updateRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
          'apikey': SERVICE_ROLE_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email_confirm: true }),
      })
      if (updateRes.ok) {
        console.log(`    ✓ Confirmed!`)
      } else {
        const err = await updateRes.text()
        console.log(`    ✗ Failed: ${err}`)
      }
    }
  }

  console.log('\nDone! You can now sign in with any of the confirmed accounts.')
  console.log('\nIMPORTANT: To prevent this in the future, disable email confirmation:')
  console.log('  Supabase Dashboard → Authentication → Providers → Email → Disable "Confirm email"')
}

main().catch(console.error)
