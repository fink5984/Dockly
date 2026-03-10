/**
 * Add whatsapp_message_id column to support_messages table
 * This allows us to mark messages as read in WhatsApp (green check marks)
 */

import pg from 'pg';

const { Client } = pg;

const connectionString =
  'postgresql://postgres.mjtbahthexznbnmuyvhu:MbJu%23N%2FK6J6ANpR@aws-1-eu-west-1.pooler.supabase.com:5432/postgres';

const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });

async function main() {
  try {
    await client.connect();
    console.log('✅ Connected to database');

    // Add whatsapp_message_id column
    await client.query(`
      ALTER TABLE public.support_messages 
      ADD COLUMN IF NOT EXISTS whatsapp_message_id TEXT;
    `);
    console.log('✅ Added whatsapp_message_id column to support_messages');

    // Create index for faster lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_support_messages_whatsapp_id 
      ON public.support_messages(whatsapp_message_id) 
      WHERE whatsapp_message_id IS NOT NULL;
    `);
    console.log('✅ Created index on whatsapp_message_id');

    console.log('✅ Migration complete!');
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
