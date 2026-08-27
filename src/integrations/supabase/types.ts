export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      activations: {
        Row: {
          created_at: string
          date: string
          id: string
          notes: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          notes?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          notes?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      klaviyo_campaigns: {
        Row: {
          clicked: number
          created_at: string
          id: string
          name: string
          opened: number
          orders: number
          revenue_jod: number
          sent: number
          sent_on: string
          updated_at: string
        }
        Insert: {
          clicked?: number
          created_at?: string
          id?: string
          name: string
          opened?: number
          orders?: number
          revenue_jod?: number
          sent?: number
          sent_on: string
          updated_at?: string
        }
        Update: {
          clicked?: number
          created_at?: string
          id?: string
          name?: string
          opened?: number
          orders?: number
          revenue_jod?: number
          sent?: number
          sent_on?: string
          updated_at?: string
        }
        Relationships: []
      }
      klaviyo_flows: {
        Row: {
          conversions: number
          created_at: string
          date: string
          flow_name: string
          id: string
          opened: number
          recipients: number
          revenue_jod: number
          updated_at: string
        }
        Insert: {
          conversions?: number
          created_at?: string
          date: string
          flow_name: string
          id?: string
          opened?: number
          recipients?: number
          revenue_jod?: number
          updated_at?: string
        }
        Update: {
          conversions?: number
          created_at?: string
          date?: string
          flow_name?: string
          id?: string
          opened?: number
          recipients?: number
          revenue_jod?: number
          updated_at?: string
        }
        Relationships: []
      }
      klaviyo_push: {
        Row: {
          created_at: string
          id: string
          opened: number
          sent: number
          sent_on: string
          source_name: string
          source_type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          opened?: number
          sent?: number
          sent_on: string
          source_name: string
          source_type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          opened?: number
          sent?: number
          sent_on?: string
          source_name?: string
          source_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      ll_snapshots: {
        Row: {
          birthday_rewards_issued: number
          blue_members: number
          created_at: string
          gold_members: number
          id: string
          platinum_members: number
          points_outstanding: number
          redemption_rate: number
          silver_members: number
          snapshot_date: string
          updated_at: string
        }
        Insert: {
          birthday_rewards_issued?: number
          blue_members?: number
          created_at?: string
          gold_members?: number
          id?: string
          platinum_members?: number
          points_outstanding?: number
          redemption_rate?: number
          silver_members?: number
          snapshot_date: string
          updated_at?: string
        }
        Update: {
          birthday_rewards_issued?: number
          blue_members?: number
          created_at?: string
          gold_members?: number
          id?: string
          platinum_members?: number
          points_outstanding?: number
          redemption_rate?: number
          silver_members?: number
          snapshot_date?: string
          updated_at?: string
        }
        Relationships: []
      }
      reports: {
        Row: {
          created_at: string
          created_by: string | null
          end_date: string
          id: string
          month_highlight: string
          next_month_bullets: string[]
          start_date: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          end_date: string
          id?: string
          month_highlight: string
          next_month_bullets?: string[]
          start_date: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          end_date?: string
          id?: string
          month_highlight?: string
          next_month_bullets?: string[]
          start_date?: string
          updated_at?: string
        }
        Relationships: []
      }
      shopify_daily_sales: {
        Row: {
          created_at: string
          date: string
          id: string
          klaviyo_attributed_revenue_jod: number
          orders: number
          people_reached: number
          total_online_revenue_jod: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          date: string
          id?: string
          klaviyo_attributed_revenue_jod?: number
          orders?: number
          people_reached?: number
          total_online_revenue_jod?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          klaviyo_attributed_revenue_jod?: number
          orders?: number
          people_reached?: number
          total_online_revenue_jod?: number
          updated_at?: string
        }
        Relationships: []
      }
      sync_log: {
        Row: {
          created_at: string
          id: string
          message: string | null
          source: string
          status: string
          synced_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          message?: string | null
          source: string
          status?: string
          synced_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string | null
          source?: string
          status?: string
          synced_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
