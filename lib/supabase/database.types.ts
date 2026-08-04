// lib/supabase/database.types.ts
// ============================================================================
// Tipos del esquema de Postgres.
//
// Mantiene el formato que emite `supabase gen types typescript`, de modo que
// puede regenerarse con ese comando sin romper nada:
//
//   supabase gen types typescript --project-id <ref> > lib/supabase/database.types.ts
//
// POR QUÉ IMPORTA: sin esto, `db.from("campaigns").update({ … })` acepta
// cualquier objeto y los errores de nombre de columna sólo aparecen en
// producción como PGRST204. Con estos tipos, escribir `follow_up_days` en
// lugar de `followup_delay_days` es un error de compilación.
//
// Fuente de verdad: supabase/migrations/0001…0005.
// ============================================================================

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

// ── Enumerados de dominio ───────────────────────────────────────────────────
export type LeadStatus =
  | "pending"
  | "researching"
  | "research_failed"
  | "ready_to_send"
  | "sent"
  | "replied"
  | "interested"
  | "not_interested"
  | "out_of_scope"
  | "meeting_booked";

export type CampaignStatus = "active" | "paused" | "archived";

export type ReplyClassification = "interested" | "not_interested" | "out_of_scope" | "unclear";

export type AccountPlan = "trial" | "free" | "pro" | "agency";

export type PaidPlan = "free" | "pro" | "agency";

export type BillingCycleValue = "monthly" | "annual";

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "unpaid"
  | "paused";

export type WebhookProvider = "stripe" | "resend";

export type WebhookStatus = "processing" | "processed" | "failed" | "ignored";

export type ReviewReason = "orphaned_reply" | "suspicious_content" | "ai_classification_failed";

