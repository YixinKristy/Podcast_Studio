import { z } from "zod";
import type { MaterialGenerationContext } from "@/lib/services/materials/types";
import type { RuleSuggestion } from "@/lib/services/roughcut/detect";
import { COMMON_SYSTEM_PROMPT_HEADER } from "./common";

// docs/04 §1.2：L1（填充词/长停顿）是纯规则检测的（见 lib/services/roughcut/detect.ts），
// 这个 prompt 只负责需要语义判断的 L2，以及"建议但不执行"的 L3 结构层 + 文字大纲。

export const roughCutSuggestionSchema = z.object({
  layer: z.literal("L2"),
  type: z.enum(["retake", "redundant", "off_topic", "low_density"]),
  startSeconds: z.number().min(0),
  endSeconds: z.number().min(0),
  reason: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export const structuralNoteSchema = z.object({
  note: z.string().min(1),
  timestampSeconds: z.number().optional(),
});

export const roughCutAnalysisSchema = z.object({
  suggestions: z.array(roughCutSuggestionSchema),
  structuralNotes: z.array(structuralNoteSchema),
  outlineMarkdown: z.string().min(1),
});

export type RoughCutSuggestion = z.infer<typeof roughCutSuggestionSchema>;
export type StructuralNote = z.infer<typeof structuralNoteSchema>;
export type RoughCutAnalysis = z.infer<typeof roughCutAnalysisSchema>;

function formatL1ForPrompt(l1: RuleSuggestion[]): string {
  if (l1.length === 0) return "（这期没有检测到明显的填充词/长停顿）";
  return l1
    .map((s) => `[${s.startSeconds.toFixed(1)}s-${s.endSeconds.toFixed(1)}s] ${s.reason}`)
    .join("\n");
}

export function buildRoughCutPrompt(
  context: MaterialGenerationContext,
  l1Suggestions: RuleSuggestion[],
  instruction?: string,
): { system: string; user: string } {
  const system = `${COMMON_SYSTEM_PROMPT_HEADER}

你是中文播客的剪辑顾问，帮播客主找出可以剪掉的内容，产出一份粗剪建议。这是给播客主自己判断用的
建议，不是自动执行的最终结果——语气要克制，不确定的地方标低 confidence，不要为了凑数硬找。

【背景】系统已经用规则检测出了填充词和长停顿（L1，见下方"已检测到的 L1 建议"），你不需要重复
这些，专注做需要语义判断的部分：

L2 内容层——找出以下几类可以剪掉的片段，每条给出具体理由：
- retake（口误重说）：说话人说错了重新说一遍，前面说错/说岔的那段可以剪，保留后面说对的版本
- redundant（冗余表达）：同一个观点用不同的话说了两三遍，只保留最完整最好的一遍，其余标记可删
- off_topic（跑题）：与本期主线无关的闲聊支线（如果这段跑题本身很有意思、是节目魅力所在，就不要标）
- low_density（低信息密度）：开场寒暄、找词卡壳的空转、没有实质内容的过渡

每条给 startSeconds/endSeconds（必须是转录稿里真实出现的时间戳，不要自己估算）、reason（具体
说明为什么可删，不要写"内容重复"这种空泛理由）、confidence（0-1）。

L3 结构层——只给建议，不产出可执行的删除区间（不自动重排，只是提示，最终怎么排是播客主的事）：
- 冷开场建议：如果全片有个更抓人的 20-40 秒片段，建议放到片头做冷开场
- 缺转场提醒：话题跳转生硬的地方，建议要不要补录一句过渡口播
每条给一句话说明，可以附一个参考时间点。

【内容结构大纲】给一份 Markdown 格式的大纲，按话题分段列出这期都聊了什么，方便播客主快速回忆整体结构，
不需要精确到句，几个大段落+每段一两句概括即可。

必须输出 JSON：
{"suggestions": [{"layer":"L2","type":"retake|redundant|off_topic|low_density","startSeconds":数字(秒),"endSeconds":数字(秒),"reason":"...","confidence":0到1之间的数字}],
"structuralNotes": [{"note":"...", "timestampSeconds": 数字(秒，选填)}],
"outlineMarkdown": "# 大纲\n## 段落1\n..."}`;

  const user = [
    `节目名：${context.showName}`,
    context.promoteNote ? `这期想传达的重点：${context.promoteNote}` : null,
    "已检测到的 L1 建议（不用重复标注）：",
    formatL1ForPrompt(l1Suggestions),
    "带时间戳的完整转录稿：",
    context.transcriptText,
    instruction ? `\n用户对这版建议的修改要求：${instruction}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { system, user };
}
