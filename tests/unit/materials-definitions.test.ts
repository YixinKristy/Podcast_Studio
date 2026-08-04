import { describe, expect, it } from "vitest";
import { expandRequestedType, isTextMaterialType } from "@/lib/services/materials/definitions";

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

  it("还没实现生成器的类型（封面/金句/切片）返回空数组，不是硬编两个假类型", () => {
    expect(expandRequestedType("cover")).toEqual([]);
    expect(expandRequestedType("quotes")).toEqual([]);
    expect(expandRequestedType("clips")).toEqual([]);
  });
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
});
