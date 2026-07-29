import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";

export interface CreateShowInput {
  userId: string;
  name: string;
  defaultSpeaker?: string;
}

// MVP 一账号一节目（docs/07 B3），RLS 已经把结果限定在当前用户名下，直接拿第一条
export async function getOwnShow(supabase: SupabaseClient<Database>) {
  return supabase.from("shows").select("id, name").limit(1).maybeSingle();
}

export async function createShow(
  supabase: SupabaseClient<Database>,
  { userId, name, defaultSpeaker }: CreateShowInput,
) {
  return supabase
    .from("shows")
    .insert({
      user_id: userId,
      name,
      default_speakers: defaultSpeaker ? [defaultSpeaker] : [],
    })
    .select("id")
    .single();
}
