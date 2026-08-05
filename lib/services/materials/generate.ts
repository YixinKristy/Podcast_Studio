import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { generateStructured } from "@/lib/ai/qwen";
import { buildGenerationContext } from "./context";
import { expandRequestedType } from "./definitions";
import { markFailed, markGenerating, saveNewVersion } from "./store";
import type { MaterialDefinition } from "./types";

// generating → ready 的迁移点（状态机文档：generating「逐项完成逐项 ready」→ ready）。
// 物料无论是批量自动触发还是用户手动点「开始生成/重新生成」，都走 generateMaterial()，
// 所以在这里统一检查最省心：每次一个物料跑完（不管成功还是失败）就看一眼，这期启用的
// 物料是不是全都到终态了（ready 或 failed，不再是 pending/generating）。
// 只看已经有生成器的文本类物料——封面/金句/切片还没实现，不能拿从没跑过的它们卡住状态机。
// generate_materials 里的"shownotes"是粗粒度勾选，要展开成三个实际物料类型才能对得上
// materials 表里真实存在的行。
export async function maybeCompleteGeneration(
  supabase: SupabaseClient<Database>,
  episodeId: string,
): Promise<void> {
  const { data: episode } = await supabase
    .from("episodes")
    .select("status, generate_materials")
    .eq("id", episodeId)
    .maybeSingle();
  if (!episode || episode.status !== "generating") return;

  const enabledTypes = Array.from(
    new Set(((episode.generate_materials as string[] | null) ?? []).flatMap(expandRequestedType)),
  );
  if (enabledTypes.length === 0) return;

  const { data: materials } = await supabase
    .from("materials")
    .select("type, status")
    .eq("episode_id", episodeId)
    .in("type", enabledTypes);

  const allDone = enabledTypes.every((type) => {
    const row = materials?.find((m) => m.type === type);
    return row?.status === "ready" || row?.status === "failed";
  });
  if (!allDone) return;

  // 条件 UPDATE 防并发：多个物料几乎同时完工时会有好几次调用都判断"全done了"，
  // 只有第一次真的把状态从 generating 改过去，后面几次 WHERE 命不中，静默跳过
  await supabase
    .from("episodes")
    .update({ status: "ready" })
    .eq("id", episodeId)
    .eq("status", "generating");
}

export async function generateMaterial<T>(
  supabase: SupabaseClient<Database>,
  episodeId: string,
  definition: MaterialDefinition<T>,
  instruction?: string,
): Promise<T> {
  const materialId = await markGenerating(supabase, episodeId, definition.type);

  try {
    const context = await buildGenerationContext(supabase, episodeId);
    const { system, user } = definition.buildPrompt(context, instruction);
    let content: T = await generateStructured({ system, user, schema: definition.schema });
    if (definition.postProcess) {
      content = definition.postProcess(content, context);
    }
    await saveNewVersion(
      supabase,
      materialId,
      content,
      instruction ? "reroll" : "generated",
      instruction,
    );
    return content;
  } catch (err) {
    await markFailed(supabase, materialId);
    throw err;
  } finally {
    await maybeCompleteGeneration(supabase, episodeId).catch(() => {});
  }
}
