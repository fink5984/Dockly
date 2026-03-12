/* ============================================================
   Supabase Database Types
   Matching the SQL schema. Inline Insert/Update to avoid
   circular self-references that resolve to 
ever`.
   ============================================================ */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  __InternalSupabase: {
    PostgrestVersion: '12'
  }
  public: {
    Tables: {
      workspaces: {
        Row: {
          id: string
          name: string
          business_type: string
          contact_person: string
          phone: string
          email: string
          logo_url: string | null
          default_language: string
          timezone: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          business_type: string
          contact_person: string
          phone: string
          email: string
          logo_url?: string | null
          default_language: string
          timezone: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          business_type?: string
          contact_person?: string
          phone?: string
          email?: string
          logo_url?: string | null
          default_language?: string
          timezone?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          workspace_id: string
          email: string
          name: string
          role: string
          avatar_url: string | null
          phone: string | null
          password: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          email: string
          name: string
          role: string
          avatar_url?: string | null
          phone?: string | null
          password: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          email?: string
          name?: string
          role?: string
          avatar_url?: string | null
          phone?: string | null
          password?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      clients: {
        Row: {
          id: string
          workspace_id: string
          name: string
          email: string
          phone: string
          company: string | null
          notes: string | null
          status: string
          assigned_owner: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          name: string
          email: string
          phone: string
          company?: string | null
          notes?: string | null
          status: string
          assigned_owner: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          name?: string
          email?: string
          phone?: string
          company?: string | null
          notes?: string | null
          status?: string
          assigned_owner?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      document_types: {
        Row: {
          id: string
          workspace_id: string
          name: string
          category: string
          description: string
          helper_text: string
          default_required: boolean
          is_required: boolean
          allowed_formats: string[]
          max_size_mb: number
          status: string
          applicable_case_types: string[]
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          name: string
          category: string
          description: string
          helper_text: string
          default_required: boolean
          is_required: boolean
          allowed_formats: string[]
          max_size_mb: number
          status: string
          applicable_case_types: string[]
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          name?: string
          category?: string
          description?: string
          helper_text?: string
          default_required?: boolean
          is_required?: boolean
          allowed_formats?: string[]
          max_size_mb?: number
          status?: string
          applicable_case_types?: string[]
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      document_presets: {
        Row: {
          id: string
          workspace_id: string
          name: string
          case_type: string
          document_type_ids: string[]
          description: string
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          name: string
          case_type: string
          document_type_ids: string[]
          description: string
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          name?: string
          case_type?: string
          document_type_ids?: string[]
          description?: string
          created_at?: string
        }
        Relationships: []
      }
      cases: {
        Row: {
          id: string
          workspace_id: string
          client_id: string
          case_type: string
          status: string
          assigned_owner: string
          deadline: string | null
          notes: string | null
          support_request_id: string | null
          last_activity_date: string | null
          public_token: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          client_id: string
          case_type: string
          status: string
          assigned_owner: string
          deadline?: string | null
          notes?: string | null
          support_request_id?: string | null
          last_activity_date?: string | null
          public_token?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          client_id?: string
          case_type?: string
          status?: string
          assigned_owner?: string
          deadline?: string | null
          notes?: string | null
          support_request_id?: string | null
          last_activity_date?: string | null
          public_token?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      case_documents: {
        Row: {
          id: string
          case_id: string
          document_type_id: string
          is_required: boolean
          status: string
          case_notes: string | null
          notes: string | null
          file_name: string | null
          file_type: string | null
          file_size: number | null
          storage_path: string | null
          storage_status: string | null
          uploaded_by: string | null
          uploaded_at: string | null
          reviewed_by: string | null
          reviewed_at: string | null
          rejection_reason: string | null
          version_count: number
          sort_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          case_id: string
          document_type_id: string
          is_required: boolean
          status: string
          case_notes?: string | null
          notes?: string | null
          file_name?: string | null
          file_type?: string | null
          file_size?: number | null
          storage_path?: string | null
          storage_status?: string | null
          uploaded_by?: string | null
          uploaded_at?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          rejection_reason?: string | null
          version_count?: number
          sort_order: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          case_id?: string
          document_type_id?: string
          is_required?: boolean
          status?: string
          case_notes?: string | null
          notes?: string | null
          file_name?: string | null
          file_type?: string | null
          file_size?: number | null
          storage_path?: string | null
          storage_status?: string | null
          uploaded_by?: string | null
          uploaded_at?: string | null
          reviewed_by?: string | null
          reviewed_at?: string | null
          rejection_reason?: string | null
          version_count?: number
          sort_order?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      support_requests: {
        Row: {
          id: string
          case_id: string
          client_id: string
          subject: string
          status: string
          assigned_staff: string | null
          opened_at: string
          closed_at: string | null
          issue_description: string
          created_at: string
        }
        Insert: {
          id?: string
          case_id: string
          client_id: string
          subject: string
          status: string
          assigned_staff?: string | null
          opened_at: string
          closed_at?: string | null
          issue_description: string
          created_at?: string
        }
        Update: {
          id?: string
          case_id?: string
          client_id?: string
          subject?: string
          status?: string
          assigned_staff?: string | null
          opened_at?: string
          closed_at?: string | null
          issue_description?: string
          created_at?: string
        }
        Relationships: []
      }
      support_messages: {
        Row: {
          id: string
          request_id: string
          sender_type: string
          sender_name: string
          content: string
          is_read: boolean
          whatsapp_message_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          request_id: string
          sender_type: string
          sender_name: string
          content: string
          is_read?: boolean
          whatsapp_message_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          request_id?: string
          sender_type?: string
          sender_name?: string
          content?: string
          is_read?: boolean
          whatsapp_message_id?: string | null
          created_at?: string
        }
        Relationships: []
      }
      activity_events: {
        Row: {
          id: string
          workspace_id: string
          type: string
          description: string
          user_id: string
          user_name: string
          client_id: string | null
          client_name: string | null
          case_id: string | null
          document_id: string | null
          metadata: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          type: string
          description: string
          user_id: string
          user_name: string
          client_id?: string | null
          client_name?: string | null
          case_id?: string | null
          document_id?: string | null
          metadata?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          type?: string
          description?: string
          user_id?: string
          user_name?: string
          client_id?: string | null
          client_name?: string | null
          case_id?: string | null
          document_id?: string | null
          metadata?: Json | null
          created_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          id: string
          workspace_id: string
          user_id: string
          type: string
          title: string
          message: string
          read: boolean
          action_url: string | null
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          user_id: string
          type: string
          title: string
          message: string
          read?: boolean
          action_url?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          user_id?: string
          type?: string
          title?: string
          message?: string
          read?: boolean
          action_url?: string | null
          created_at?: string
        }
        Relationships: []
      }
      case_type_configs: {
        Row: {
          id: string
          workspace_id: string
          name: string
          name_he: string
          icon: string
          color: string
          default_document_type_ids: string[]
          is_active: boolean
          created_at: string
        }
        Insert: {
          id: string
          workspace_id: string
          name: string
          name_he: string
          icon: string
          color: string
          default_document_type_ids: string[]
          is_active: boolean
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          name?: string
          name_he?: string
          icon?: string
          color?: string
          default_document_type_ids?: string[]
          is_active?: boolean
          created_at?: string
        }
        Relationships: []
      }
      whatsapp_config: {
        Row: {
          id: string
          workspace_id: string
          is_connected: boolean
          phone_number: string | null
          last_sync: string | null
          api_key: string | null
          connected_at: string | null
          messages_sent: number
          messages_received: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          is_connected: boolean
          phone_number?: string | null
          last_sync?: string | null
          api_key?: string | null
          connected_at?: string | null
          messages_sent?: number
          messages_received?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          is_connected?: boolean
          phone_number?: string | null
          last_sync?: string | null
          api_key?: string | null
          connected_at?: string | null
          messages_sent?: number
          messages_received?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      message_templates: {
        Row: {
          id: string
          workspace_id: string
          key: string
          name: string
          content_en: string
          content_he: string
          variables: string[]
          trigger: string
          body_template: string
          is_active: boolean
          language: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          key: string
          name: string
          content_en: string
          content_he: string
          variables: string[]
          trigger: string
          body_template: string
          is_active: boolean
          language: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          key?: string
          name?: string
          content_en?: string
          content_he?: string
          variables?: string[]
          trigger?: string
          body_template?: string
          is_active?: boolean
          language?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      automation_rules: {
        Row: {
          id: string
          workspace_id: string
          name: string
          trigger: string
          action: string
          enabled: boolean
          is_active: boolean
          delay: string | null
          delay_minutes: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          name: string
          trigger: string
          action: string
          enabled: boolean
          is_active: boolean
          delay?: string | null
          delay_minutes: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          name?: string
          trigger?: string
          action?: string
          enabled?: boolean
          is_active?: boolean
          delay?: string | null
          delay_minutes?: number
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      client_upload_tokens: {
        Row: {
          id: string
          workspace_id: string
          case_id: string
          client_id: string
          token: string
          expires_at: string
          is_used: boolean
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          case_id: string
          client_id: string
          token: string
          expires_at: string
          is_used?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          case_id?: string
          client_id?: string
          token?: string
          expires_at?: string
          is_used?: boolean
          created_at?: string
        }
        Relationships: []
      }
      whatsapp_messages: {
        Row: {
          id: string
          workspace_id: string
          case_id: string | null
          client_id: string | null
          direction: string
          phone_number: string
          message_type: string
          content: string
          status: string
          wa_message_id: string | null
          template_name: string | null
          error_message: string | null
          metadata: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          case_id?: string | null
          client_id?: string | null
          direction: string
          phone_number: string
          message_type: string
          content: string
          status?: string
          wa_message_id?: string | null
          template_name?: string | null
          error_message?: string | null
          metadata?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          case_id?: string | null
          client_id?: string | null
          direction?: string
          phone_number?: string
          message_type?: string
          content?: string
          status?: string
          wa_message_id?: string | null
          template_name?: string | null
          error_message?: string | null
          metadata?: Json | null
          created_at?: string
        }
        Relationships: []
      }
      signature_requests: {
        Row: {
          id: string
          workspace_id: string
          client_id: string
          title: string
          description: string | null
          status: string
          public_token: string
          document_file_name: string
          document_storage_path: string
          document_file_type: string
          document_file_size: number
          canvas_width: number | null
          signed_at: string | null
          signed_ip: string | null
          signed_document_path: string | null
          expires_at: string | null
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          client_id: string
          title: string
          description?: string | null
          status: string
          public_token: string
          document_file_name: string
          document_storage_path: string
          document_file_type: string
          document_file_size: number
          canvas_width?: number | null
          signed_at?: string | null
          signed_ip?: string | null
          signed_document_path?: string | null
          expires_at?: string | null
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          client_id?: string
          title?: string
          description?: string | null
          status?: string
          public_token?: string
          document_file_name?: string
          document_storage_path?: string
          document_file_type?: string
          document_file_size?: number
          canvas_width?: number | null
          signed_at?: string | null
          signed_ip?: string | null
          signed_document_path?: string | null
          expires_at?: string | null
          created_by?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      signature_fields: {
        Row: {
          id: string
          request_id: string
          type: string
          label: string
          page: number
          x: number
          y: number
          width: number
          height: number
          required: boolean
          value: string | null
          sort_order: number
          doc_index: number
          created_at: string
        }
        Insert: {
          id?: string
          request_id: string
          type: string
          label: string
          page: number
          x: number
          y: number
          width: number
          height: number
          required?: boolean
          value?: string | null
          sort_order?: number
          doc_index?: number
          created_at?: string
        }
        Update: {
          id?: string
          request_id?: string
          type?: string
          label?: string
          page?: number
          x?: number
          y?: number
          width?: number
          height?: number
          required?: boolean
          value?: string | null
          sort_order?: number
          doc_index?: number
          created_at?: string
        }
        Relationships: []
      }
      signature_documents: {
        Row: {
          id: string
          request_id: string
          file_name: string
          storage_path: string
          file_type: string
          file_size: number
          sort_order: number
          signed_storage_path: string | null
          created_at: string
        }
        Insert: {
          id?: string
          request_id: string
          file_name: string
          storage_path: string
          file_type: string
          file_size: number
          sort_order?: number
          signed_storage_path?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          request_id?: string
          file_name?: string
          storage_path?: string
          file_type?: string
          file_size?: number
          sort_order?: number
          signed_storage_path?: string | null
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      send_whatsapp_document_request: {
        Args: {
          p_workspace_id: string
          p_case_id: string
          p_client_id: string
          p_phone_number: string
          p_language?: string
          p_upload_url?: string
          p_pending_count?: number
          p_case_title?: string
        }
        Returns: Record<string, unknown>
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
