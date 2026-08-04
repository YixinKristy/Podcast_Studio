import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/database.types";
import type { TextMaterialType } from "./types";

const MAX_VERSIONS = 5; // PRD：生成型物料保留 5 版

export async function getOrCreateMaterial(
  supabase: SupabaseClient<Database>,
  episodeId: string,
  type: TextMaterialType,
): Promise<string> {
  const { data: existing } = await supabase
    .from("materials")
    .select("id")
    .eq("episode_id", episodeId)
    .eq("type", type)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from("materials")
    .insert({ episode_id: episodeId, type, status: "pending" })
    .select("id")
    .single();
  if (error || !created) throw new Error(`创建物料记录失败: ${error?.message}`);
  return created.id;
}

export async function markGenerating(
  supabase: SupabaseClient<Database>,
  episodeId: string,
  type: TextMaterialType,
): Promise<string> {
  const materialId = await getOrCreateMaterial(supabase, episodeId, type);
  // updated_at 没有数据库触发器自动维护，这里手动打时间戳——
  // 前端要靠它算出"这次生成已经跑了多久"，不是行第一次创建的时间
  await supabase
    .from("materials")
    .update({ status: "generating", updated_at: new Date().toISOString() })
    .eq("id", materialId);
  return materialId;
}

export async function markFailed(
  supabase: SupabaseClient<Database>,
  materialId: string,
): Promise<void> {
  await supabase
    .from("materials")
    .update({ status: "failed", updated_at: new Date().toISOString() })
    .eq("id", materialId);
}

// 存一个新版本，materials.content/version 同步指向它，超过 5 版的旧版本清掉
export async function saveNewVersion<T>(
  supabase: SupabaseClient<Database>,
  materialId: string,
  content: T,
  source: "generated" | "edited" | "reroll",
  instruction?: string,
): Promise<{ version: number }> {
  // 不能信 materials.version 列的默认值（新建行默认就是 1，会导致第一次保存变成"版本2"，
  // 版本1 从来没在 material_versions 里存在过——踩过这个坑）。用版本历史表本身的 MAX 算下一个版本号。
  const { data: latest } = await supabase
    .from("material_versions")
    .select("version")
    .eq("material_id", materialId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = (latest?.version ?? 0) + 1;

  const { error: insertErr } = await supabase.from("material_versions").insert({
    material_id: materialId,
    version: nextVersion,
    content: content as Json,
    source,
    instruction,
  });
  if (insertErr) throw new Error(`保存版本失败: ${insertErr.message}`);

  await supabase
    .from("materials")
    .update({ content: content as Json, version: nextVersion, status: "ready" })
    .eq("id", materialId);

  const { data: versions } = await supabase
    .from("material_versions")
    .select("id, version")
    .eq("material_id", materialId)
    .order("version", { ascending: false });
  const toDelete = (versions ?? []).slice(MAX_VERSIONS).map((v) => v.id);
  if (toDelete.length > 0) {
    await supabase.from("material_versions").delete().in("id", toDelete);
  }

  return { version: nextVersion };
}

export async function confirmMaterial(
  supabase: SupabaseClient<Database>,
  materialId: string,
): Promise<void> {
  await supabase
    .from("materials")
    .update({ confirmed_at: new Date().toISOString() })
    .eq("id", materialId);
}

// 回退不是删除历史，是把旧版本的内容重新存成一个新的"当前版本"
export async function restoreVersion(
  supabase: SupabaseClient<Database>,
  materialId: string,
  version: number,
): Promise<{ version: number }> {
  const { data: target, error } = await supabase
    .from("material_versions")
    .select("content")
    .eq("material_id", materialId)
    .eq("version", version)
    .single();
  if (error || !target) throw new Error("找不到这个版本");

  return saveNewVersion(supabase, materialId, target.content, "edited");
}
