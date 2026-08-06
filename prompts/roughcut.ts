import { z } from "zod";
import type { MaterialGenerationContext } from "@/lib/services/materials/types";
import type { TranscriptSegment } from "@/lib/services/transcript";
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

// 段落边界不能让 LLM 自己去回忆/编造某个话题发生在第几秒——67 分钟的长稿里让它一次性
// 精确定位 15-40 个分段的起止秒数，实测会明显跑偏（话题描述和实际那个时间点的音频对不上）。
// 改成引用转录稿的行号（每行转录已经是一个真实的语轮起点），LLM 只需要指出"这段话题从
// 第几行到第几行"，实际的 startSeconds/endSeconds 由代码从 context.segments 精确取值，
// 保证时间戳一定落在真实存在的转录行上——跟架构规则 #4"时间戳单一来源"是一回事。
export const rawStructuralSegmentSchema = z.object({
  startIndex: z.number().int().min(0),
  endIndex: z.number().int().min(0),
  topic: z.string().min(1),
  relation: z.enum(["core", "support", "tangent", "irrelevant"]),
  infoDensity: z.number().min(0).max(10),
  tension: z.number().min(0).max(10),
  // 同样是行号而不是时间点——引用哪一行比凭空报一个时间点准得多
  refsBackIndex: z.array(z.number().int()),
  referencedByIndex: z.array(z.number().int()),
});

export const structureReportSchema = z.object({
  mainThread: z.string().min(1),
  segments: z.array(rawStructuralSegmentSchema).min(1),
  diagnosis: z.array(z.string()),
});

export type RawStructuralSegment = z.infer<typeof rawStructuralSegmentSchema>;
export type StructureReport = z.infer<typeof structureReportSchema>;

// 解析后、给下游（Pass 2 + UI + 渲染）用的结构段落——时间戳已经从真实转录行解析出来，
// 不再是 LLM 自己报的数字
export interface StructuralSegment {
  startSeconds: number;
  endSeconds: number;
  topic: string;
  relation: "core" | "support" | "tangent" | "irrelevant";
  infoDensity: number;
  tension: number;
  refsBack: number[];
  referencedBy: number[];
}

// 纯函数，方便单测：把 LLM 给的行号引用解析成真实转录行对应的秒数，越界的行号 clamp 到
// 合法范围内而不是直接报错——LLM 偶尔会给出稍微超出总行数的索引，clamp 比整段丢弃更稳妥
export function resolveStructuralSegments(
  raw: RawStructuralSegment[],
  transcriptSegments: TranscriptSegment[],
): StructuralSegment[] {
  if (transcriptSegments.length === 0) return [];
  const clampIndex = (i: number) => Math.max(0, Math.min(i, transcriptSegments.length - 1));

  return raw.map((s) => {
    const startIdx = clampIndex(s.startIndex);
    const endIdx = Math.max(startIdx, clampIndex(s.endIndex));
    return {
      startSeconds: transcriptSegments[startIdx]!.start,
      endSeconds: transcriptSegments[endIdx]!.end,
      topic: s.topic,
      relation: s.relation,
      infoDensity: s.infoDensity,
      tension: s.tension,
      refsBack: s.refsBackIndex.map((i) => transcriptSegments[clampIndex(i)]!.start),
      referencedBy: s.referencedByIndex.map((i) => transcriptSegments[clampIndex(i)]!.start),
    };
  });
}

