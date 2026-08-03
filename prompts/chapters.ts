import { z } from "zod";
import type { MaterialDefinition, MaterialGenerationContext } from "@/lib/services/materials/types";

export const chaptersSchema = z.object({
  chapters: z
    .array(
      z.object({
        startSeconds: z.number().min(0),
        title: z.string().min(1).max(30),
      }),
    )
    .min(1),
});

export type ChaptersContent = z.infer<typeof chaptersSchema>;

function buildPrompt(context: MaterialGenerationContext, instruction?: string) {
  const system = `你是中文播客的章节划分编辑。必须输出 JSON：{"chapters": [{"startSeconds": 数字(秒), "title": "章节名，15字以内"}]}
章节按话题自然分段，一般 4-8 个章节，第一个 startSeconds 必须是 0。
startSeconds 必须使用转录稿里出现过的时间戳（转录稿每行前面 [mm:ss] 就是时间戳），换算成秒填进去，不要自己估算或编造时间点。`;

  const user = [
    `节目名：${context.showName}`,
    context.promoteNote ? `这期想传达的重点：${context.promoteNote}` : null,
    "带时间戳的完整转录稿：",
    context.transcriptText,
    instruction ? `\n用户的修改要求：${instruction}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { system, user };
}

// docs/10 ★2：边界要吸附到真实存在的语轮起点，不能相信 LLM 自己报的时间戳有多准。
// 找离 LLM 给出的 startSeconds 最近的"说话人新一轮发言"起点。
export function snapToTurnStart(startSeconds: number, context: MaterialGenerationContext): number {
  const segments = context.segments;
  if (segments.length === 0) return startSeconds;

  const turnStarts: number[] = [];
  let lastSpeaker: string | null = null;
  for (const seg of segments) {
    if (seg.speaker !== lastSpeaker) {
      turnStarts.push(seg.start);
      lastSpeaker = seg.speaker;
    }
  }
  if (turnStarts.length === 0) return startSeconds;

  return turnStarts.reduce((closest, candidate) =>
    Math.abs(candidate - startSeconds) < Math.abs(closest - startSeconds) ? candidate : closest,
  );
}

export function postProcess(
  content: ChaptersContent,
  context: MaterialGenerationContext,
): ChaptersContent {
  const snapped = content.chapters
    .map((c) => ({ ...c, startSeconds: snapToTurnStart(c.startSeconds, context) }))
    .sort((a, b) => a.startSeconds - b.startSeconds);
  if (snapped.length > 0) snapped[0]!.startSeconds = 0;
  return { chapters: snapped };
}

export const chaptersDefinition: MaterialDefinition<ChaptersContent> = {
  type: "chapters",
  schema: chaptersSchema,
  buildPrompt,
  postProcess,
};
