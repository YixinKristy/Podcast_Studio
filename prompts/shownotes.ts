import { z } from "zod";
import type { MaterialDefinition, MaterialGenerationContext } from "@/lib/services/materials/types";
import { COMMON_SYSTEM_PROMPT_HEADER } from "./common";

// docs/13 三：Shownotes 是分块结构，简介/嘉宾介绍/提及清单/置顶互动问题各自独立生成、
// 独立 reroll、独立版本历史——四个都是真正的 MaterialDefinition，走跟标题/章节/宣传笔记
// 一样的统一契约，不是另起一套。时间轴章节复用 Tab4 的 chapters（UI 层只读引用，这里
// 不重复定义）。置顶互动问题是 05 号 PRD 原来 5 块没有的，13 号文档加的，跟 Yi 确认过
// 补成第 6 个独立块。

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
  const system = `${COMMON_SYSTEM_PROMPT_HEADER}

你是中文播客的 shownotes 编辑，负责写小宇宙格式的"本期简介"。必须输出 JSON：{"intro": "..."}
简介 80-150 字。第一句必须是钩子（人物设定或核心冲突），不要"本期我们聊了……"这类流水账开头。
示例结构："32 岁从国企出走成为心理咨询师的王老师，和主播聊了聊「30 岁转行」：为什么说稳定是幻觉、
转行前该做的三个测试、以及那段没有收入的一年他是怎么过来的。"`;

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
  const system = `${COMMON_SYSTEM_PROMPT_HEADER}

你是中文播客的 shownotes 编辑，负责写"嘉宾介绍"。必须输出 JSON：{"guestIntro": "..."}
只用逐字稿或用户填写的嘉宾信息中出现的事实，禁止根据名字推测头衔或经历。
没有嘉宾就返回空字符串，不要编造。`;

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
      type: z.enum(["书", "影视", "播客", "人物", "工具", "链接"]),
      timestampSeconds: z.number().min(0),
      note: z.string().optional(),
    }),
  ),
});

export type ShownotesMentionsContent = z.infer<typeof shownotesMentionsSchema>;

function buildMentionsPrompt(context: MaterialGenerationContext, instruction?: string) {
  const system = `${COMMON_SYSTEM_PROMPT_HEADER}

你是中文播客的 shownotes 编辑，负责写"本期提及"清单。必须输出 JSON：
{"mentions": [{"name": "...", "type": "书|影视|播客|人物|工具|链接", "timestampSeconds": 数字(秒), "note": "简短说明，选填"}]}
只抽取逐字稿中真实出现的书/影视/播客/人物/工具/链接，每项给出类型与出现的时间点（转录稿里
[mm:ss] 标注的时间戳换算成秒）。宁缺毋滥，不确定的不写，没有就返回空数组。`;

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

// ---- 置顶互动问题 ----

export const shownotesPinnedQuestionSchema = z.object({
  pinnedQuestion: z.string().min(1),
});

export type ShownotesPinnedQuestionContent = z.infer<typeof shownotesPinnedQuestionSchema>;

function buildPinnedQuestionPrompt(context: MaterialGenerationContext, instruction?: string) {
  const system = `${COMMON_SYSTEM_PROMPT_HEADER}

你是中文播客的 shownotes 编辑，负责写"置顶互动问题"。必须输出 JSON：{"pinnedQuestion": "..."}
一句话，必须是听众能用自身经历回答的具体问题（例如"你是思考派还是行动派？说一件你想了最久还没做的事"），
不是开放式空问（例如"你怎么看？"这种不合格）。`;

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

export const shownotesPinnedQuestionDefinition: MaterialDefinition<ShownotesPinnedQuestionContent> =
  {
    type: "shownotes_pinned_question",
    schema: shownotesPinnedQuestionSchema,
    buildPrompt: buildPinnedQuestionPrompt,
  };
