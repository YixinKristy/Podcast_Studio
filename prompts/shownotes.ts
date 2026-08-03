import { z } from "zod";
import type { MaterialDefinition, MaterialGenerationContext } from "@/lib/services/materials/types";

export const shownotesSchema = z.object({
  intro: z.string().min(1),
  mentions: z.array(
    z.object({
      name: z.string(),
      type: z.enum(["书", "影", "人", "链接"]),
      note: z.string().optional(),
    }),
  ),
  guestIntro: z.string().optional(),
});

export type ShownotesContent = z.infer<typeof shownotesSchema>;

function buildPrompt(context: MaterialGenerationContext, instruction?: string) {
  const system = `你是中文播客的 shownotes 编辑。必须输出 JSON：
{"intro": "本期简介，2-4 句话", "mentions": [{"name": "...", "type": "书|影|人|链接", "note": "简短说明，选填"}], "guestIntro": "嘉宾介绍，没有嘉宾就留空字符串"}
intro 要交代清楚这期聊了什么、为什么值得听，不要剧透式罗列每个话题。
mentions 只收录转录稿里明确提到的书/电影/人物/网站等具体实体，不要过度联想，没有就返回空数组。`;

  const user = [
    `节目名：${context.showName}`,
    context.showIntro ? `节目简介：${context.showIntro}` : null,
    context.promoteNote ? `这期想传达的重点：${context.promoteNote}` : null,
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

export const shownotesDefinition: MaterialDefinition<ShownotesContent> = {
  type: "shownotes",
  schema: shownotesSchema,
  buildPrompt,
};
