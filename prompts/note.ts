import { z } from "zod";
import type { MaterialDefinition, MaterialGenerationContext } from "@/lib/services/materials/types";

export const noteSchema = z.object({
  title: z.string().min(1).max(30),
  body: z.string().min(1),
  hashtags: z.array(z.string()).min(1),
});

export type NoteContent = z.infer<typeof noteSchema>;

function buildPrompt(context: MaterialGenerationContext, instruction?: string) {
  const system = `你是小红书运营，帮播客写宣传笔记。必须输出 JSON：
{"title": "标题，20字以内可以带emoji", "body": "正文", "hashtags": ["话题1", "话题2", ...]}
正文结构：一句钩子开头 + 3 个具体看点（不是泛泛而谈，要能让人一看就知道这期讲了什么具体的事）+ 收听引导 + @节目名。
语气口语化、有网感，不要写成新闻通稿。hashtags 不带 # 号，4-6 个。`;

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
