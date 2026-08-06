import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/database.types";
import { generateStructured } from "@/lib/ai/qwen";
import { buildGenerationContext } from "@/lib/services/materials/context";
import { detectL1Suggestions } from "./detect";
import {
  buildRoughCutPrompt,
  roughCutAnalysisSchema,
  type RoughCutSuggestion,
} from "@/prompts/roughcut";

// 粗剪建议不像七件套物料那样有独立的版本历史表——重新生成就是探索性地换一批建议，
// 不是"发布物料"那种需要回退历史版本的东西，所以就是一行 upsert，version 只是个计数器。
export interface StoredSuggestion {
  id: string;
  layer: "L1" | "L2";
  type: "filler" | "long_pause" | "retake" | "redundant" | "off_topic" | "low_density";
  startSeconds: number;
  endSeconds: number;
  reason: string;
  confidence: number;
  selected: boolean;
}

export interface RoughCutRow {
  suggestions: StoredSuggestion[];
  outlineMarkdown: string;
  structuralNotes: { note: string; timestampSeconds?: number }[];
}

// LLM 偶尔会幻觉出超出录音实际时长的时间戳（比如说这期只有 66 分钟，它却给了 110 分钟处的建议）。
// 这种建议勾选了也不会真的剪到任何东西——被 ranges.ts 的 clamp 逻辑悄悄吞成零长度区间，
// 用户会觉得"勾了但没用"。与其让它悄悄失效，不如在生成的时候就把这种建议过滤掉。
export function filterValidL2Suggestions(
  suggestions: RoughCutSuggestion[],
  totalDurationSeconds: number,
): RoughCutSuggestion[] {
  return suggestions
    .filter((s) => s.startSeconds < totalDurationSeconds && s.startSeconds < s.endSeconds)
    .map((s) => ({ ...s, endSeconds: Math.min(s.endSeconds, totalDurationSeconds) }));
}

async function getOrCreateRoughCut(
  supabase: SupabaseClient<Database>,
  episodeId: string,
): Promise<string> {
  const { data: existing } = await supabase
    .from("rough_cuts")
    .select("id")
    .eq("episode_id", episodeId)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from("rough_cuts")
    .insert({ episode_id: episodeId, status: "pending" })
    .select("id")
    .single();
  if (error || !created) throw new Error(`创建粗剪记录失败: ${error?.message}`);
  return created.id;
}

export async function generateRoughCutSuggestions(
  supabase: SupabaseClient<Database>,
  episodeId: string,
  instruction?: string,
): Promise<RoughCutRow> {
  const roughCutId = await getOrCreateRoughCut(supabase, episodeId);
  await supabase
    .from("rough_cuts")
    .update({ status: "generating", updated_at: new Date().toISOString() })
    .eq("id", roughCutId);

  try {
    const context = await buildGenerationContext(supabase, episodeId);
    if (context.segments.length === 0) throw new Error("没有逐字稿，无法生成粗剪建议");

    const l1 = detectL1Suggestions(context.segments);
    const { system, user } = buildRoughCutPrompt(context, l1, instruction);
    const analysis = await generateStructured({ system, user, schema: roughCutAnalysisSchema });

    const totalDurationSeconds = context.segments.reduce((max, s) => Math.max(max, s.end), 0);
    const validL2 = filterValidL2Suggestions(analysis.suggestions, totalDurationSeconds);

    // L1 默认全选中，L2 默认不选中（语义判断没 L1 可靠，交给用户逐条确认）——跟 Yi 确认过的默认值
    const suggestions: StoredSuggestion[] = [
      ...l1.map((s, i) => ({ id: `l1-${i}`, ...s, selected: true })),
      ...validL2.map((s, i) => ({ id: `l2-${i}`, ...s, selected: false })),
    ];

    const { data: current } = await supabase
      .from("rough_cuts")
      .select("version")
      .eq("id", roughCutId)
      .single();

    await supabase
      .from("rough_cuts")
      .update({
        status: "ready",
        suggestions: suggestions as unknown as Json,
        outline_markdown: buildOutlineWithNotes(analysis.outlineMarkdown, analysis.structuralNotes),
        version: (current?.version ?? 0) + 1,
      })
      .eq("id", roughCutId);

    return {
      suggestions,
      outlineMarkdown: analysis.outlineMarkdown,
      structuralNotes: analysis.structuralNotes,
    };
  } catch (err) {
    await supabase
      .from("rough_cuts")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", roughCutId);
    throw err;
  }
}

function buildOutlineWithNotes(
  outlineMarkdown: string,
  notes: { note: string; timestampSeconds?: number }[],
): string {
  if (notes.length === 0) return outlineMarkdown;
  const notesSection = notes
    .map(
      (n) =>
        `- ${n.timestampSeconds !== undefined ? `[${n.timestampSeconds.toFixed(0)}s] ` : ""}${n.note}`,
    )
    .join("\n");
  return `${outlineMarkdown}\n\n## 结构建议（仅供参考，不会自动执行）\n${notesSection}`;
}

export async function updateSelection(
  supabase: SupabaseClient<Database>,
  episodeId: string,
  selectedIds: string[],
): Promise<void> {
  const { data: roughCut, error } = await supabase
    .from("rough_cuts")
    .select("id, suggestions")
    .eq("episode_id", episodeId)
    .single();
  if (error || !roughCut) throw new Error("找不到这期的粗剪建议");

  const selectedSet = new Set(selectedIds);
  const suggestions = (roughCut.suggestions as unknown as StoredSuggestion[]).map((s) => ({
    ...s,
    selected: selectedSet.has(s.id),
  }));

  await supabase
    .from("rough_cuts")
    .update({ suggestions: suggestions as unknown as Json })
    .eq("id", roughCut.id);
}
