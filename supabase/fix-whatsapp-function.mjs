import pg from 'pg';

const client = new pg.Client({
  connectionString: 'postgresql://postgres.mjtbahthexznbnmuyvhu:MbJu%23N%2FK6J6ANpR@aws-1-eu-west-1.pooler.supabase.com:5432/postgres',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  try {
    await client.connect();
    console.log('Connected.');

    // Fix: 1) interactive body structure  2) phone number formatting (add 972 for Israeli numbers)
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
        v_body_text TEXT;
        v_wa_payload JSONB;
        v_request_id BIGINT;
        v_msg_id UUID;
        v_formatted_phone TEXT;
        v_button_id TEXT;
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

        -- Format phone number: remove non-digits, convert Israeli local to international
        v_formatted_phone := regexp_replace(p_phone_number, '[^0-9]', '', 'g');
        -- Israeli local numbers: 05x → 9725x
        IF v_formatted_phone LIKE '05%' AND LENGTH(v_formatted_phone) = 10 THEN
          v_formatted_phone := '972' || SUBSTRING(v_formatted_phone FROM 2);
        -- Already has country code with leading 0
        ELSIF v_formatted_phone LIKE '00%' THEN
          v_formatted_phone := SUBSTRING(v_formatted_phone FROM 3);
        END IF;

        -- Button ID encodes the case_id
        v_button_id := 'show_docs_' || p_case_id::TEXT;

        -- Build message text based on language
        IF p_language = 'he' THEN
          v_body_text := E'שלום! 👋\n\n' ||
            E'יש מסמכים שצריך להעלות עבור התיק: *' || COALESCE(p_case_title, '') || E'*\n' ||
            E'📄 מספר מסמכים להעלאה: *' || p_pending_count::TEXT || E'*\n\n' ||
            E'לחץ על הכפתור למטה כדי לראות את רשימת המסמכים ולהעלות אותם ישירות כאן בוואטסאפ.';
        ELSE
          v_body_text := E'Hello! 👋\n\n' ||
            E'There are documents to upload for case: *' || COALESCE(p_case_title, '') || E'*\n' ||
            E'📄 Documents to upload: *' || p_pending_count::TEXT || E'*\n\n' ||
            E'Click the button below to see the document list and upload them directly here in WhatsApp.';
        END IF;

        -- Build WhatsApp interactive button payload
        -- NOTE: interactive.body uses key "text" (not "body")
        v_wa_payload := jsonb_build_object(
          'messaging_product', 'whatsapp',
          'to', v_formatted_phone,
          'type', 'interactive',
          'interactive', jsonb_build_object(
            'type', 'button',
            'body', jsonb_build_object('text', v_body_text),
            'action', jsonb_build_object(
              'buttons', jsonb_build_array(
                jsonb_build_object(
                  'type', 'reply',
                  'reply', jsonb_build_object(
                    'id', v_button_id,
                    'title', CASE WHEN p_language = 'he' THEN 'הצג מסמכים' ELSE 'Show Documents' END
                  )
                )
              )
            )
          )
        );

        -- Set conversation state for this phone
        INSERT INTO whatsapp_conversation_state (phone_number, case_id, client_id, workspace_id, updated_at)
        VALUES (v_formatted_phone, p_case_id, p_client_id, p_workspace_id, NOW())
        ON CONFLICT (phone_number) DO UPDATE SET
          case_id = p_case_id,
          client_id = p_client_id,
          workspace_id = p_workspace_id,
          awaiting_document_id = NULL,
          awaiting_document_name = NULL,
          updated_at = NOW();

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
          metadata
        ) VALUES (
          p_workspace_id, p_case_id, p_client_id, 'outbound',
          p_phone_number, 'interactive', v_body_text, 'sent',
          jsonb_build_object('pg_net_request_id', v_request_id, 'button_id', v_button_id, 'formatted_phone', v_formatted_phone)
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
    console.log('✅ Fixed send_whatsapp_document_request function!');
    console.log('   - Fixed interactive body: body.text instead of body.body');
    console.log('   - Fixed phone formatting: 05x → 9725x');
    console.log('   - Removed emoji from button title (Meta limit: 20 chars, no emoji)');

  } catch(e) {
    console.error('Error:', e.message);
  } finally {
    await client.end();
  }
}

run();
