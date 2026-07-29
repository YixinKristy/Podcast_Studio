import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";

export interface CreateShowInput {
  userId: string;
  name: string;
  defaultSpeaker?: string;
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
