/**
 * Migration: Add support chat via WhatsApp bot
 * - Adds support_mode & support_request_id to whatsapp_conversation_state
 * - Enables realtime on support_messages for live chat
 */
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://postgres.mjtbahthexznbnmuyvhu:MbJu%23N%2FK6J6ANpR@aws-1-eu-west-1.pooler.supabase.com:5432/postgres';

async function run() {
  const client = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('Connected.');

  try {
    // 1. Add support_mode column to conversation state
    await client.query(`
      ALTER TABLE whatsapp_conversation_state
        ADD COLUMN IF NOT EXISTS support_mode BOOLEAN NOT NULL DEFAULT false;
    `);
    console.log('✅ Added support_mode column');

    await client.query(`
      ALTER TABLE whatsapp_conversation_state
        ADD COLUMN IF NOT EXISTS support_request_id UUID;
    `);
    console.log('✅ Added support_request_id column');

    // 2. Enable realtime on support_messages  
    try {
      await client.query(`
        ALTER PUBLICATION supabase_realtime ADD TABLE public.support_messages;
      `);
      console.log('✅ Enabled realtime on support_messages');
    } catch (e) {
      if (e.message.includes('already member')) {
        console.log('ℹ️  support_messages already in realtime publication');
      } else {
        console.warn('⚠️  Could not enable realtime on support_messages:', e.message);
      }
    }

    // 3. Enable realtime on support_requests
    try {
      await client.query(`
        ALTER PUBLICATION supabase_realtime ADD TABLE public.support_requests;
      `);
      console.log('✅ Enabled realtime on support_requests');
    } catch (e) {
      if (e.message.includes('already member')) {
        console.log('ℹ️  support_requests already in realtime publication');
      } else {
        console.warn('⚠️  Could not enable realtime on support_requests:', e.message);
      }
    }

    // 4. Disable RLS on support tables (custom auth, no Supabase Auth)
    await client.query(`ALTER TABLE public.support_requests DISABLE ROW LEVEL SECURITY;`);
    await client.query(`ALTER TABLE public.support_messages DISABLE ROW LEVEL SECURITY;`);
    console.log('✅ Disabled RLS on support tables (custom auth)');

    console.log('\n🎉 Migration complete!');
  } catch (err) {
    console.error('❌ Error:', err);
  } finally {
    await client.end();
  }
}

run();
