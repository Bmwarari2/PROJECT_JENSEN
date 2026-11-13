// Hand-written to match supabase/migrations/20261113000000_init.sql, in the
// shape `supabase gen types typescript` produces. Regenerate with the CLI if
// you change the schema.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Table<Row, Insert, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      learner_state: Table<
        { id: number; current_unit: number; tutor_notes: string; updated_at: string },
        { id?: number; current_unit?: number; tutor_notes?: string; updated_at?: string }
      >;
      conversations: Table<
        {
          id: string;
          created_at: string;
          last_message_at: string;
          model: string;
          system_prompt: string;
          message_count: number;
        },
        {
          id?: string;
          created_at?: string;
          last_message_at?: string;
          model: string;
          system_prompt: string;
          message_count?: number;
        }
      >;
      messages: Table<
        {
          id: number;
          conversation_id: string;
          seq: number;
          role: "user" | "assistant";
          content: Json;
          display: Json;
          created_at: string;
        },
        {
          conversation_id: string;
          seq: number;
          role: "user" | "assistant";
          content: Json;
          display: Json;
          created_at?: string;
        }
      >;
      vocabulary: Table<
        {
          id: number;
          hanzi: string;
          pinyin: string;
          english: string;
          introduced_at: string;
          last_seen_at: string;
          times_seen: number;
          practice_attempts: number;
          practice_passes: number;
          last_score: number | null;
          best_score: number | null;
          interval_days: number;
          next_review_at: string;
        },
        {
          hanzi: string;
          pinyin?: string;
          english?: string;
          introduced_at?: string;
          last_seen_at?: string;
          times_seen?: number;
          practice_attempts?: number;
          practice_passes?: number;
          last_score?: number | null;
          best_score?: number | null;
          interval_days?: number;
          next_review_at?: string;
        }
      >;
      pronunciation_attempts: Table<
        {
          id: number;
          created_at: string;
          conversation_id: string | null;
          target_hanzi: string;
          target_pinyin: string;
          target_english: string;
          recognized_text: string;
          pron_score: number | null;
          accuracy_score: number | null;
          fluency_score: number | null;
          completeness_score: number | null;
          words: Json;
        },
        {
          conversation_id?: string | null;
          target_hanzi: string;
          target_pinyin?: string;
          target_english?: string;
          recognized_text?: string;
          pron_score?: number | null;
          accuracy_score?: number | null;
          fluency_score?: number | null;
          completeness_score?: number | null;
          words?: Json;
        }
      >;
    };
    Views: { [_ in never]: never };
    Functions: {
      append_messages: {
        Args: { p_conversation_id: string; p_expected_count: number; p_messages: Json };
        Returns: number;
      };
      record_vocabulary: { Args: { items: Json }; Returns: undefined };
      activity_days: { Args: { tz?: string }; Returns: { day: string }[] };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
