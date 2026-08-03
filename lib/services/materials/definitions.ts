import { titleDefinition } from "@/prompts/title";
import { shownotesDefinition } from "@/prompts/shownotes";
import { chaptersDefinition } from "@/prompts/chapters";
import { noteDefinition } from "@/prompts/note";
import type { TextMaterialType } from "./types";

export const TEXT_MATERIAL_DEFINITIONS = {
  title: titleDefinition,
  shownotes: shownotesDefinition,
  chapters: chaptersDefinition,
  note: noteDefinition,
} as const satisfies Record<TextMaterialType, unknown>;

export function isTextMaterialType(value: string): value is TextMaterialType {
  return value in TEXT_MATERIAL_DEFINITIONS;
}
