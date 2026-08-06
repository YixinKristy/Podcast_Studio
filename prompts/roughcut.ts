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

// docs/04 §1.2 v2 重写 + docs/13 §九：Pass 1（结构理解）+ Pass 2（依主线取舍），
// 叠加在上面的 Pass 3（L1/L2/L3，即 buildRoughCutPrompt）之上——段落级、主线驱动的
// 大刀阔斧取舍，Pass 3 还是负责句级的微观清理，两者不重叠、不互相替代。

export const structuralSegmentSchema = z.object({
  startSeconds: z.number().min(0),
  endSeconds: z.number().min(0),
  topic: z.string().min(1),
  relation: z.enum(["core", "support", "tangent", "irrelevant"]),
  infoDensity: z.number().min(0).max(10),
  tension: z.number().min(0).max(10),
  // 时间点而不是段落 id——避免让 LLM 自己维护跨段落引用的 id 一致性，时间点自解释、不用对齐
  refsBack: z.array(z.number()),
  referencedBy: z.array(z.number()),
});

export const structureReportSchema = z.object({
  mainThread: z.string().min(1),
  segments: z.array(structuralSegmentSchema).min(1),
  diagnosis: z.array(z.string()),
});

export type StructuralSegment = z.infer<typeof structuralSegmentSchema>;
export type StructureReport = z.infer<typeof structureReportSchema>;

