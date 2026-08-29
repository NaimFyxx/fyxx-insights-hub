export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      activations: {
        Row: {
          created_at: string;
          date: string;
          id: string;
          notes: string | null;
          status: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          date: string;
          id?: string;
          notes?: string | null;
          status?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          date?: string;
          id?: string;
          notes?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      cancelled_orders: {
        Row: {
          cancelled_at: string;
          created_at: string;
          order_id: string;
        };
        Insert: {
          cancelled_at: string;
          created_at?: string;
          order_id: string;
        };
        Update: {
          cancelled_at?: string;
          created_at?: string;
          order_id?: string;
        };
        Relationships: [];
      };
      klaviyo_attributed_orders: {
        Row: {
          created_at: string;
          date: string;
          id: string;
          order_id: string;
          revenue_jod: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          date: string;
          id?: string;
          order_id: string;
          revenue_jod?: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          date?: string;
          id?: string;
          order_id?: string;
          revenue_jod?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      klaviyo_attributed_daily: {
        Row: {
          created_at: string;
          date: string;
          id: string;
          orders: number;
          revenue_jod: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          date: string;
          id?: string;
          orders?: number;
          revenue_jod?: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          date?: string;
          id?: string;
          orders?: number;
          revenue_jod?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      klaviyo_campaigns: {
        Row: {
          campaign_id: string;
          campaign_message_id: string;
          click_rate: number;
          clicked: number;
          conversion_rate: number;
          created_at: string;
          delivered: number;
          id: string;
          name: string;
          open_rate: number;
          opened: number;
          orders: number;
          revenue_jod: number;
          send_channel: string;
          sent: number;
          sent_on: string;
          updated_at: string;
        };
        Insert: {
          campaign_id: string;
          campaign_message_id: string;
          click_rate?: number;
          clicked?: number;
          conversion_rate?: number;
          created_at?: string;
          delivered?: number;
          id?: string;
          name: string;
          open_rate?: number;
          opened?: number;
          orders?: number;
          revenue_jod?: number;
          send_channel?: string;
          sent?: number;
          sent_on: string;
          updated_at?: string;
        };
        Update: {
          campaign_id?: string;
          campaign_message_id?: string;
          click_rate?: number;
          clicked?: number;
          conversion_rate?: number;
          created_at?: string;
          delivered?: number;
          id?: string;
          name?: string;
          open_rate?: number;
          opened?: number;
          orders?: number;
          revenue_jod?: number;
          send_channel?: string;
          sent?: number;
          sent_on?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      klaviyo_flows: {
        Row: {
          click_rate: number;
          clicked: number;
          conversion_rate: number;
          conversions: number;
          created_at: string;
          date: string;
          delivered: number;
          flow_id: string;
          flow_message_id: string;
          flow_name: string;
          id: string;
          open_rate: number;
          opened: number;
          recipients: number;
          revenue_jod: number;
          send_channel: string;
          updated_at: string;
        };
        Insert: {
          click_rate?: number;
          clicked?: number;
          conversion_rate?: number;
          conversions?: number;
          created_at?: string;
          date: string;
          delivered?: number;
          flow_id: string;
          flow_message_id: string;
          flow_name: string;
          id?: string;
          open_rate?: number;
          opened?: number;
          recipients?: number;
          revenue_jod?: number;
          send_channel?: string;
          updated_at?: string;
        };
        Update: {
          click_rate?: number;
          clicked?: number;
          conversion_rate?: number;
          conversions?: number;
          created_at?: string;
          date?: string;
          delivered?: number;
          flow_id?: string;
          flow_message_id?: string;
          flow_name?: string;
          id?: string;
          open_rate?: number;
          opened?: number;
          recipients?: number;
          revenue_jod?: number;
          send_channel?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      klaviyo_order_influence: {
        Row: {
          created_at: string;
          date: string;
          hours_since_click: number | null;
          id: string;
          order_id: string;
          ordered_at: string;
          revenue_jod: number;
          sub_channel: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          date: string;
          hours_since_click?: number | null;
          id?: string;
          order_id: string;
          ordered_at: string;
          revenue_jod?: number;
          sub_channel: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          date?: string;
          hours_since_click?: number | null;
          id?: string;
          order_id?: string;
          ordered_at?: string;
          revenue_jod?: number;
          sub_channel?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      klaviyo_push: {
        Row: {
          conversions: number;
          created_at: string;
          delivered: number;
          id: string;
          message_id: string;
          open_rate: number;
          opened: number;
          revenue_jod: number;
          sent: number;
          sent_on: string;
          source_id: string;
          source_name: string;
          source_type: string;
          updated_at: string;
        };
        Insert: {
          conversions?: number;
          created_at?: string;
          delivered?: number;
          id?: string;
          message_id: string;
          open_rate?: number;
          opened?: number;
          revenue_jod?: number;
          sent?: number;
          sent_on: string;
          source_id: string;
          source_name: string;
          source_type?: string;
          updated_at?: string;
        };
        Update: {
          conversions?: number;
          created_at?: string;
          delivered?: number;
          id?: string;
          message_id?: string;
          open_rate?: number;
          opened?: number;
          revenue_jod?: number;
          sent?: number;
          sent_on?: string;
          source_id?: string;
          source_name?: string;
          source_type?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      klaviyo_reach_daily: {
        Row: {
          channel: string;
          created_at: string;
          date: string;
          event_count: number;
          id: string;
          profile_count: number;
          profile_hashes: number[];
          source: string;
          updated_at: string;
        };
        Insert: {
          channel: string;
          created_at?: string;
          date: string;
          event_count?: number;
          id?: string;
          profile_count?: number;
          profile_hashes?: number[];
          source: string;
          updated_at?: string;
        };
        Update: {
          channel?: string;
          created_at?: string;
          date?: string;
          event_count?: number;
          id?: string;
          profile_count?: number;
          profile_hashes?: number[];
          source?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      ll_snapshots: {
        Row: {
          birthday_rewards_issued: number;
          blue_members: number;
          created_at: string;
          gold_members: number;
          id: string;
          platinum_members: number;
          points_earned: number | null;
          points_earned_reversed: number | null;
          points_expired: number | null;
          points_outstanding: number;
          points_outstanding_start: number | null;
          points_redeemed: number | null;
          points_redeemed_reimbursed: number | null;
          points_source: string;
          redemption_rate: number;
          redemptions: number;
          silver_members: number;
          snapshot_date: string;
          updated_at: string;
        };
        Insert: {
          birthday_rewards_issued?: number;
          blue_members?: number;
          created_at?: string;
          gold_members?: number;
          id?: string;
          platinum_members?: number;
          points_earned?: number | null;
          points_earned_reversed?: number | null;
          points_expired?: number | null;
          points_outstanding?: number;
          points_outstanding_start?: number | null;
          points_redeemed?: number | null;
          points_redeemed_reimbursed?: number | null;
          points_source?: string;
          redemption_rate?: number;
          redemptions?: number;
          silver_members?: number;
          snapshot_date: string;
          updated_at?: string;
        };
        Update: {
          birthday_rewards_issued?: number;
          blue_members?: number;
          created_at?: string;
          gold_members?: number;
          id?: string;
          platinum_members?: number;
          points_earned?: number | null;
          points_earned_reversed?: number | null;
          points_expired?: number | null;
          points_outstanding?: number;
          points_outstanding_start?: number | null;
          points_redeemed?: number | null;
          points_redeemed_reimbursed?: number | null;
          points_source?: string;
          redemption_rate?: number;
          redemptions?: number;
          silver_members?: number;
          snapshot_date?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      reports: {
        Row: {
          created_at: string;
          created_by: string | null;
          end_date: string;
          id: string;
          month_highlight: string;
          next_month_bullets: string[];
          start_date: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          end_date: string;
          id?: string;
          month_highlight: string;
          next_month_bullets?: string[];
          start_date: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          end_date?: string;
          id?: string;
          month_highlight?: string;
          next_month_bullets?: string[];
          start_date?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      shopify_daily_sales: {
        Row: {
          channel: string;
          created_at: string;
          date: string;
          id: string;
          klaviyo_attributed_revenue_jod: number;
          orders: number;
          people_reached: number;
          source_name: string;
          sub_channel: string;
          top_order_values: number[];
          total_online_revenue_jod: number;
          updated_at: string;
        };
        Insert: {
          channel?: string;
          created_at?: string;
          date: string;
          id?: string;
          klaviyo_attributed_revenue_jod?: number;
          orders?: number;
          people_reached?: number;
          source_name?: string;
          sub_channel?: string;
          top_order_values?: number[];
          total_online_revenue_jod?: number;
          updated_at?: string;
        };
        Update: {
          channel?: string;
          created_at?: string;
          date?: string;
          id?: string;
          klaviyo_attributed_revenue_jod?: number;
          orders?: number;
          people_reached?: number;
          source_name?: string;
          sub_channel?: string;
          top_order_values?: number[];
          total_online_revenue_jod?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      shopify_margin_monthly: {
        Row: {
          created_at: string;
          gross_profit_jod: number;
          id: string;
          month: string;
          net_sales_jod: number;
          source_channels: string[];
          sub_channel: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          gross_profit_jod?: number;
          id?: string;
          month: string;
          net_sales_jod?: number;
          source_channels?: string[];
          sub_channel: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          gross_profit_jod?: number;
          id?: string;
          month?: string;
          net_sales_jod?: number;
          source_channels?: string[];
          sub_channel?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      sync_log: {
        Row: {
          created_at: string;
          duration_ms: number | null;
          id: string;
          message: string | null;
          range_end: string | null;
          range_start: string | null;
          rows_written: number;
          source: string;
          status: string;
          synced_at: string;
        };
        Insert: {
          created_at?: string;
          duration_ms?: number | null;
          id?: string;
          message?: string | null;
          range_end?: string | null;
          range_start?: string | null;
          rows_written?: number;
          source: string;
          status?: string;
          synced_at?: string;
        };
        Update: {
          created_at?: string;
          duration_ms?: number | null;
          id?: string;
          message?: string | null;
          range_end?: string | null;
          range_start?: string | null;
          rows_written?: number;
          source?: string;
          status?: string;
          synced_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      data_coverage: {
        Row: {
          source: string | null;
          kind: string | null;
          rows: number | null;
          covers_from: string | null;
          covers_to: string | null;
        };
        Relationships: [];
      };
      klaviyo_order_influence_net: {
        Row: {
          created_at: string | null;
          date: string | null;
          hours_since_click: number | null;
          id: string | null;
          order_id: string | null;
          ordered_at: string | null;
          revenue_jod: number | null;
          sub_channel: string | null;
          updated_at: string | null;
        };
        Relationships: [];
      };
      klaviyo_attributed_daily_net: {
        Row: {
          date: string | null;
          orders: number | null;
          revenue_jod: number | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      klaviyo_reach_counts: {
        Args: { p_from: string; p_to: string };
        Returns: {
          email_campaigns: number;
          email_flows: number;
          flows_all: number;
          push_all: number;
          total_sends: number;
          total_unique: number;
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
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
