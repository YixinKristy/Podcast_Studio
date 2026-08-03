// 转写完成后生成文本四件套（标题/shownotes/章节/宣传笔记）。
// 每项独立生成、独立失败重试（架构铁律），所以用 allSettled 不用一个失败拖累其它几项。
import { task, logger } from "@trigger.dev/sdk";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { generateMaterial } from "@/lib/services/materials/generate";
import {
  TEXT_MATERIAL_DEFINITIONS,
  isTextMaterialType,
} from "@/lib/services/materials/definitions";
import type { MaterialDefinition } from "@/lib/services/materials/types";

function getAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}

export const generateMaterials = task({
  id: "generate-materials",
  maxDuration: 600,
  run: async (payload: { episodeId: string; materialTypes: string[] }) => {
    const supabase = getAdminClient();
    const types = payload.materialTypes.filter(isTextMaterialType);

    // 每种物料的 content 形状不一样，批量并发派发时不需要区分具体类型，统一按 unknown 处理
    const results = await Promise.allSettled(
      types.map((type) =>
        generateMaterial(
          supabase,
          payload.episodeId,
          TEXT_MATERIAL_DEFINITIONS[type] as MaterialDefinition<unknown>,
        ),
      ),
    );

    results.forEach((result, i) => {
      if (result.status === "rejected") {
        logger.error(`物料生成失败: ${types[i]}`, { error: String(result.reason) });
      } else {
        logger.info(`物料生成成功: ${types[i]}`);
      }
    });

    return {
      succeeded: types.filter((_, i) => results[i]?.status === "fulfilled"),
      failed: types.filter((_, i) => results[i]?.status === "rejected"),
    };
  },
});
