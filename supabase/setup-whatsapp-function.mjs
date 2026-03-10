import pg from 'pg';

const client = new pg.Client({
  connectionString: 'postgresql://postgres.mjtbahthexznbnmuyvhu:MbJu%23N%2FK6J6ANpR@aws-1-eu-west-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    await client.connect();
    console.log('Connected.');

    // 1. Store WhatsApp credentials in whatsapp_config
    // First, check if whatsapp_config has a row for the global bot
    const { rows: existing } = await client.query(
      `SELECT id FROM whatsapp_config LIMIT 1`
    );

    if (existing.length > 0) {
      // Update the existing row
      await client.query(`
        UPDATE whatsapp_config
        SET phone_id = $1,
            access_token = $2,
            api_key = $2,
            is_connected = true,
            updated_at = NOW()
        WHERE id = $3
      `, [
        '399038049967920',
        'EAAUw3U38gfcBQ9n5GZAvEZALpgir5QCMsRZCVtifgWX6uEGzoqc0bT3VUFNd7rsXFJR8KDqFr9QrL4hyRZBKSCuawlZB454rdaSiZBvDCeU6tFXFixkTUEEJVEurcikIbbVIz9TagGyVP6z9pOQ9fcxc2qpzBPdmhNuPQIZAIBeEtbCW44QT7epqYMMtipdi5H25dccPPTOQq6bazHd7ZAd8FnUV5B78zt0VHaOxI9m42QdQ2aSDxKzZBBXNHAr4PZB5ChBGSsSB0Lz6b2TYJcI6vBHHgm',
        existing[0].id
      ]);
      console.log('Updated existing whatsapp_config row with credentials.');
    } else {
      // Insert a new global config row
      await client.query(`
        INSERT INTO whatsapp_config (workspace_id, phone_id, access_token, api_key, is_connected)
        VALUES ('fb3768eb-95de-40cf-a667-63f566dede6c', $1, $2, $2, true)
      `, [
        '399038049967920',
        'EAAUw3U38gfcBQ9n5GZAvEZALpgir5QCMsRZCVtifgWX6uEGzoqc0bT3VUFNd7rsXFJR8KDqFr9QrL4hyRZBKSCuawlZB454rdaSiZBvDCeU6tFXFixkTUEEJVEurcikIbbVIz9TagGyVP6z9pOQ9fcxc2qpzBPdmhNuPQIZAIBeEtbCW44QT7epqYMMtipdi5H25dccPPTOQq6bazHd7ZAd8FnUV5B78zt0VHaOxI9m42QdQ2aSDxKzZBBXNHAr4PZB5ChBGSsSB0Lz6b2TYJcI6vBHHgm'
      ]);
      console.log('Inserted new whatsapp_config row with credentials.');
    }

    // 2. Create the database function for sending WhatsApp messages
    await client.query(`
      CREATE OR REPLACE FUNCTION send_whatsapp_document_request(
        p_workspace_id UUID,
        p_case_id UUID,
        p_client_id UUID,
        p_phone_number TEXT,
        p_language TEXT DEFAULT 'he',
        p_upload_url TEXT DEFAULT '',
        p_pending_count INT DEFAULT 0,
        p_case_title TEXT DEFAULT ''
      )
      RETURNS JSONB
      LANGUAGE plpgsql
      SECURITY DEFINER
      AS $func$
      DECLARE
        v_phone_id TEXT;
        v_access_token TEXT;
        v_message_body TEXT;
        v_wa_payload JSONB;
        v_request_id BIGINT;
        v_msg_id UUID;
        v_formatted_phone TEXT;
      BEGIN
        -- Get WhatsApp credentials from config
        SELECT phone_id, access_token INTO v_phone_id, v_access_token
        FROM whatsapp_config
        WHERE is_connected = true
        LIMIT 1;

        IF v_phone_id IS NULL OR v_access_token IS NULL THEN
          RETURN jsonb_build_object(
            'success', false,
            'error', 'WhatsApp not configured'
          );
        END IF;

        -- Format phone number (remove +, spaces, dashes)
        v_formatted_phone := regexp_replace(p_phone_number, '[^0-9]', '', 'g');

        -- Build message text based on language
        IF p_language = 'he' THEN
          v_message_body := 'שלום! 👋' || chr(10) || chr(10) ||
            'יש לנו בקשה להעלאת מסמכים עבור התיק: *' || COALESCE(p_case_title, '') || '*' || chr(10) || chr(10) ||
            '📄 מספר מסמכים להעלאה: *' || p_pending_count::TEXT || '*' || chr(10) || chr(10) ||
            'לחץ על הקישור הבא כדי להעלות את המסמכים:' || chr(10) ||
            p_upload_url || chr(10) || chr(10) ||
            '⏰ הקישור תקף ל-7 ימים.' || chr(10) ||
            'תודה! 🙏';
        ELSE
          v_message_body := 'Hello! 👋' || chr(10) || chr(10) ||
            'We have a document upload request for case: *' || COALESCE(p_case_title, '') || '*' || chr(10) || chr(10) ||
            '📄 Documents to upload: *' || p_pending_count::TEXT || '*' || chr(10) || chr(10) ||
            'Click the link below to upload your documents:' || chr(10) ||
            p_upload_url || chr(10) || chr(10) ||
            '⏰ This link is valid for 7 days.' || chr(10) ||
            'Thank you! 🙏';
        END IF;

        -- Build WhatsApp API payload
        v_wa_payload := jsonb_build_object(
          'messaging_product', 'whatsapp',
          'to', v_formatted_phone,
          'type', 'text',
          'text', jsonb_build_object('body', v_message_body)
        );

        -- Send via pg_net
        SELECT net.http_post(
          url := 'https://graph.facebook.com/v18.0/' || v_phone_id || '/messages',
          headers := jsonb_build_object(
            'Authorization', 'Bearer ' || v_access_token,
            'Content-Type', 'application/json'
          ),
          body := v_wa_payload
        ) INTO v_request_id;

        -- Log the message
        INSERT INTO whatsapp_messages (
          workspace_id, case_id, client_id, direction,
          phone_number, message_type, content, status,
          template_name, metadata
        ) VALUES (
          p_workspace_id, p_case_id, p_client_id, 'outbound',
          p_phone_number, 'text', v_message_body, 'sent',
          NULL, jsonb_build_object(
            'pg_net_request_id', v_request_id,
            'upload_url', p_upload_url
          )
        )
        RETURNING id INTO v_msg_id;

        RETURN jsonb_build_object(
          'success', true,
          'messageId', v_msg_id,
          'requestId', v_request_id,
          'status', 'sent'
        );

      EXCEPTION WHEN OTHERS THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', SQLERRM
        );
      END;
      $func$;
    `);
    console.log('Created send_whatsapp_document_request function!');

    // 3. Grant execute permission to authenticated users
    await client.query(`
      GRANT EXECUTE ON FUNCTION send_whatsapp_document_request TO authenticated;
    `);
    console.log('Granted execute permission to authenticated role.');

    // 4. Make sure RLS on whatsapp_config blocks direct reads from anon/authenticated
    // (the function runs as SECURITY DEFINER so it can read the config)
    await client.query(`
      ALTER TABLE whatsapp_config ENABLE ROW LEVEL SECURITY;
    `);
    // Drop existing policies first to avoid conflicts
    try {
      await client.query(`DROP POLICY IF EXISTS "whatsapp_config_no_direct_access" ON whatsapp_config;`);
    } catch(e) { /* ignore */ }
    await client.query(`
      CREATE POLICY "whatsapp_config_no_direct_access"
      ON whatsapp_config
      FOR ALL
      USING (false);
    `);
    console.log('Secured whatsapp_config table with RLS (no direct access).');

    console.log('\n✅ All done! WhatsApp DB function is ready.');

  } catch(e) {
    console.error('Error:', e.message);
  } finally {
    await client.end();
  }
}

run();
