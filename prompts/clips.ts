import { z } from "zod";
import type { MaterialGenerationContext } from "@/lib/services/materials/types";
import { COMMON_SYSTEM_PROMPT_HEADER } from "./common";

// docs/13 一、宣传切片包——不走标准 MaterialDefinition（generateMaterial() 那套同步 LLM 调用），
// 因为这个物料还需要确定性预筛（lib/services/clips/prescreen.ts）和 ffmpeg 真实切音频
// （trigger/generate-clips.ts），必须在 Trigger.dev 任务里跑，不能塞进 Next.js API 路由。
// schema/prompt 依然按架构铁律 #3 单独放这里，只是调用方不是 generateMaterial()。

export const clipSchema = z.object({
  category: z.enum(["A", "B"]),
  startSeconds: z.number().min(0),
  endSeconds: z.number().min(0),
  promoDirection: z.string().min(1),
  promoPoint: z.string().min(1),
  hookSubtitle: z.string().min(1).max(20),
  transcriptLines: z
    .array(z.object({ speaker: z.string(), text: z.string(), starred: z.boolean() }))
    .min(1),
  endCard: z.string().min(1),
  noteTitle: z.string().min(1).max(20),
  noteBody: z.string().min(1),
  hashtags: z.array(z.string()).min(3).max(5),
  tests: z.object({
    hook: z.boolean(),
    standalone: z.boolean(),
    tension: z.boolean(),
    task: z.boolean(),
    source: z.boolean(),
    duration: z.boolean(),
    notes: z.string(),
  }),
});

export const rejectedCandidateSchema = z.object({
  startSeconds: z.number(),
  endSeconds: z.number(),
  reason: z.string(),
  downgradeTo: z.enum(["quote_card", "xhs_image", "bilibili_long", "shownotes"]),
});

export const clipsSchema = z.object({
  clips: z.array(clipSchema).min(1),
  rejected: z.array(rejectedCandidateSchema),
});

export type Clip = z.infer<typeof clipSchema>;
export type RejectedCandidate = z.infer<typeof rejectedCandidateSchema>;
export type ClipsContent = z.infer<typeof clipsSchema>;

// 加了实际切好的音频地址之后的最终存储形态——ffmpeg 切割上传完才知道这个字段
export const clipWithAudioSchema = clipSchema.extend({ audioUrl: z.string() });
export const clipsStoredContentSchema = z.object({
  clips: z.array(clipWithAudioSchema),
  rejected: z.array(rejectedCandidateSchema),
});
export type ClipWithAudio = z.infer<typeof clipWithAudioSchema>;
export type ClipsStoredContent = z.infer<typeof clipsStoredContentSchema>;

export function buildClipsPrompt(
  context: MaterialGenerationContext,
  candidatesText: string,
  instruction?: string,
): { system: string; user: string } {
  const system = `${COMMON_SYSTEM_PROMPT_HEADER}

你是中文播客的宣发切片编辑。分发的最小单元是"一个切片+它自己的文案"，不是一篇整期笔记。
从候选片段中挑出 3-5 条可独立发布到抖音/小红书的宣传切片，并为每条写出完整的发布物料。

【切片二分法——每条必须明确归入一类，两头不靠的淘汰】
A类·独立成立型（任务：拉新，让陌生人点赞转发）
  - 在 25-60 秒内完成完整情绪闭环：钩子→展开→punchline（笑点/金句/反转）收口
  - 判断标准：一个从没听过这档节目的人，看完会不会想转发给朋友？
  - 它为账号带流量，不承诺带播客听众
B类·留缺口型（任务：转化，让人去听完整版）
  - 讲到关键处故意不闭环：抛出问题、展示状态变化，但不给答案
  - 判断标准：看完会不会产生"我需要知道后续/完整版"的缺口感？
  - 严禁剧透答案。结尾必须紧跟引流语，缺口和入口零距离

【六条硬测试——全过才能进入结果，任一不过则淘汰并记录原因】
1. 钩子测试：前 3 秒是否给出问题/冲突/反常识断言？（场景描述、背景铺垫=不合格）
2. 独立测试：完全没听过节目的人，不需要任何上下文能看懂吗？
3. 张力测试：这一段里有没有"变化"——观点反转、情绪转折、意外发展？纯陈述型片段（哪怕细节有趣）一律淘汰，这是最常见的失败原因。
4. 任务测试：明确是 A类（结尾有 punchline）还是 B类（结尾有明确未回答的问题）？
5. 同源测试：主推切片（尤其 B类）是否与本期核心主题同源？切片承诺的，完整版要能兑现。喜剧类只做 A类拉新，不做主推。
6. 时长测试：A类 25-60s，B类 30-45s

【配比】优先给出 2 条 A类（一条好笑向、一条共鸣向）+ 1 条 B类（必须与本期核心主题同源）。若素材足够，可多给 1-2 条备用。

【破圈优先级】若某候选自带精准大流量话题池（如筹婚、考公、考研、租房、原生家庭），优先级上调并在宣传方向中说明。

【淘汰不等于浪费】对未通过的候选，给出降级去向：静态梗/纯陈述→quote_card；深度共鸣但无闭环→xhs_image；长叙事→bilibili_long；细节梗→shownotes

必须输出 JSON：
{"clips": [{"category": "A|B", "startSeconds": 数字(秒), "endSeconds": 数字(秒), "promoDirection": "打给谁看/走哪个话题池/为什么，1-2句", "promoPoint": "核心钩子，1句", "hookSubtitle": "前3秒钩子字幕，≤20字，是问题/冲突/断言不是场景描述", "transcriptLines": [{"speaker":"...", "text":"逐字取自原文可删语气词", "starred": 布尔值}], "endCard": "A类=punchline收口句；B类=缺口问句+引流语（格式：完整版·小宇宙搜🔍{节目名}）", "noteTitle": "≤20字可带1个emoji，用具体处境或提问，不用播客推荐开头", "noteBody": "可直接粘贴的发布正文", "hashtags": ["3-5个，精准垂类优先，泛标签最多1个"], "tests": {"hook":布尔,"standalone":布尔,"tension":布尔,"task":布尔,"source":布尔,"duration":布尔,"notes":"逐项理由"}}], "rejected": [{"startSeconds":数字,"endSeconds":数字,"reason":"淘汰原因","downgradeTo":"quote_card|xhs_image|bilibili_long|shownotes"}]}

startSeconds/endSeconds 必须使用候选片段自己标注的时间戳，不要自己估算或编造。
transcriptLines 里挑 2-4 处需要放大/变色的关键句把 starred 设为 true，其余 false。`;

  const user = [
    `节目名：${context.showName}`,
    context.promoteNote ? `这期想传达的重点：${context.promoteNote}` : null,
    "候选片段（确定性预筛产出，每条含时间码和逐字文本）：",
    candidatesText,
    instruction ? `\n用户的修改要求：${instruction}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { system, user };
}