export function buildStructurePrompt(context: MaterialGenerationContext): {
  system: string;
  user: string;
} {
  const system = `${COMMON_SYSTEM_PROMPT_HEADER}

你是中文播客的剪辑顾问，读完整期逐字稿，输出结构报告。这一步只描述，不做任何删除决策。

【任务】
1. mainThread：一句话说清这期到底在讲什么。若用户填了本期想传达的重点，以其为准，
   并在措辞里体现内容是否偏离这个重点。
2. segments：把全片切成 15-40 个内容段，按话题真实切换处分段，边界吸附到语轮（一个人开始
   新一轮发言处），不要切在句子中间。每段给出：
   - topic：一句话主题
   - relation：与主线的关系——core（主线核心）/ support（例证·故事·数据支撑主线）/
     tangent（有价值但偏离主线的旁支）/ irrelevant（无关闲聊，删了不影响主线）
   - infoDensity：0-10，新信息量除以时长。寒暄、找词卡壳、重复表述给低分
   - tension：0-10，是否有转折、交锋、金句、情绪起伏
   - refsBack：本段是否引用了前文（"刚才你说的""前面提到那个"），如果有，给出被引用内容
     所在的大致时间点（秒），可以有多个；没有就是空数组
   - referencedBy：本段的内容在后文哪些时间点被引用，同样给时间点数组；这是后面删除安全检查
     要用的，宁可多标不要漏标
3. diagnosis：结构问题诊断，例如"主线在 23:00 才出现，前面是铺垫""同一观点讲了三遍"
   "结尾没有收口"，每条一句话

【原则】只描述不评判删留；不确定某段是 tangent 还是 irrelevant 时标 tangent（宁可保守）。

必须输出 JSON：
{"mainThread":"...","segments":[{"startSeconds":数字,"endSeconds":数字,"topic":"...",
"relation":"core|support|tangent|irrelevant","infoDensity":0到10,"tension":0到10,
"refsBack":[数字...],"referencedBy":[数字...]}],"diagnosis":["...","..."]}`;

  const user = [
    `节目名：${context.showName}`,
    context.promoteNote ? `这期想传达的重点：${context.promoteNote}` : null,
    "带时间戳的完整转录稿：",
    context.transcriptText,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { system, user };
}

export const ROUGHCUT_STYLE_PRESETS = {
  concise: { label: "精简高信息", ratio: 0.55 },
  compact: { label: "紧凑干货", ratio: 0.72 },
  relaxed: { label: "松弛闲聊", ratio: 0.89 },
} as const;

export type RoughCutStyle = keyof typeof ROUGHCUT_STYLE_PRESETS;

export const segmentDecisionSchema = z.object({
  segmentIndex: z.number().int().min(0),
  action: z.enum(["keep", "compress", "delete", "pick_one", "move_to_intro"]),
  reason: z.string().min(1),
  confidence: z.number().min(0).max(1),
  risk: z.string().optional(),
  bridgeLine: z.string().optional(),
  keepRatio: z.number().min(0).max(1).optional(),
});

export const segmentDecisionsSchema = z.object({
  decisions: z.array(segmentDecisionSchema).min(1),
  summary: z.string().min(1),
  estimatedDurationSeconds: z.number().min(0),
});

export type SegmentDecision = z.infer<typeof segmentDecisionSchema>;
export type SegmentDecisions = z.infer<typeof segmentDecisionsSchema>;

function formatSegmentsForPrompt(segments: StructuralSegment[]): string {
  return segments
    .map((s, i) => {
      const refs = s.refsBack.length > 0 ? `，引用了 [${s.refsBack.join(", ")}]` : "";
      const referenced =
        s.referencedBy.length > 0 ? `，被 [${s.referencedBy.join(", ")}] 引用` : "";
      return `[${i}] ${s.startSeconds.toFixed(1)}s-${s.endSeconds.toFixed(1)}s ${s.topic} | relation=${s.relation} density=${s.infoDensity} tension=${s.tension}${refs}${referenced}`;
    })
    .join("\n");
}

export function buildSegmentDecisionPrompt(
  context: MaterialGenerationContext,
  structureReport: StructureReport,
  style: RoughCutStyle,
  targetDurationSeconds: number,
  instruction?: string,
): { system: string; user: string } {
  const system = `${COMMON_SYSTEM_PROMPT_HEADER}

你是中文播客的剪辑顾问，已经拿到了结构报告（主线陈述 + 分段），现在要基于结构报告对每个
段落给出剪辑决策，目标是产出一版精简、信息量高、紧扣主线的成品。可以大刀阔斧——删掉整段
是常规操作，不是例外。

【决策取值】
- keep：主线核心、高张力段，原样保留
- compress：主线支撑但冗长，段内可以句级删减，保留骨架与最有力的例证，给出 keepRatio
  （保留比例，0-1）
- delete：无关闲聊、信息密度低（infoDensity < 4）、重复表述——整段删
- pick_one：段落属于"同一观点的多次表述"里被淘汰的那一份，标记为可删——最完整有力、要保留
  的那一份直接标 keep 就行（reason 里说明选中它、淘汰了哪个时间点的重复版本），不要给保留的
  那份也标 pick_one。pick_one 这个动作本身就代表"这是被淘汰的重复项"
- move_to_intro：强钩子出现在中后段，建议作为冷开场提到片头（只是建议，不自动执行）

【判断优先级】
1. 与主线无关 → 删（哪怕内容本身有趣；有趣但离题的内容可以留给切片素材，不占正片时长）
2. 重复 → 择一
3. 信息密度低 → 删或压缩
4. 高张力/金句 → 即使略偏离主线也保留，它是听感的呼吸点
5. 开场若超过 3 分钟才进入主题，建议压缩；结尾没有收口，在对应段落的 reason 里提一句

【硬约束——指代断裂安全网】
- 每条决策必须给 reason，一句话，具体到内容，不能是"信息密度低"这种复述标签
- 段落的 referencedBy 非空时（后文引用了它），如果决定 delete 或 pick_one 剔除它，必须在
  risk 字段写清楚会造成什么指代断裂，并在 bridgeLine 给出一句可以补录的过渡台词建议；
  没有这个风险就不要写 risk/bridgeLine
- 累计保留时长要向目标时长收敛，如果超出目标 15% 以上，回头对 tangent 段加大删除力度

必须输出 JSON：
{"decisions":[{"segmentIndex":数字,"action":"keep|compress|delete|pick_one|move_to_intro",
"reason":"...","confidence":0到1,"risk":"...(选填)","bridgeLine":"...(选填)",
"keepRatio":0到1(仅 compress 填)}],"summary":"一段话说清这次剪辑的思路，展示给用户看",
"estimatedDurationSeconds":数字}`;

  const user = [
    `节目名：${context.showName}`,
    `主线：${structureReport.mainThread}`,
    `风格档：${ROUGHCUT_STYLE_PRESETS[style].label}，目标时长约 ${Math.round(targetDurationSeconds)} 秒（原片 ${Math.round(structureReport.segments[structureReport.segments.length - 1]?.endSeconds ?? 0)} 秒）`,
    structureReport.diagnosis.length > 0
      ? `结构诊断：\n${structureReport.diagnosis.map((d) => `- ${d}`).join("\n")}`
      : null,
    "段落列表（索引 [n] 对应下面决策里的 segmentIndex）：",
    formatSegmentsForPrompt(structureReport.segments),
    instruction ? `\n用户对这版决策的修改要求：${instruction}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { system, user };
}
