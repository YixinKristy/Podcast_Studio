import { titleDefinition } from "@/prompts/title";
import {
  shownotesIntroDefinition,
  shownotesGuestIntroDefinition,
  shownotesMentionsDefinition,
} from "@/prompts/shownotes";
import { chaptersDefinition } from "@/prompts/chapters";
import { noteDefinition } from "@/prompts/note";
import type { TextMaterialType } from "./types";

export const TEXT_MATERIAL_DEFINITIONS = {
  title: titleDefinition,
  shownotes_intro: shownotesIntroDefinition,
  shownotes_guest_intro: shownotesGuestIntroDefinition,
  shownotes_mentions: shownotesMentionsDefinition,
  chapters: chaptersDefinition,
  note: noteDefinition,
} as const satisfies Record<TextMaterialType, unknown>;

export function isTextMaterialType(value: string): value is TextMaterialType {
  return value in TEXT_MATERIAL_DEFINITIONS;
}

// 切片（clips）也是"有生成器"的物料类型，但它不经过 generateMaterial() 那套同步 LLM 调用
// （见 trigger/generate-clips.ts 的注释），所以不在 TEXT_MATERIAL_DEFINITIONS 里，
// 但 confirm/edit/restore 这些跟"具体怎么生成的"无关的路由，判断"这是不是个合法物料类型"
// 时要把它也算进去
export function isGeneratableMaterialType(value: string): value is TextMaterialType | "clips" {
  return isTextMaterialType(value) || value === "clips";
}

// 上传页的"生成项"勾选是粗粒度概念（要不要 shownotes），但 shownotes 内部拆成了三个
// 独立生成的物料类型。批量触发/状态机检查这些地方要按粗粒度展开成实际的物料类型列表。
export function expandRequestedType(requested: string): TextMaterialType[] {
  if (requested === "shownotes") {
    return ["shownotes_intro", "shownotes_guest_intro", "shownotes_mentions"];
  }
  return isTextMaterialType(requested) ? [requested] : [];
}
