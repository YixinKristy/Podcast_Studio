import { z } from "zod";
import type { MaterialDefinition, MaterialGenerationContext } from "@/lib/services/materials/types";

// docs/04/05：Shownotes 是分块结构，简介/嘉宾介绍/提及清单各自独立生成、独立 reroll、
// 独立版本历史——三个都是真正的 MaterialDefinition，走跟标题/章节/宣传笔记一样的统一契约，
// 不是另起一套。时间轴章节复用 Tab4 的 chapters（UI 层只读引用，这里不重复定义）。

function baseContext(context: MaterialGenerationContext) {
  return [
    `节目名：${context.showName}`,
    context.showIntro ? `节目简介：${context.showIntro}` : null,
    context.promoteNote ? `这期想传达的重点：${context.promoteNote}` : null,
  ].filter(Boolean);
}

// ---- 本期简介 ----

export const shownotesIntroSchema = z.object({
  intro: z.string().min(1),
});

export type ShownotesIntroContent = z.infer<typeof shownotesIntroSchema>;

function buildIntroPrompt(context: MaterialGenerationContext, instruction?: string) {
  const system = `你是中文播客的 shownotes 编辑。必须输出 JSON：{"intro": "本期简介，2-4 句话"}
要交代清楚这期聊了什么、为什么值得听，不要剧透式罗列每个话题。`;

  const user = [
    ...baseContext(context),
    "完整转录稿：",
    context.transcriptText,
    instruction ? `\n用户的修改要求：${instruction}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { system, user };
}

export const shownotesIntroDefinition: MaterialDefinition<ShownotesIntroContent> = {
  type: "shownotes_intro",
  schema: shownotesIntroSchema,
  buildPrompt: buildIntroPrompt,
};

// ---- 嘉宾介绍 ----

export const shownotesGuestIntroSchema = z.object({
  guestIntro: z.string(),
});

export type ShownotesGuestIntroContent = z.infer<typeof shownotesGuestIntroSchema>;

function buildGuestIntroPrompt(context: MaterialGenerationContext, instruction?: string) {
  const system = `你是中文播客的 shownotes 编辑。必须输出 JSON：{"guestIntro": "嘉宾介绍"}
没有嘉宾就返回空字符串，不要编造。有嘉宾的话根据转录稿里嘉宾自己或主播提到的信息写，不要杜撰简历。`;

  const user = [
    ...baseContext(context),
    context.guests.length > 0
      ? `本期嘉宾：${context.guests.map((g) => `${g.name}${g.role ? `（${g.role}）` : ""}`).join("、")}`
      : "本期没有嘉宾，guestIntro 返回空字符串",
    "完整转录稿：",
    context.transcriptText,
    instruction ? `\n用户的修改要求：${instruction}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { system, user };
}

export const shownotesGuestIntroDefinition: MaterialDefinition<ShownotesGuestIntroContent> = {
  type: "shownotes_guest_intro",
  schema: shownotesGuestIntroSchema,
  buildPrompt: buildGuestIntroPrompt,
};

// ---- 提及清单 ----

export const shownotesMentionsSchema = z.object({
  mentions: z.array(
    z.object({
      name: z.string(),
      type: z.enum(["书", "影", "人", "链接"]),
      note: z.string().optional(),
    }),
  ),
});

export type ShownotesMentionsContent = z.infer<typeof shownotesMentionsSchema>;

function buildMentionsPrompt(context: MaterialGenerationContext, instruction?: string) {
  const system = `你是中文播客的 shownotes 编辑。必须输出 JSON：
{"mentions": [{"name": "...", "type": "书|影|人|链接", "note": "简短说明，选填"}]}
只收录转录稿里明确提到的书/电影/人物/网站等具体实体，不要过度联想，没有就返回空数组。`;

  const user = [
    ...baseContext(context),
    "完整转录稿：",
    context.transcriptText,
    instruction ? `\n用户的修改要求：${instruction}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { system, user };
}

export const shownotesMentionsDefinition: MaterialDefinition<ShownotesMentionsContent> = {
  type: "shownotes_mentions",
  schema: shownotesMentionsSchema,
  buildPrompt: buildMentionsPrompt,
};
