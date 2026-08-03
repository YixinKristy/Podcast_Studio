import { z } from "zod";
import type { MaterialDefinition, MaterialGenerationContext } from "@/lib/services/materials/types";

export const titleSchema = z.object({
  candidates: z
    .array(
      z.object({
        style: z.enum(["悬念", "干货", "情绪", "提问", "金句引用"]),
        title: z.string().min(1).max(40),
      }),
    )
    .length(5),
});

export type TitleContent = z.infer<typeof titleSchema>;

function buildPrompt(context: MaterialGenerationContext, instruction?: string) {
  const system = `你是中文播客的标题编辑，擅长写吸引点击但不夸张失真的标题。
必须输出 JSON，格式：{"candidates": [{"style": "悬念|干货|情绪|提问|金句引用", "title": "..."}]}，正好 5 条，每种风格各一条。
标题控制在 25 字以内，不要用书名号、引号包裹整个标题，不要编造嘉宾没说过的内容。`;

  const user = [
    `节目名：${context.showName}`,
    context.promoteNote ? `这期想传达的重点：${context.promoteNote}` : null,
    context.guests.length > 0 ? `本期嘉宾：${context.guests.map((g) => g.name).join("、")}` : null,
    "完整转录稿：",
    context.transcriptText,
    instruction ? `\n用户对这批标题的修改要求：${instruction}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { system, user };
}

export const titleDefinition: MaterialDefinition<TitleContent> = {
  type: "title",
  schema: titleSchema,
  buildPrompt,
};
