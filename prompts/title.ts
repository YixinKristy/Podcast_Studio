import { z } from "zod";
import type { MaterialDefinition, MaterialGenerationContext } from "@/lib/services/materials/types";
import { COMMON_SYSTEM_PROMPT_HEADER } from "./common";

export const titleSchema = z.object({
  candidates: z
    .array(
      z.object({
        style: z.enum(["悬念", "干货", "情绪", "提问", "金句引用"]),
        title: z.string().min(1).max(30),
        // docs/13：每条附一句话说明它抓的是什么人群
        audience: z.string().min(1),
      }),
    )
    .length(5),
});

export type TitleContent = z.infer<typeof titleSchema>;

function buildPrompt(context: MaterialGenerationContext, instruction?: string) {
  const system = `${COMMON_SYSTEM_PROMPT_HEADER}

你是中文播客的标题编辑，为本期生成 5 个候选标题，每个风格不同。必须输出 JSON：
{"candidates": [{"style": "悬念|干货|情绪|提问|金句引用", "title": "...", "audience": "一句话说明这条抓的是什么人群"}]}，
正好 5 条，五种风格各一条，金句引用那条的标题必须是转录稿里的原话。

标题公式（优先级从高到低）：
1. 具体处境 + 数字对照，例如"我换工作用了半年，她办婚礼只用两周"
2. 反常识断言，例如"稳定是这个时代最大的幻觉"
3. 精准提问（听众会对号入座），例如"想清楚再做，还是做了再想？"
4. 情绪具体化：避免"焦虑""迷茫"等大词，用具体场景替代

禁止：
- 抽象名词堆砌（"思考与行动""成长与选择"这类无信息量标题）
- 泛化情绪词（治愈、成长、感悟）
- 标题党式夸张（"震惊""必看"）
- 超过 30 字
- 编造嘉宾没说过的内容`;

  const user = [
    `节目名：${context.showName}`,
    context.promoteNote ? `这期想传达的重点：${context.promoteNote}` : null,
    context.guests.length > 0 ? `本期嘉宾：${context.guests.map((g) => g.name).join("、")}` : null,
    context.recentTitles.length > 0
      ? `参考往期标题风格（延续这档节目一贯的语气，不要照抄）：\n${context.recentTitles.map((t) => `- ${t}`).join("\n")}`
      : null,
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
