import type { ZodType } from "zod";
import type { TranscriptSegment } from "@/lib/services/transcript";
import type { Guest } from "@/lib/services/episode";

// 目前只实现文本几件套；封面/金句/切片是配置型或需要两级漏斗，不走这套统一 generate 流程。
// shownotes 按产品设计拆成四个独立生成/独立版本历史的块（简介/嘉宾介绍/提及清单/
// 置顶互动问题——最后这个是 docs/13 加的，05 号 PRD 原来的 5 块没有，跟 Yi 确认过加进来）。
// 时间轴章节复用 chapters（只读引用，不重复存储），固定尾部依赖节目设置页，还没做。
export type TextMaterialType =
  | "title"
  | "shownotes_intro"
  | "shownotes_guest_intro"
  | "shownotes_mentions"
  | "shownotes_pinned_question"
  | "chapters"
  | "note";

export interface MaterialGenerationContext {
  episodeId: string;
  showName: string;
  showIntro: string | null;
  promoteNote: string | null;
  guests: Guest[];
  transcriptText: string;
  segments: TranscriptSegment[];
  // docs/13 通用上下文块："往期标题风格样例"——同一节目过去确认过的标题候选，
  // 没有就是空数组，prompt 里对应那行直接省略
  recentTitles: string[];
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
