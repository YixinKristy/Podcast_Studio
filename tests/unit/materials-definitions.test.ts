import { describe, expect, it } from "vitest";
import {
  expandRequestedType,
  isGeneratableMaterialType,
  isTextMaterialType,
} from "@/lib/services/materials/definitions";

describe("expandRequestedType", () => {
  it("shownotes 展开成三个独立生成的块", () => {
    expect(expandRequestedType("shownotes")).toEqual([
      "shownotes_intro",
      "shownotes_guest_intro",
      "shownotes_mentions",
    ]);
  });

  it("已经是具体物料类型的原样返回", () => {
    expect(expandRequestedType("title")).toEqual(["title"]);
    expect(expandRequestedType("chapters")).toEqual(["chapters"]);
  });

  it("还没实现生成器的类型（封面/金句）返回空数组，不是硬编两个假类型", () => {
    expect(expandRequestedType("cover")).toEqual([]);
    expect(expandRequestedType("quotes")).toEqual([]);
  });

  it(
    "clips 走单独的生成路径（不经过 generateMaterial），这里也返回空数组——" +
      "由 maybeCompleteGeneration 单独追踪",
    () => {
      expect(expandRequestedType("clips")).toEqual([]);
    },
  );
});

describe("isTextMaterialType", () => {
  it("shownotes 本身不再是一个有效的物料类型——它只是展开前的粗粒度标签", () => {
    expect(isTextMaterialType("shownotes")).toBe(false);
  });

  it("三个 shownotes 块都是有效的物料类型", () => {
    expect(isTextMaterialType("shownotes_intro")).toBe(true);
    expect(isTextMaterialType("shownotes_guest_intro")).toBe(true);
    expect(isTextMaterialType("shownotes_mentions")).toBe(true);
  });

  it("clips 不算文本物料类型（它不走 generateMaterial 那套同步 LLM 调用）", () => {
    expect(isTextMaterialType("clips")).toBe(false);
  });
});

describe("isGeneratableMaterialType", () => {
  it("文本物料类型和 clips 都算——confirm/edit/restore 这些跟生成方式无关的路由要认它们", () => {
    expect(isGeneratableMaterialType("title")).toBe(true);
    expect(isGeneratableMaterialType("clips")).toBe(true);
  });

  it("还没实现生成器的类型不算", () => {
    expect(isGeneratableMaterialType("cover")).toBe(false);
    expect(isGeneratableMaterialType("quotes")).toBe(false);
  });
});
