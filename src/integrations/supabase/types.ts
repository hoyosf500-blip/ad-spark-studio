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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ad_metrics: {
        Row: {
          clicks: number | null
          conversions: number | null
          created_at: string
          id: string
          impressions: number | null
          metadata: Json
          platform: string | null
          recorded_at: string
          spend_usd: number | null
          variation_id: string | null
          workspace_id: string
        }
        Insert: {
          clicks?: number | null
          conversions?: number | null
          created_at?: string
          id?: string
          impressions?: number | null
          metadata?: Json
          platform?: string | null
          recorded_at?: string
          spend_usd?: number | null
          variation_id?: string | null
          workspace_id: string
        }
        Update: {
          clicks?: number | null
          conversions?: number | null
          created_at?: string
          id?: string
          impressions?: number | null
          metadata?: Json
          platform?: string | null
          recorded_at?: string
          spend_usd?: number | null
          variation_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_metrics_variation_id_fkey"
            columns: ["variation_id"]
            isOneToOne: false
            referencedRelation: "variations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_metrics_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      api_usage: {
        Row: {
          cost_usd: number
          created_at: string
          id: string
          input_tokens: number | null
          metadata: Json
          model: string | null
          operation: string | null
          output_tokens: number | null
          provider: string
          units: number | null
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          cost_usd?: number
          created_at?: string
          id?: string
          input_tokens?: number | null
          metadata?: Json
          model?: string | null
          operation?: string | null
          output_tokens?: number | null
          provider: string
          units?: number | null
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          cost_usd?: number
          created_at?: string
          id?: string
          input_tokens?: number | null
          metadata?: Json
          model?: string | null
          operation?: string | null
          output_tokens?: number | null
          provider?: string
          units?: number | null
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_usage_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      async_tasks: {
        Row: {
          completed_at: string | null
          created_at: string
          error: string | null
          external_task_id: string | null
          id: string
          payload: Json
          related_image_id: string | null
          related_video_id: string | null
          result: Json | null
          started_at: string
          status: string
          task_type: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          external_task_id?: string | null
          id?: string
          payload?: Json
          related_image_id?: string | null
          related_video_id?: string | null
          result?: Json | null
          started_at?: string
          status?: string
          task_type: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error?: string | null
          external_task_id?: string | null
          id?: string
          payload?: Json
          related_image_id?: string | null
          related_video_id?: string | null
          result?: Json | null
          started_at?: string
          status?: string
          task_type?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "async_tasks_related_image_id_fkey"
            columns: ["related_image_id"]
            isOneToOne: false
            referencedRelation: "image_generations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "async_tasks_related_video_id_fkey"
            columns: ["related_video_id"]
            isOneToOne: false
            referencedRelation: "video_generations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "async_tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      avatars: {
        Row: {
          created_at: string
          data: Json
          description: string | null
          id: string
          image_url: string | null
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          data?: Json
          description?: string | null
          id?: string
          image_url?: string | null
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          data?: Json
          description?: string | null
          id?: string
          image_url?: string | null
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "avatars_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      image_generations: {
        Row: {
          cost_usd: number
          created_at: string
          external_url: string | null
          id: string
          prompt: string | null
          provider: string
          reference_url: string | null
          scene_id: string | null
          size: string | null
          status: string
          storage_path: string | null
          updated_at: string
          used_i2i: boolean
          user_id: string
          workspace_id: string
        }
        Insert: {
          cost_usd?: number
          created_at?: string
          external_url?: string | null
          id?: string
          prompt?: string | null
          provider?: string
          reference_url?: string | null
          scene_id?: string | null
          size?: string | null
          status?: string
          storage_path?: string | null
          updated_at?: string
          used_i2i?: boolean
          user_id: string
          workspace_id: string
        }
        Update: {
          cost_usd?: number
          created_at?: string
          external_url?: string | null
          id?: string
          prompt?: string | null
          provider?: string
          reference_url?: string | null
          scene_id?: string | null
          size?: string | null
          status?: string
          storage_path?: string | null
          updated_at?: string
          used_i2i?: boolean
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "image_generations_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "variation_scenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "image_generations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          created_at: string
          data: Json
          description: string | null
          id: string
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          data?: Json
          description?: string | null
          id?: string
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          data?: Json
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
          is_active: boolean
          is_admin: boolean
          total_cost_usd: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          is_active?: boolean
          is_admin?: boolean
          total_cost_usd?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          is_active?: boolean
          is_admin?: boolean
          total_cost_usd?: number
          updated_at?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          created_at: string
          data: Json
          id: string
          name: string
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          data?: Json
          id?: string
          name: string
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          name?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      source_videos: {
        Row: {
          analysis_text: string | null
          created_at: string
          duration_seconds: number | null
          filename: string | null
          frames: Json
          id: string
          project_id: string | null
          storage_path: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          analysis_text?: string | null
          created_at?: string
          duration_seconds?: number | null
          filename?: string | null
          frames?: Json
          id?: string
          project_id?: string | null
          storage_path?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          analysis_text?: string | null
          created_at?: string
          duration_seconds?: number | null
          filename?: string | null
          frames?: Json
          id?: string
          project_id?: string | null
          storage_path?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_videos_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_videos_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      transcriptions_library: {
        Row: {
          content: string
          created_at: string
          id: string
          language: string | null
          title: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          language?: string | null
          title?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          language?: string | null
          title?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transcriptions_library_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ugc_generations: {
        Row: {
          created_at: string
          data: Json
          id: string
          language: string | null
          model: string
          project_id: string | null
          prompt: string | null
          style: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          data?: Json
          id?: string
          language?: string | null
          model: string
          project_id?: string | null
          prompt?: string | null
          style: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          language?: string | null
          model?: string
          project_id?: string | null
          prompt?: string | null
          style?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ugc_generations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ugc_generations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      variation_scenes: {
        Row: {
          animation_prompt: string | null
          created_at: string
          generated_image_id: string | null
          generated_video_id: string | null
          id: string
          image_prompt: string | null
          reference_frame_url: string | null
          scene_index: number
          scene_text: string | null
          updated_at: string
          use_i2i: boolean
          variation_id: string
          workspace_id: string
        }
        Insert: {
          animation_prompt?: string | null
          created_at?: string
          generated_image_id?: string | null
          generated_video_id?: string | null
          id?: string
          image_prompt?: string | null
          reference_frame_url?: string | null
          scene_index: number
          scene_text?: string | null
          updated_at?: string
          use_i2i?: boolean
          variation_id: string
          workspace_id: string
        }
        Update: {
          animation_prompt?: string | null
          created_at?: string
          generated_image_id?: string | null
          generated_video_id?: string | null
          id?: string
          image_prompt?: string | null
          reference_frame_url?: string | null
          scene_index?: number
          scene_text?: string | null
          updated_at?: string
          use_i2i?: boolean
          variation_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "variation_scenes_variation_id_fkey"
            columns: ["variation_id"]
            isOneToOne: false
            referencedRelation: "variations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variation_scenes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      variations: {
        Row: {
          created_at: string
          data: Json
          id: string
          project_id: string
          script: string | null
          source_video_id: string | null
          title: string | null
          updated_at: string
          variation_type: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          data?: Json
          id?: string
          project_id: string
          script?: string | null
          source_video_id?: string | null
          title?: string | null
          updated_at?: string
          variation_type: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          project_id?: string
          script?: string | null
          source_video_id?: string | null
          title?: string | null
          updated_at?: string
          variation_type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "variations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variations_source_video_id_fkey"
            columns: ["source_video_id"]
            isOneToOne: false
            referencedRelation: "source_videos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      video_generations: {
        Row: {
          cost_usd: number
          created_at: string
          external_url: string | null
          id: string
          prompt: string | null
          provider: string
          scene_id: string | null
          size: string | null
          source_image_id: string | null
          status: string
          storage_path: string | null
          task_id: string | null
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          cost_usd?: number
          created_at?: string
          external_url?: string | null
          id?: string
          prompt?: string | null
          provider?: string
          scene_id?: string | null
          size?: string | null
          source_image_id?: string | null
          status?: string
          storage_path?: string | null
          task_id?: string | null
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          cost_usd?: number
          created_at?: string
          external_url?: string | null
          id?: string
          prompt?: string | null
          provider?: string
          scene_id?: string | null
          size?: string | null
          source_image_id?: string | null
          status?: string
          storage_path?: string | null
          task_id?: string | null
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_generations_scene_id_fkey"
            columns: ["scene_id"]
            isOneToOne: false
            referencedRelation: "variation_scenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_generations_source_image_id_fkey"
            columns: ["source_image_id"]
            isOneToOne: false
            referencedRelation: "image_generations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_generations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          id: string
          role: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_active: { Args: { _uid: string }; Returns: boolean }
      is_admin: { Args: { _uid: string }; Returns: boolean }
      is_ws_member: { Args: { _uid: string; _ws: string }; Returns: boolean }
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
