import type { ZodType } from "zod";
import type { TranscriptSegment } from "@/lib/services/transcript";
import type { Guest } from "@/lib/services/episode";

// 目前只实现文本四件套；封面/金句/切片是配置型或需要两级漏斗，不走这套统一 generate 流程
export type TextMaterialType = "title" | "shownotes" | "chapters" | "note";

export interface MaterialGenerationContext {
  episodeId: string;
  showName: string;
  showIntro: string | null;
  promoteNote: string | null;
  guests: Guest[];
  transcriptText: string;
  segments: TranscriptSegment[];
}

// 架构铁律 #2：物料生成器统一接口——generate/regenerate(instruction)/validate/version。
// 这里用一个"定义 + 共享 orchestrator"的函数式写法实现同一个契约，而不是字面上的 OOP 基类，
// 跟这个代码库其它地方的风格一致（lib/services 下都是纯函数）。
export interface MaterialDefinition<T> {
  type: TextMaterialType;
  schema: ZodType<T>;
  buildPrompt(
    context: MaterialGenerationContext,
    instruction?: string,
  ): { system: string; user: string };
  // 生成型物料的后处理，比如章节时间戳吸附句边界；配置型物料不需要
  postProcess?: (content: T, context: MaterialGenerationContext) => T;
}
