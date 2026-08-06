import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/database.types";
import { generateStructured } from "@/lib/ai/qwen";
import { buildGenerationContext } from "@/lib/services/materials/context";
import type { MaterialGenerationContext } from "@/lib/services/materials/types";
import { detectL1Suggestions } from "./detect";
import {
  buildRoughCutPrompt,
  roughCutAnalysisSchema,
  buildStructurePrompt,
  structureReportSchema,
  resolveStructuralSegments,
  buildSegmentDecisionPrompt,
  segmentDecisionsSchema,
  ROUGHCUT_STYLE_PRESETS,
  type RoughCutSuggestion,
  type RoughCutStyle,
  type StructuralSegment,
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
  structuralAnalysis: StoredStructuralAnalysis;
}

// docs/04 §1.2 v2 重写：Pass 1（结构理解）+ Pass 2（依主线取舍），叠加在上面 Pass 3 之上的
// 段落级、主线驱动的取舍决策——跟 L1/L2 的句级/片段级建议不是一回事，单独存一份。
export interface StoredSegment extends StructuralSegment {
  id: string;
  action: "keep" | "compress" | "delete" | "pick_one" | "move_to_intro";
  reason: string;
  confidence: number;
  risk?: string;
  bridgeLine?: string;
  keepRatio?: number;
  // 只对 action 是 delete / pick_one 的段落有意义——默认不勾选，跟 L2 一致：
  // 删整段影响比删几秒填充词大得多，必须用户逐条确认才会真的生效
  selected: boolean;
}

export interface StoredStructuralAnalysis {
  mainThread: string;
  diagnosis: string[];
  summary: string;
  style: RoughCutStyle;
  originalDurationSeconds: number;
  targetDurationSeconds: number;
  estimatedDurationSeconds: number;
  segments: StoredSegment[];
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

async function runStructuralPasses(
  context: MaterialGenerationContext,
  style: RoughCutStyle,
  originalDurationSeconds: number,
  instruction?: string,
): Promise<StoredStructuralAnalysis> {
  const pass1 = buildStructurePrompt(context);
  const rawReport = await generateStructured({
    system: pass1.system,
    user: pass1.user,
    schema: structureReportSchema,
  });
  // LLM 给的是转录行号，这里换算成真实的秒数——保证段落边界一定落在真实存在的转录行上，
  // 不会出现时间戳和实际音频内容对不上的情况
  const resolvedSegments = resolveStructuralSegments(rawReport.segments, context.segments);

  const targetDurationSeconds = originalDurationSeconds * ROUGHCUT_STYLE_PRESETS[style].ratio;
  const pass2 = buildSegmentDecisionPrompt(
    context,
    rawReport.mainThread,
    rawReport.diagnosis,
    resolvedSegments,
    style,
    targetDurationSeconds,
    instruction,
  );
  const decisions = await generateStructured({
    system: pass2.system,
    user: pass2.user,
    schema: segmentDecisionsSchema,
  });

  const decisionByIndex = new Map(decisions.decisions.map((d) => [d.segmentIndex, d]));
  const segments: StoredSegment[] = resolvedSegments.map((seg, i) => {
    const decision = decisionByIndex.get(i);
    return {
      id: `seg-${i}`,
      ...seg,
      action: decision?.action ?? "keep",
      reason: decision?.reason ?? "",
      confidence: decision?.confidence ?? 0,
      risk: decision?.risk,
      bridgeLine: decision?.bridgeLine,
      keepRatio: decision?.keepRatio,
      selected: false,
    };
  });

  return {
    mainThread: rawReport.mainThread,
    diagnosis: rawReport.diagnosis,
    summary: decisions.summary,
    style,
    originalDurationSeconds,
    targetDurationSeconds,
    estimatedDurationSeconds: decisions.estimatedDurationSeconds,
    segments,
  };
}

export async function generateRoughCutSuggestions(
  supabase: SupabaseClient<Database>,
  episodeId: string,
  instruction?: string,
  style: RoughCutStyle = "concise",
): Promise<RoughCutRow> {
  const roughCutId = await getOrCreateRoughCut(supabase, episodeId);
  await supabase
    .from("rough_cuts")
    .update({ status: "generating", updated_at: new Date().toISOString() })
    .eq("id", roughCutId);

  try {
    const context = await buildGenerationContext(supabase, episodeId);
    if (context.segments.length === 0) throw new Error("没有逐字稿，无法生成粗剪建议");

    const totalDurationSeconds = context.segments.reduce((max, s) => Math.max(max, s.end), 0);
    const l1 = detectL1Suggestions(context.segments);
    const pass3 = buildRoughCutPrompt(context, l1, instruction);

    // Pass 1+2（结构+主线取舍）跟 Pass 3（微观清理）互相独立，都只依赖同一份转录稿，
    // 并发跑省时间——不需要 Pass1/2 的结果喂给 Pass3，也不反过来
    const [analysis, structuralAnalysis] = await Promise.all([
      generateStructured({
        system: pass3.system,
        user: pass3.user,
        schema: roughCutAnalysisSchema,
      }),
      runStructuralPasses(context, style, totalDurationSeconds, instruction),
    ]);

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
        structural_analysis: structuralAnalysis as unknown as Json,
        version: (current?.version ?? 0) + 1,
      })
      .eq("id", roughCutId);

    return {
      suggestions,
      outlineMarkdown: analysis.outlineMarkdown,
      structuralNotes: analysis.structuralNotes,
      structuralAnalysis,
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
    .select("id, suggestions, structural_analysis")
    .eq("episode_id", episodeId)
    .single();
  if (error || !roughCut) throw new Error("找不到这期的粗剪建议");

  // suggestions（L1/L2）跟 structural_analysis.segments（Pass 1+2 的段落取舍）用同一份
  // selectedIds 驱动——id 前缀不冲突（l1-/l2- vs seg-），客户端只需要维护一个勾选列表
  const selectedSet = new Set(selectedIds);
  const suggestions = (roughCut.suggestions as unknown as StoredSuggestion[]).map((s) => ({
    ...s,
    selected: selectedSet.has(s.id),
  }));

  const structuralAnalysis =
    roughCut.structural_analysis as unknown as StoredStructuralAnalysis | null;
  const updatedStructuralAnalysis: StoredStructuralAnalysis | null = structuralAnalysis
    ? {
        ...structuralAnalysis,
        segments: structuralAnalysis.segments.map((s) => ({
          ...s,
          selected: selectedSet.has(s.id),
        })),
      }
    : null;

  await supabase
    .from("rough_cuts")
    .update({
      suggestions: suggestions as unknown as Json,
      structural_analysis: updatedStructuralAnalysis as unknown as Json,
    })
    .eq("id", roughCut.id);
}