function formatIndexedTranscript(segments: TranscriptSegment[]): string {
  return segments
    .map((s, i) => {
      const m = Math.floor(s.start / 60);
      const sec = Math.floor(s.start % 60);
      const ts = `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
      return `[${i}][${ts}][说话人${s.speaker}] ${s.text}`;
    })
    .join("\n");
}

export function buildStructurePrompt(context: MaterialGenerationContext): {
  system: string;
  user: string;
} {
  const system = `${COMMON_SYSTEM_PROMPT_HEADER}

你是中文播客的剪辑顾问，读完整期逐字稿，输出结构报告。这一步只描述，不做任何删除决策。

【逐字稿格式】每行是 [行号][时间戳][说话人] 文本。下面所有涉及"位置"的字段都必须填行号
（方括号里那个整数），不要自己换算或估算成秒数——行号对应的就是这一行说话人开始这轮发言的
真实时间点，代码会精确换算，你只需要判断"这个话题是从第几行开始、到第几行结束"。

【任务】
1. mainThread：一句话说清这期到底在讲什么。若用户填了本期想传达的重点，以其为准，
   并在措辞里体现内容是否偏离这个重点。
2. segments：把全片切成 15-40 个内容段——这是硬性上限，不是参考值，超过 40 段是错误输出。
   按话题真实转折处分段，不是按说话人切换或每一句话分段：一个话题段落通常应该跨十几到
   几十行、覆盖好几轮对话来回，只有话题真的变了才切一刀。切分点只能落在某一行的开头
   （不可以说"第 30 行的中间"），每段给出：
   - startIndex / endIndex：这个话题段落对应的起止行号（闭区间，包含这两行）
   - topic：一句话主题，必须能在 startIndex 到 endIndex 这几行的原文里找到依据，
     不要写这几行实际没有出现过的内容
   - relation：与主线的关系——core（主线核心）/ support（例证·故事·数据支撑主线）/
     tangent（有价值但偏离主线的旁支）/ irrelevant（无关闲聊，删了不影响主线）
   - infoDensity：0-10，新信息量除以时长。寒暄、找词卡壳、重复表述给低分
   - tension：0-10，是否有转折、交锋、金句、情绪起伏
   - refsBackIndex：本段是否引用了前文（"刚才你说的""前面提到那个"），如果有，给出被引用
     内容所在的行号，可以有多个；没有就是空数组
   - referencedByIndex：本段的内容在后文哪些行被引用，同样给行号数组；这是后面删除安全
     检查要用的，宁可多标不要漏标
3. diagnosis：结构问题诊断，例如"主线在第 200 行才出现，前面是铺垫""同一观点讲了三遍"
   "结尾没有收口"，每条一句话

【原则】只描述不评判删留；不确定某段是 tangent 还是 irrelevant 时标 tangent（宁可保守）。
段落之间的行号不能有遗漏或重叠——上一段的 endIndex 后一行就应该是下一段的 startIndex。

必须输出 JSON：
{"mainThread":"...","segments":[{"startIndex":整数,"endIndex":整数,"topic":"...",
"relation":"core|support|tangent|irrelevant","infoDensity":0到10,"tension":0到10,
"refsBackIndex":[整数...],"referencedByIndex":[整数...]}],"diagnosis":["...","..."]}`;

  const totalLines = context.segments.length;
  // 给一个具体的"平均每段多少行"参照，比单说"15-40 段"更容易让模型收着切——
  // 之前只给区间的时候，长稿子容易被切成上百段（按说话人切换分段而不是按话题）
  const avgLinesPerSegment = totalLines > 0 ? Math.round(totalLines / 25) : 0;

  const user = [
    `节目名：${context.showName}`,
    context.promoteNote ? `这期想传达的重点：${context.promoteNote}` : null,
    `全文共 ${totalLines} 行，按 25 段估算平均每段约 ${avgLinesPerSegment} 行——供参考，
实际按话题真实转折切，但如果发现自己切出的段落数远超过这个量级，说明切得太碎了，回头合并。`,
    "带行号的完整转录稿：",
    formatIndexedTranscript(context.segments),
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
  mainThread: string,
  diagnosis: string[],
  segments: StructuralSegment[],
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
    `主线：${mainThread}`,
    `风格档：${ROUGHCUT_STYLE_PRESETS[style].label}，目标时长约 ${Math.round(targetDurationSeconds)} 秒（原片 ${Math.round(segments[segments.length - 1]?.endSeconds ?? 0)} 秒）`,
    diagnosis.length > 0 ? `结构诊断：\n${diagnosis.map((d) => `- ${d}`).join("\n")}` : null,
    "段落列表（索引 [n] 对应下面决策里的 segmentIndex）：",
    formatSegmentsForPrompt(segments),
    instruction ? `\n用户对这版决策的修改要求：${instruction}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { system, user };
}
