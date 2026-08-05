import { z } from "zod";
import type { MaterialDefinition, MaterialGenerationContext } from "@/lib/services/materials/types";
import { COMMON_SYSTEM_PROMPT_HEADER } from "./common";

export const noteSchema = z.object({
  title: z.string().min(1).max(20),
  body: z.string().min(1),
  hashtags: z.array(z.string()).min(5).max(7),
});

export type NoteContent = z.infer<typeof noteSchema>;

function buildPrompt(context: MaterialGenerationContext, instruction?: string) {
  const system = `${COMMON_SYSTEM_PROMPT_HEADER}

你是小红书运营，帮播客写一篇整期宣传笔记（辅助物料，主力是切片包）。必须输出 JSON：
{"title": "...", "body": "...", "hashtags": ["话题1", "话题2", ...]}

标题：≤20 字，含 1 个 emoji，用具体处境或提问，不用"播客推荐"开头。

正文结构（按顺序）：
1. 第一行钩子（具体场景或数字对照，不是介绍节目）
2. 3 个看点（每个一行，带序号 emoji，具体到内容不是形容词）
3. 收听引导，格式："完整版 XX 分钟 · 小宇宙搜🔍${context.showName}"
4. 互动引导：一句能让人评论的具体问题

话题标签：5-7 个，垂类精准优先，#播客推荐 这类泛标签最多 1 个，不带 # 号。

风格：像一个真实用户在推荐自己喜欢的节目，不像品牌文案，不要写成新闻通稿。`;

  const user = [
    `节目名：${context.showName}`,
    context.promoteNote ? `这期想宣传的重点：${context.promoteNote}` : null,
    context.guests.length > 0 ? `本期嘉宾：${context.guests.map((g) => g.name).join("、")}` : null,
    "完整转录稿：",
    context.transcriptText,
    instruction ? `\n用户的修改要求：${instruction}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { system, user };
}

export const noteDefinition: MaterialDefinition<NoteContent> = {
  type: "note",
  schema: noteSchema,
  buildPrompt,
};