export interface Database {
  public: {
    Tables: {
      campaigns: {
        Row: {
          id: string;
          user_id: string | null;
          name: string;
          base_template: string;
          value_proposition: string;
          sender_name: string;
          sender_email: string;
          daily_send_limit: number;
          followups_enabled: boolean;
          followup_delay_days: number;
          followup_max_touches: number;
          status: CampaignStatus;
          is_demo: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          name: string;
          base_template?: string;
          value_proposition?: string;
          sender_name?: string;
          sender_email?: string;
          daily_send_limit?: number;
          followups_enabled?: boolean;
          followup_delay_days?: number;
          followup_max_touches?: number;
          status?: CampaignStatus;
          is_demo?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          name?: string;
          base_template?: string;
          value_proposition?: string;
          sender_name?: string;
          sender_email?: string;
          daily_send_limit?: number;
          followups_enabled?: boolean;
          followup_delay_days?: number;
          followup_max_touches?: number;
          status?: CampaignStatus;
          is_demo?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      onboarding_progress: {
        Row: {
          user_id: string;
          welcomed_at: string | null;
          dismissed_at: string | null;
          completed_at: string | null;
          value_proposition: string | null;
          target_audience: string | null;
          main_product: string | null;
          first_campaign_at: string | null;
          first_lead_at: string | null;
          first_research_at: string | null;
          first_draft_at: string | null;
          first_send_at: string | null;
          dismissed_tips: string[];
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          welcomed_at?: string | null;
          dismissed_at?: string | null;
          completed_at?: string | null;
          value_proposition?: string | null;
          target_audience?: string | null;
          main_product?: string | null;
          first_campaign_at?: string | null;
          first_lead_at?: string | null;
          first_research_at?: string | null;
          first_draft_at?: string | null;
          first_send_at?: string | null;
          dismissed_tips?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          welcomed_at?: string | null;
          dismissed_at?: string | null;
          completed_at?: string | null;
          value_proposition?: string | null;
          target_audience?: string | null;
          main_product?: string | null;
          first_campaign_at?: string | null;
          first_lead_at?: string | null;
          first_research_at?: string | null;
          first_draft_at?: string | null;
          first_send_at?: string | null;
          dismissed_tips?: string[];
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      onboarding_events: {
        Row: {
          id: number;
          user_id: string;
          step: string;
          elapsed_ms: number | null;
          detail: Json | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          user_id: string;
          step: string;
          elapsed_ms?: number | null;
          detail?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: number;
          user_id?: string;
          step?: string;
          elapsed_ms?: number | null;
          detail?: Json | null;
          created_at?: string;
        };
        Relationships: [];
      };

      leads: {
        Row: {
          id: string;
          campaign_id: string;
          company_name: string;
          company_url: string | null;
          contact_name: string | null;
          contact_email: string | null;
          contact_role: string | null;
          research_sector: string | null;
          research_size: string | null;
          research_pain_point: string | null;
          research_decision_maker: string | null;
          research_raw: Json | null;
          research_error: string | null;
          draft_subject: string | null;
          draft_body: string | null;
          follow_ups_sent: number;
          last_contacted_at: string | null;
          status: LeadStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          campaign_id: string;
          company_name: string;
          company_url?: string | null;
          contact_name?: string | null;
          contact_email?: string | null;
          contact_role?: string | null;
          research_sector?: string | null;
          research_size?: string | null;
          research_pain_point?: string | null;
          research_decision_maker?: string | null;
          research_raw?: Json | null;
          research_error?: string | null;
          draft_subject?: string | null;
          draft_body?: string | null;
          follow_ups_sent?: number;
          last_contacted_at?: string | null;
          status?: LeadStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          campaign_id?: string;
          company_name?: string;
          company_url?: string | null;
          contact_name?: string | null;
          contact_email?: string | null;
          contact_role?: string | null;
          research_sector?: string | null;
          research_size?: string | null;
          research_pain_point?: string | null;
          research_decision_maker?: string | null;
          research_raw?: Json | null;
          research_error?: string | null;
          draft_subject?: string | null;
          draft_body?: string | null;
          follow_ups_sent?: number;
          last_contacted_at?: string | null;
          status?: LeadStatus;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "leads_campaign_id_fkey";
            columns: ["campaign_id"];
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
        ];
      };

      emails_sent: {
        Row: {
          id: string;
          lead_id: string;
          campaign_id: string | null;
          subject: string;
          body: string;
          provider: string;
          provider_message_id: string | null;
          word_count: number | null;
          sent_at: string;
        };
        Insert: {
          id?: string;
          lead_id: string;
          campaign_id?: string | null;
          subject: string;
          body: string;
          provider?: string;
          provider_message_id?: string | null;
          word_count?: number | null;
          sent_at?: string;
        };
        Update: {
          id?: string;
          lead_id?: string;
          campaign_id?: string | null;
          subject?: string;
          body?: string;
          provider?: string;
          provider_message_id?: string | null;
          word_count?: number | null;
          sent_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "emails_sent_lead_id_fkey";
            columns: ["lead_id"];
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "emails_sent_campaign_id_fkey";
            columns: ["campaign_id"];
            referencedRelation: "campaigns";
            referencedColumns: ["id"];
          },
        ];
      };

      replies: {
        Row: {
          id: string;
          lead_id: string | null;
          email_sent_id: string | null;
          raw_body: string;
          raw_headers: Json | null;
          classification: ReplyClassification | null;
          classification_confidence: number | null;
          agent_response_draft: string | null;
          agent_response_sent: boolean | null;
          send_error: string | null;
          error_message: string | null;
          flagged_for_review: boolean | null;
          review_reason: string | null;
          processed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          lead_id?: string | null;
          email_sent_id?: string | null;
          raw_body: string;
          raw_headers?: Json | null;
          classification?: ReplyClassification | null;
          classification_confidence?: number | null;
          agent_response_draft?: string | null;
          agent_response_sent?: boolean | null;
          send_error?: string | null;
          error_message?: string | null;
          flagged_for_review?: boolean | null;
          review_reason?: string | null;
          processed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          lead_id?: string | null;
          email_sent_id?: string | null;
          raw_body?: string;
          raw_headers?: Json | null;
          classification?: ReplyClassification | null;
          classification_confidence?: number | null;
          agent_response_draft?: string | null;
          agent_response_sent?: boolean | null;
          send_error?: string | null;
          error_message?: string | null;
          flagged_for_review?: boolean | null;
          review_reason?: string | null;
          processed_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "replies_lead_id_fkey";
            columns: ["lead_id"];
            referencedRelation: "leads";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "replies_email_sent_id_fkey";
            columns: ["email_sent_id"];
            referencedRelation: "emails_sent";
            referencedColumns: ["id"];
          },
        ];
      };

      accounts: {
        Row: {
          user_id: string;
          plan: AccountPlan;
          billing_cycle: BillingCycleValue | null;
          trial_ends_at: string;
          stripe_customer_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          plan?: AccountPlan;
          billing_cycle?: BillingCycleValue | null;
          trial_ends_at?: string;
          stripe_customer_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          plan?: AccountPlan;
          billing_cycle?: BillingCycleValue | null;
          trial_ends_at?: string;
          stripe_customer_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      subscriptions: {
        Row: {
          id: string;
          user_id: string;
          stripe_customer_id: string;
          stripe_price_id: string | null;
          status: SubscriptionStatus;
          plan: PaidPlan;
          billing_cycle: BillingCycleValue;
          current_period_start: string | null;
          current_period_end: string | null;
          cancel_at_period_end: boolean;
          canceled_at: string | null;
          trial_ends_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          user_id: string;
          stripe_customer_id: string;
          stripe_price_id?: string | null;
          status: SubscriptionStatus;
          plan: PaidPlan;
          billing_cycle: BillingCycleValue;
          current_period_start?: string | null;
          current_period_end?: string | null;
          cancel_at_period_end?: boolean;
          canceled_at?: string | null;
          trial_ends_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          stripe_customer_id?: string;
          stripe_price_id?: string | null;
          status?: SubscriptionStatus;
          plan?: PaidPlan;
          billing_cycle?: BillingCycleValue;
          current_period_start?: string | null;
          current_period_end?: string | null;
          cancel_at_period_end?: boolean;
          canceled_at?: string | null;
          trial_ends_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      webhook_events: {
        Row: {
          id: string;
          provider: WebhookProvider;
          event_type: string | null;
          status: WebhookStatus;
          attempts: number;
          error_message: string | null;
          payload: Json | null;
          received_at: string;
          processed_at: string | null;
        };
        Insert: {
          id: string;
          provider: WebhookProvider;
          event_type?: string | null;
          status?: WebhookStatus;
          attempts?: number;
          error_message?: string | null;
          payload?: Json | null;
          received_at?: string;
          processed_at?: string | null;
        };
        Update: {
          id?: string;
          provider?: WebhookProvider;
          event_type?: string | null;
          status?: WebhookStatus;
          attempts?: number;
          error_message?: string | null;
          payload?: Json | null;
          received_at?: string;
          processed_at?: string | null;
        };
        Relationships: [];
      };
    };

    Views: Record<never, never>;

    Functions: {
      /** Plan efectivo + uso del mes en una sola consulta (migración 0006). */
      account_overview: {
        Args: { p_user_id: string };
        Returns: {
          plan: AccountPlan;
          billing_cycle: BillingCycleValue | null;
          trial_ends_at: string;
          stripe_customer_id: string | null;
          campaigns_count: number;
          leads_this_month: number;
          has_subscription: boolean;
        }[];
      };
      /** Estado del onboarding en una sola consulta (migración 0009). */
      onboarding_overview: {
        Args: { p_user_id: string };
        Returns: {
          welcomed_at: string | null;
          dismissed_at: string | null;
          completed_at: string | null;
          value_proposition: string | null;
          target_audience: string | null;
          main_product: string | null;
          dismissed_tips: string[] | null;
          first_campaign_at: string | null;
          first_lead_at: string | null;
          first_research_at: string | null;
          first_draft_at: string | null;
          first_send_at: string | null;
          has_real_campaign: boolean;
          has_demo_campaign: boolean;
          lead_count: number;
          researched_count: number;
          draft_count: number;
          sent_count: number;
          has_sender_domain: boolean;
        }[];
      };
      /** Embudo agregado del onboarding, para el operador. */
      onboarding_funnel: {
        Args: { p_since?: string };
        Returns: { step: string; users: number; median_elapsed_ms: number | null }[];
      };
      claim_orphan_data: {
        Args: { p_user_id: string };
        Returns: { claimed_campaigns: number }[];
      };
      claim_webhook_event: {
        Args: {
          p_id: string;
          p_provider: string;
          p_event_type?: string | null;
          p_payload?: Json | null;
        };
        Returns: boolean;
      };
      complete_webhook_event: {
        Args: { p_id: string; p_status?: string; p_error?: string | null };
        Returns: undefined;
      };
      purge_old_webhook_events: {
        Args: { p_days?: number };
        Returns: number;
      };
    };

    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}

// ── Atajos para el código de aplicación ─────────────────────────────────────
type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];
export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"];
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"];

export type CampaignRow = Tables<"campaigns">;
export type LeadRow = Tables<"leads">;
export type EmailSentRow = Tables<"emails_sent">;
export type ReplyRow = Tables<"replies">;
export type AccountTableRow = Tables<"accounts">;
export type SubscriptionRow = Tables<"subscriptions">;
export type WebhookEventRow = Tables<"webhook_events">;
