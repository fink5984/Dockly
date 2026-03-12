-- =========================================
-- Digital Signatures Migration
-- =========================================

-- Table: signature_requests
CREATE TABLE IF NOT EXISTS signature_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  case_id       uuid REFERENCES cases(id) ON DELETE SET NULL,
  title         text NOT NULL,
  description   text,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('draft','pending','viewed','signed','declined','expired','cancelled')),
  public_token  text NOT NULL UNIQUE,
  document_file_name    text NOT NULL,
  document_storage_path text NOT NULL,
  document_file_type    text NOT NULL DEFAULT 'application/pdf',
  document_file_size    bigint NOT NULL DEFAULT 0,
  signed_at           timestamptz,
  signed_ip           text,
  signed_document_path text,
  expires_at          timestamptz,
  created_by          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE signature_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own workspace signature requests"
  ON signature_requests FOR SELECT
  USING (
    workspace_id IN (SELECT workspace_id FROM profiles WHERE id = auth.uid())
    OR public_token IS NOT NULL
  );

CREATE POLICY "Users can insert signature requests in own workspace"
  ON signature_requests FOR INSERT
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Users can update signature requests in own workspace"
  ON signature_requests FOR UPDATE
  USING (
    workspace_id IN (SELECT workspace_id FROM profiles WHERE id = auth.uid())
    OR public_token IS NOT NULL
  );

CREATE POLICY "Users can delete signature requests in own workspace"
  ON signature_requests FOR DELETE
  USING (workspace_id IN (SELECT workspace_id FROM profiles WHERE id = auth.uid()));

-- Allow anonymous/public access via token
CREATE POLICY "Public can view by token"
  ON signature_requests FOR SELECT
  USING (true);

CREATE POLICY "Public can update by token"
  ON signature_requests FOR UPDATE
  USING (true);

-- Table: signature_fields
CREATE TABLE IF NOT EXISTS signature_fields (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  uuid NOT NULL REFERENCES signature_requests(id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN ('signature','date','name','text','initials','checkbox')),
  label       text NOT NULL DEFAULT '',
  page        int NOT NULL DEFAULT 1,
  x           double precision NOT NULL DEFAULT 0,
  y           double precision NOT NULL DEFAULT 0,
  width       double precision NOT NULL DEFAULT 200,
  height      double precision NOT NULL DEFAULT 40,
  required    boolean NOT NULL DEFAULT true,
  value       text,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE signature_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view signature fields"
  ON signature_fields FOR SELECT
  USING (true);

CREATE POLICY "Users can insert signature fields"
  ON signature_fields FOR INSERT
  WITH CHECK (
    request_id IN (
      SELECT id FROM signature_requests
      WHERE workspace_id IN (SELECT workspace_id FROM profiles WHERE id = auth.uid())
    )
  );

CREATE POLICY "Users can update signature fields"
  ON signature_fields FOR UPDATE
  USING (true);

CREATE POLICY "Users can delete signature fields"
  ON signature_fields FOR DELETE
  USING (
    request_id IN (
      SELECT id FROM signature_requests
      WHERE workspace_id IN (SELECT workspace_id FROM profiles WHERE id = auth.uid())
    )
  );

-- Indexes
CREATE INDEX IF NOT EXISTS idx_signature_requests_workspace ON signature_requests(workspace_id);
CREATE INDEX IF NOT EXISTS idx_signature_requests_client ON signature_requests(client_id);
CREATE INDEX IF NOT EXISTS idx_signature_requests_case ON signature_requests(case_id);
CREATE INDEX IF NOT EXISTS idx_signature_requests_token ON signature_requests(public_token);
CREATE INDEX IF NOT EXISTS idx_signature_requests_status ON signature_requests(status);
CREATE INDEX IF NOT EXISTS idx_signature_fields_request ON signature_fields(request_id);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_signature_request_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_signature_requests_updated_at
  BEFORE UPDATE ON signature_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_signature_request_updated_at();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE signature_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE signature_fields;
