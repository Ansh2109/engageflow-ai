export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type AutomationType = "COMMENT_TO_DM" | "DM_KEYWORD";
export type AutomationStatus = "DRAFT" | "ACTIVE" | "PAUSED";
export type AutomationLifecycleAction = "ACTIVATE" | "PAUSE" | "RESUME";
export type AutomationLifecycleEventAction =
  | "CREATED"
  | "BASELINE"
  | "ACTIVATED"
  | "PAUSED"
  | "RESUMED"
  | "STATUS_CHANGED";
export type TriggerType = "COMMENT_KEYWORD" | "DM_KEYWORD";
export type MatchType = "EXACT" | "CONTAINS";
export type ActionType = "SEND_DM" | "REPLY_COMMENT" | "SEND_DM_AND_REPLY_COMMENT";
export type AccountType = "BUSINESS" | "CREATOR" | "UNKNOWN";
export type ConnectionStatus = "CONNECTED" | "EXPIRED" | "REVOKED" | "DISCONNECTED";
export type ProcessingStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "DUPLICATE"
  | "IGNORED";
export type ActivityLogStatus =
  | "RECEIVED"
  | "PROCESSING"
  | "MATCHED"
  | "SENT"
  | "FAILED"
  | "SKIPPED";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string | null;
          email: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name?: string | null;
          email?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string | null;
          email?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey";
            columns: ["id"];
            isOneToOne: true;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      instagram_accounts: {
        Row: {
          id: string;
          owner_id: string;
          connection_id: string | null;
          unified_connection_id: string | null;
          instagram_business_id: string;
          facebook_page_id: string | null;
          username: string;
          name: string | null;
          profile_picture_url: string | null;
          account_type: AccountType;
          connection_status: ConnectionStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          connection_id?: string | null;
          unified_connection_id?: string | null;
          instagram_business_id: string;
          facebook_page_id?: string | null;
          username: string;
          name?: string | null;
          profile_picture_url?: string | null;
          account_type?: AccountType;
          connection_status?: ConnectionStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          connection_id?: string | null;
          unified_connection_id?: string | null;
          instagram_business_id?: string;
          facebook_page_id?: string | null;
          username?: string;
          name?: string | null;
          profile_picture_url?: string | null;
          account_type?: AccountType;
          connection_status?: ConnectionStatus;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "instagram_accounts_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fk_instagram_accounts_connection_owner";
            columns: ["connection_id", "owner_id"];
            isOneToOne: false;
            referencedRelation: "instagram_business_connections";
            referencedColumns: ["id", "owner_id"];
          },
          {
            foreignKeyName: "fk_instagram_accounts_unified_connection_owner";
            columns: ["unified_connection_id", "owner_id"];
            isOneToOne: false;
            referencedRelation: "instagram_unified_login_connections";
            referencedColumns: ["id", "owner_id"];
          },
        ];
      };
      instagram_business_connections: {
        Row: {
          id: string;
          owner_id: string;
          login_type: "UNIFIED_LOGIN" | "INSTAGRAM_LOGIN";
          instagram_user_id: string | null;
          client_business_id: string | null;
          system_user_id: string | null;
          config_id: string | null;
          encrypted_access_token: string;
          token_expires_at: string | null;
          scopes: string[];
          connection_status: "CONNECTED" | "EXPIRED" | "REVOKED";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          login_type?: "UNIFIED_LOGIN" | "INSTAGRAM_LOGIN";
          instagram_user_id?: string | null;
          client_business_id?: string | null;
          system_user_id?: string | null;
          config_id?: string | null;
          encrypted_access_token: string;
          token_expires_at?: string | null;
          scopes?: string[];
          connection_status?: "CONNECTED" | "EXPIRED" | "REVOKED";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          login_type?: "UNIFIED_LOGIN" | "INSTAGRAM_LOGIN";
          instagram_user_id?: string | null;
          client_business_id?: string | null;
          system_user_id?: string | null;
          config_id?: string | null;
          encrypted_access_token?: string;
          token_expires_at?: string | null;
          scopes?: string[];
          connection_status?: "CONNECTED" | "EXPIRED" | "REVOKED";
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "instagram_business_connections_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      instagram_unified_login_connections: {
        Row: {
          id: string;
          owner_id: string;
          client_business_id: string;
          system_user_id: string;
          config_id: string;
          encrypted_access_token: string;
          token_expires_at: string | null;
          scopes: string[];
          connection_status: "CONNECTED" | "EXPIRED" | "REVOKED";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          client_business_id: string;
          system_user_id: string;
          config_id: string;
          encrypted_access_token: string;
          token_expires_at?: string | null;
          scopes?: string[];
          connection_status?: "CONNECTED" | "EXPIRED" | "REVOKED";
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          client_business_id?: string;
          system_user_id?: string;
          config_id?: string;
          encrypted_access_token?: string;
          token_expires_at?: string | null;
          scopes?: string[];
          connection_status?: "CONNECTED" | "EXPIRED" | "REVOKED";
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "instagram_unified_login_connections_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      instagram_account_tokens: {
        Row: {
          id: string;
          instagram_account_id: string;
          owner_id: string;
          encrypted_access_token: string;
          token_type: string;
          token_expires_at: string | null;
          scopes: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          instagram_account_id: string;
          owner_id: string;
          encrypted_access_token: string;
          token_type?: string;
          token_expires_at?: string | null;
          scopes?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          instagram_account_id?: string;
          owner_id?: string;
          encrypted_access_token?: string;
          token_type?: string;
          token_expires_at?: string | null;
          scopes?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "instagram_account_tokens_instagram_account_id_fkey";
            columns: ["instagram_account_id"];
            isOneToOne: true;
            referencedRelation: "instagram_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "instagram_account_tokens_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fk_account_tokens_owner";
            columns: ["instagram_account_id", "owner_id"];
            isOneToOne: true;
            referencedRelation: "instagram_accounts";
            referencedColumns: ["id", "owner_id"];
          },
        ];
      };
      automations: {
        Row: {
          id: string;
          owner_id: string;
          instagram_account_id: string;
          name: string;
          automation_type: AutomationType;
          status: AutomationStatus;
          target_post_id: string | null;
          target_post_url: string | null;
          target_media_type: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          instagram_account_id: string;
          name: string;
          automation_type: AutomationType;
          status?: AutomationStatus;
          target_post_id?: string | null;
          target_post_url?: string | null;
          target_media_type?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          instagram_account_id?: string;
          name?: string;
          automation_type?: AutomationType;
          status?: AutomationStatus;
          target_post_id?: string | null;
          target_post_url?: string | null;
          target_media_type?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "automations_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "automations_instagram_account_id_fkey";
            columns: ["instagram_account_id"];
            isOneToOne: false;
            referencedRelation: "instagram_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fk_automations_account_ownership";
            columns: ["instagram_account_id", "owner_id"];
            isOneToOne: false;
            referencedRelation: "instagram_accounts";
            referencedColumns: ["id", "owner_id"];
          },
        ];
      };
      automation_triggers: {
        Row: {
          id: string;
          automation_id: string;
          trigger_type: TriggerType;
          keyword: string;
          match_type: MatchType;
          created_at: string;
        };
        Insert: {
          id?: string;
          automation_id: string;
          trigger_type: TriggerType;
          keyword: string;
          match_type?: MatchType;
          created_at?: string;
        };
        Update: {
          id?: string;
          automation_id?: string;
          trigger_type?: TriggerType;
          keyword?: string;
          match_type?: MatchType;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "automation_triggers_automation_id_fkey";
            columns: ["automation_id"];
            isOneToOne: false;
            referencedRelation: "automations";
            referencedColumns: ["id"];
          },
        ];
      };
      automation_actions: {
        Row: {
          id: string;
          automation_id: string;
          action_type: ActionType;
          message_text: string;
          public_comment_reply_text: string | null;
          public_reply_enabled: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          automation_id: string;
          action_type: ActionType;
          message_text: string;
          public_comment_reply_text?: string | null;
          public_reply_enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          automation_id?: string;
          action_type?: ActionType;
          message_text?: string;
          public_comment_reply_text?: string | null;
          public_reply_enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "automation_actions_automation_id_fkey";
            columns: ["automation_id"];
            isOneToOne: false;
            referencedRelation: "automations";
            referencedColumns: ["id"];
          },
        ];
      };
      webhook_events: {
        Row: {
          id: string;
          instagram_account_id: string | null;
          external_event_id: string;
          event_type: string;
          event_payload: Json;
          processing_status: ProcessingStatus;
          attempts: number;
          error_message: string | null;
          received_at: string;
          processed_at: string | null;
        };
        Insert: {
          id?: string;
          instagram_account_id?: string | null;
          external_event_id: string;
          event_type: string;
          event_payload: Json;
          processing_status?: ProcessingStatus;
          attempts?: number;
          error_message?: string | null;
          received_at?: string;
          processed_at?: string | null;
        };
        Update: {
          id?: string;
          instagram_account_id?: string | null;
          external_event_id?: string;
          event_type?: string;
          event_payload?: Json;
          processing_status?: ProcessingStatus;
          attempts?: number;
          error_message?: string | null;
          received_at?: string;
          processed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "webhook_events_instagram_account_id_fkey";
            columns: ["instagram_account_id"];
            isOneToOne: false;
            referencedRelation: "instagram_accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      activity_logs: {
        Row: {
          id: string;
          owner_id: string;
          instagram_account_id: string | null;
          automation_id: string | null;
          webhook_event_id: string | null;
          event_type: string;
          action_type: string;
          status: ActivityLogStatus;
          trigger_keyword: string | null;
          recipient_id: string | null;
          error_code: string | null;
          error_message: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          instagram_account_id?: string | null;
          automation_id?: string | null;
          webhook_event_id?: string | null;
          event_type: string;
          action_type: string;
          status: ActivityLogStatus;
          trigger_keyword?: string | null;
          recipient_id?: string | null;
          error_code?: string | null;
          error_message?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          owner_id?: string;
          instagram_account_id?: string | null;
          automation_id?: string | null;
          webhook_event_id?: string | null;
          event_type?: string;
          action_type?: string;
          status?: ActivityLogStatus;
          trigger_keyword?: string | null;
          recipient_id?: string | null;
          error_code?: string | null;
          error_message?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "activity_logs_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fk_activity_logs_account_ownership";
            columns: ["instagram_account_id", "owner_id"];
            isOneToOne: false;
            referencedRelation: "instagram_accounts";
            referencedColumns: ["id", "owner_id"];
          },
          {
            foreignKeyName: "fk_activity_logs_automation_ownership";
            columns: ["automation_id", "owner_id"];
            isOneToOne: false;
            referencedRelation: "automations";
            referencedColumns: ["id", "owner_id"];
          },
          {
            foreignKeyName: "activity_logs_webhook_event_id_fkey";
            columns: ["webhook_event_id"];
            isOneToOne: false;
            referencedRelation: "webhook_events";
            referencedColumns: ["id"];
          },
        ];
      };
      automation_runtime_readiness: {
        Row: {
          singleton: boolean;
          webhook_verified: boolean;
          event_ingestion_operational: boolean;
          event_processor_operational: boolean;
          message_executor_operational: boolean;
          retry_policy_verified: boolean;
          idempotency_verified: boolean;
          last_verified_at: string | null;
          updated_at: string;
        };
        Insert: {
          singleton?: boolean;
          webhook_verified?: boolean;
          event_ingestion_operational?: boolean;
          event_processor_operational?: boolean;
          message_executor_operational?: boolean;
          retry_policy_verified?: boolean;
          idempotency_verified?: boolean;
          last_verified_at?: string | null;
          updated_at?: string;
        };
        Update: {
          singleton?: boolean;
          webhook_verified?: boolean;
          event_ingestion_operational?: boolean;
          event_processor_operational?: boolean;
          message_executor_operational?: boolean;
          retry_policy_verified?: boolean;
          idempotency_verified?: boolean;
          last_verified_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      automation_media_validations: {
        Row: {
          automation_id: string;
          owner_id: string;
          instagram_account_id: string;
          media_id: string;
          media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
          is_valid: boolean;
          verified_at: string;
          valid_until: string;
        };
        Insert: {
          automation_id: string;
          owner_id: string;
          instagram_account_id: string;
          media_id: string;
          media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
          is_valid: boolean;
          verified_at: string;
          valid_until: string;
        };
        Update: {
          automation_id?: string;
          owner_id?: string;
          instagram_account_id?: string;
          media_id?: string;
          media_type?: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
          is_valid?: boolean;
          verified_at?: string;
          valid_until?: string;
        };
        Relationships: [
          {
            foreignKeyName: "automation_media_validation_automation_owner_fkey";
            columns: ["automation_id", "owner_id"];
            isOneToOne: true;
            referencedRelation: "automations";
            referencedColumns: ["id", "owner_id"];
          },
          {
            foreignKeyName: "automation_media_validation_account_owner_fkey";
            columns: ["instagram_account_id", "owner_id"];
            isOneToOne: false;
            referencedRelation: "instagram_accounts";
            referencedColumns: ["id", "owner_id"];
          },
        ];
      };
      automation_lifecycle_events: {
        Row: {
          id: string;
          automation_id: string;
          owner_id: string;
          previous_status: AutomationStatus | null;
          new_status: AutomationStatus;
          action: AutomationLifecycleEventAction;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          automation_id: string;
          owner_id: string;
          previous_status?: AutomationStatus | null;
          new_status: AutomationStatus;
          action: AutomationLifecycleEventAction;
          metadata?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          automation_id?: string;
          owner_id?: string;
          previous_status?: AutomationStatus | null;
          new_status?: AutomationStatus;
          action?: AutomationLifecycleEventAction;
          metadata?: Json;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "automation_lifecycle_events_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      automation_lifecycle_transition_permits: {
        Row: {
          transaction_id: number;
          automation_id: string;
          owner_id: string;
          previous_status: AutomationStatus;
          target_status: Exclude<AutomationStatus, "DRAFT">;
          action: AutomationLifecycleAction;
        };
        Insert: {
          transaction_id: number;
          automation_id: string;
          owner_id: string;
          previous_status: AutomationStatus;
          target_status: Exclude<AutomationStatus, "DRAFT">;
          action: AutomationLifecycleAction;
        };
        Update: {
          transaction_id?: number;
          automation_id?: string;
          owner_id?: string;
          previous_status?: AutomationStatus;
          target_status?: Exclude<AutomationStatus, "DRAFT">;
          action?: AutomationLifecycleAction;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      create_instagram_oauth_state: {
        Args: {
          p_nonce_hash: string;
          p_user_id: string;
          p_issued_at: string;
          p_expires_at: string;
        };
        Returns: undefined;
      };
      consume_instagram_oauth_state: {
        Args: {
          p_nonce_hash: string;
          p_user_id: string;
          p_issued_at: string;
          p_expires_at: string;
        };
        Returns: boolean;
      };
      persist_instagram_business_connection: {
        Args: {
          p_owner_id: string;
          p_client_business_id: string;
          p_system_user_id: string;
          p_config_id: string;
          p_encrypted_access_token: string;
          p_token_expires_at: string | null;
          p_scopes: string[];
          p_accounts: Json;
        };
        Returns: string;
      };
      persist_instagram_login_connection: {
        Args: {
          p_owner_id: string;
          p_instagram_user_id: string;
          p_username: string;
          p_name: string | null;
          p_profile_picture_url: string | null;
          p_account_type: AccountType;
          p_encrypted_access_token: string;
          p_token_expires_at: string;
          p_scopes: string[];
        };
        Returns: string;
      };
      persist_instagram_unified_login_connection: {
        Args: {
          p_owner_id: string;
          p_client_business_id: string;
          p_system_user_id: string;
          p_config_id: string;
          p_encrypted_access_token: string;
          p_token_expires_at: string | null;
          p_scopes: string[];
          p_accounts: Json;
        };
        Returns: string;
      };
      save_comment_to_dm_draft: {
        Args: {
          p_automation_id: string | null;
          p_instagram_account_id: string;
          p_name: string;
          p_media_id: string;
          p_media_type: string;
          p_match_type: string;
          p_keywords: string[];
          p_message_text: string;
          p_public_reply_enabled: boolean;
          p_public_comment_reply_text: string | null;
        };
        Returns: string;
      };
      get_automation_execution_readiness: {
        Args: { p_automation_id: string | null };
        Returns: {
          automation_id: string;
          ready: boolean;
          blockers: string[];
        }[];
      };
      transition_automation_lifecycle: {
        Args: {
          p_automation_id: string;
          p_action: AutomationLifecycleAction;
        };
        Returns: {
          status: AutomationStatus;
          updated_at: string;
        }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
}
