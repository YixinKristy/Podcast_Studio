import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/database.types";

export interface Guest {
  name: string;
  role?: string;
  [key: string]: Json | undefined;
}

export interface UpdateEpisodeInfoInput {
  promoteNote?: string;
  guests?: Guest[];
  generateMaterials?: string[];
}

// P2 本期信息卡：核心主输入（promoteNote）+ 折叠区（guests/generateMaterials），
// 任务 1.7 生成物料时会读这些字段喂给 prompt
// 幂等/防并发的把关点：只有 uploaded（首次）或 transcribe_failed（重试）能进 transcribing。
// 用条件 UPDATE 而不是先查再写——两个并发请求（比如手滑点两下按钮）只有一个能改到行，
// 另一个 rows.length===0，直接拒绝，不会都往下走触发两次转写任务和两次扣额度。
export async function beginTranscription(supabase: SupabaseClient<Database>, episodeId: string) {
  return supabase
    .from("episodes")
    .update({ status: "transcribing" })
    .eq("id", episodeId)
    .in("status", ["uploaded", "transcribe_failed"])
    .select("id, audio_url, generate_materials")
    .maybeSingle();
}

export async function updateEpisodeInfo(
  supabase: SupabaseClient<Database>,
  episodeId: string,
  input: UpdateEpisodeInfoInput,
) {
  return supabase
    .from("episodes")
    .update({
      ...(input.promoteNote !== undefined && { promote_note: input.promoteNote }),
      ...(input.guests !== undefined && { guests: input.guests }),
      ...(input.generateMaterials !== undefined && { generate_materials: input.generateMaterials }),
    })
    .eq("id", episodeId)
    .select("id")
    .single();
}
