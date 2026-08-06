import { describe, expect, it } from "vitest";
import { computeKeptRanges } from "@/lib/services/roughcut/ranges";

describe("computeKeptRanges", () => {
  it("没有勾选任何要剪的建议时，保留整段", () => {
    expect(computeKeptRanges([], 100)).toEqual([
      { startSeconds: 0, endSeconds: 100, fadeIn: false, fadeOut: false },
    ]);
  });

  it("中间剪掉一段，前后各保留一段，剪切点两侧要淡入淡出", () => {
    const kept = computeKeptRanges([{ startSeconds: 30, endSeconds: 40 }], 100);
    expect(kept).toEqual([
      { startSeconds: 0, endSeconds: 30, fadeIn: false, fadeOut: true },
      { startSeconds: 40, endSeconds: 100, fadeIn: true, fadeOut: false },
    ]);
  });

  it("重叠的剪切区间会先合并，不会产生负长度或重复的保留段", () => {
    const kept = computeKeptRanges(
      [
        { startSeconds: 10, endSeconds: 20 },
        { startSeconds: 15, endSeconds: 25 },
      ],
      50,
    );
    expect(kept).toEqual([
      { startSeconds: 0, endSeconds: 10, fadeIn: false, fadeOut: true },
      { startSeconds: 25, endSeconds: 50, fadeIn: true, fadeOut: false },
    ]);
  });

  it("剪掉开头和结尾，只保留中间那一段——两侧都紧邻剪切点，都要淡入淡出", () => {
    const kept = computeKeptRanges(
      [
        { startSeconds: 0, endSeconds: 10 },
        { startSeconds: 90, endSeconds: 100 },
      ],
      100,
    );
    expect(kept).toEqual([{ startSeconds: 10, endSeconds: 90, fadeIn: true, fadeOut: true }]);
  });

  it("全部剪掉时返回空数组", () => {
    expect(computeKeptRanges([{ startSeconds: 0, endSeconds: 100 }], 100)).toEqual([]);
  });

  it("总时长为 0 时返回空数组，不报错", () => {
    expect(computeKeptRanges([], 0)).toEqual([]);
  });
});
