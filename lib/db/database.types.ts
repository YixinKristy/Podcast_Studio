export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      auth_login_attempts: {
        Row: {
          attempt_count: number;
          email: string;
          last_attempt_at: string | null;
          locked_until: string | null;
          window_started_at: string;
        };
        Insert: {
          attempt_count?: number;
          email: string;
          last_attempt_at?: string | null;
          locked_until?: string | null;
          window_started_at?: string;
        };
        Update: {
          attempt_count?: number;
          email?: string;
          last_attempt_at?: string | null;
          locked_until?: string | null;
          window_started_at?: string;
        };
        Relationships: [];
      };
      episodes: {
        Row: {
          audio_url: string | null;
          content_hash: string | null;
          created_at: string;
          duration_seconds: number | null;
          episode_no: number | null;
          generate_materials: Json;
          guests: Json;
          id: string;
          low_confidence: boolean;
          promote_note: string | null;
          published_at: string | null;
          show_id: string;
          source_type: Database["public"]["Enums"]["episode_source_type"];
          speaker_count: number | null;
          status: Database["public"]["Enums"]["episode_status"];
          transcript: Json | null;
        };
        Insert: {
          audio_url?: string | null;
          content_hash?: string | null;
          created_at?: string;
          duration_seconds?: number | null;
          episode_no?: number | null;
          generate_materials?: Json;
          guests?: Json;
          id?: string;
          low_confidence?: boolean;
          promote_note?: string | null;
          published_at?: string | null;
          show_id: string;
          source_type: Database["public"]["Enums"]["episode_source_type"];
          speaker_count?: number | null;
          status?: Database["public"]["Enums"]["episode_status"];
          transcript?: Json | null;
        };
        Update: {
          audio_url?: string | null;
          content_hash?: string | null;
          created_at?: string;
          duration_seconds?: number | null;
          episode_no?: number | null;
          generate_materials?: Json;
          guests?: Json;
          id?: string;
          low_confidence?: boolean;
          promote_note?: string | null;
          published_at?: string | null;
          show_id?: string;
          source_type?: Database["public"]["Enums"]["episode_source_type"];
          speaker_count?: number | null;
          status?: Database["public"]["Enums"]["episode_status"];
          transcript?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "episodes_show_id_fkey";
            columns: ["show_id"];
            isOneToOne: false;
            referencedRelation: "shows";
            referencedColumns: ["id"];
          },
        ];
      };
      material_versions: {
        Row: {
          content: Json;
          created_at: string;
          id: string;
          instruction: string | null;
          material_id: string;
          source: string;
          version: number;
        };
        Insert: {
          content: Json;
          created_at?: string;
          id?: string;
          instruction?: string | null;
          material_id: string;
          source: string;
          version: number;
        };
        Update: {
          content?: Json;
          created_at?: string;
          id?: string;
          instruction?: string | null;
          material_id?: string;
          source?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "material_versions_material_id_fkey";
            columns: ["material_id"];
            isOneToOne: false;
            referencedRelation: "materials";
            referencedColumns: ["id"];
          },
        ];
      };
      materials: {
        Row: {
          confirmed_at: string | null;
          content: Json;
          created_at: string;
          episode_id: string;
          id: string;
          status: Database["public"]["Enums"]["material_status"];
          type: Database["public"]["Enums"]["material_type"];
          updated_at: string;
          version: number;
        };
        Insert: {
          confirmed_at?: string | null;
          content?: Json;
          created_at?: string;
          episode_id: string;
          id?: string;
          status?: Database["public"]["Enums"]["material_status"];
          type: Database["public"]["Enums"]["material_type"];
          updated_at?: string;
          version?: number;
        };
        Update: {
          confirmed_at?: string | null;
          content?: Json;
          created_at?: string;
          episode_id?: string;
          id?: string;
          status?: Database["public"]["Enums"]["material_status"];
          type?: Database["public"]["Enums"]["material_type"];
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "materials_episode_id_fkey";
            columns: ["episode_id"];
            isOneToOne: false;
            referencedRelation: "episodes";
            referencedColumns: ["id"];
          },
        ];
      };
      quota_ledger: {
        Row: {
          created_at: string;
          delta: number;
          episode_id: string;
          id: string;
          month: string;
          reason: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          delta: number;
          episode_id: string;
          id?: string;
          month: string;
          reason: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          delta?: number;
          episode_id?: string;
          id?: string;
          month?: string;
          reason?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quota_ledger_episode_id_fkey";
            columns: ["episode_id"];
            isOneToOne: false;
            referencedRelation: "episodes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quota_ledger_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      shows: {
        Row: {
          created_at: string;
          default_speakers: Json;
          footer_text: string | null;
          id: string;
          intro: string | null;
          name: string;
          user_id: string;
          visual_config: Json;
        };
        Insert: {
          created_at?: string;
          default_speakers?: Json;
          footer_text?: string | null;
          id?: string;
          intro?: string | null;
          name: string;
          user_id: string;
          visual_config?: Json;
        };
        Update: {
          created_at?: string;
          default_speakers?: Json;
          footer_text?: string | null;
          id?: string;
          intro?: string | null;
          name?: string;
          user_id?: string;
          visual_config?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "shows_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      upload_parts: {
        Row: {
          created_at: string;
          etag: string;
          part_no: number;
          upload_session_id: string;
        };
        Insert: {
          created_at?: string;
          etag: string;
          part_no: number;
          upload_session_id: string;
        };
        Update: {
          created_at?: string;
          etag?: string;
          part_no?: number;
          upload_session_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "upload_parts_upload_session_id_fkey";
            columns: ["upload_session_id"];
            isOneToOne: false;
            referencedRelation: "upload_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      upload_sessions: {
        Row: {
          chunk_size: number;
          content_hash: string;
          created_at: string;
          expires_at: string;
          file_name: string;
          file_size: number;
          id: string;
          mime_type: string | null;
          oss_object_key: string;
          oss_upload_id: string;
          show_id: string;
          status: string;
          total_chunks: number;
        };
        Insert: {
          chunk_size: number;
          content_hash: string;
          created_at?: string;
          expires_at?: string;
          file_name: string;
          file_size: number;
          id?: string;
          mime_type?: string | null;
          oss_object_key: string;
          oss_upload_id: string;
          show_id: string;
          status?: string;
          total_chunks: number;
        };
        Update: {
          chunk_size?: number;
          content_hash?: string;
          created_at?: string;
          expires_at?: string;
          file_name?: string;
          file_size?: number;
          id?: string;
          mime_type?: string | null;
          oss_object_key?: string;
          oss_upload_id?: string;
          show_id?: string;
          status?: string;
          total_chunks?: number;
        };
        Relationships: [
          {
            foreignKeyName: "upload_sessions_show_id_fkey";
            columns: ["show_id"];
            isOneToOne: false;
            referencedRelation: "shows";
            referencedColumns: ["id"];
          },
        ];
      };
      users: {
        Row: {
          created_at: string;
          email: string;
          id: string;
          phone: string | null;
        };
        Insert: {
          created_at?: string;
          email: string;
          id: string;
          phone?: string | null;
        };
        Update: {
          created_at?: string;
          email?: string;
          id?: string;
          phone?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      episode_source_type: "file" | "link";
      episode_status:
        | "draft"
        | "uploaded"
        | "transcribing"
        | "transcribe_failed"
        | "generating"
        | "ready"
        | "published";
      material_status: "pending" | "generating" | "ready" | "failed";
      material_type:
        | "title"
        | "cover"
        | "shownotes"
        | "chapters"
        | "quotes"
        | "clips"
        | "note"
        | "shownotes_intro"
        | "shownotes_guest_intro"
        | "shownotes_mentions"
        | "shownotes_pinned_question";
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      episode_source_type: ["file", "link"],
      episode_status: [
        "draft",
        "uploaded",
        "transcribing",
        "transcribe_failed",
        "generating",
        "ready",
        "published",
      ],
      material_status: ["pending", "generating", "ready", "failed"],
      material_type: [
        "title",
        "cover",
        "shownotes",
        "chapters",
        "quotes",
        "clips",
        "note",
        "shownotes_intro",
        "shownotes_guest_intro",
        "shownotes_mentions",
        "shownotes_pinned_question",
      ],
    },
  },
} as const;
