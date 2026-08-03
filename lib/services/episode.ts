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
