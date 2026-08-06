import { describe, expect, it } from "vitest";
import { filterValidL2Suggestions } from "@/lib/services/roughcut/generate";
import type { RoughCutSuggestion } from "@/prompts/roughcut";

function suggestion(overrides: Partial<RoughCutSuggestion>): RoughCutSuggestion {
  return {
    layer: "L2",
    type: "redundant",
    startSeconds: 10,
    endSeconds: 20,
    reason: "测试",
    confidence: 0.9,
    ...overrides,
  };
}

describe("filterValidL2Suggestions", () => {
  it("时间戳在录音时长内的建议原样保留", () => {
    const result = filterValidL2Suggestions(
      [suggestion({ startSeconds: 10, endSeconds: 20 })],
      100,
    );
    expect(result).toEqual([suggestion({ startSeconds: 10, endSeconds: 20 })]);
  });

  it("起点就超出录音总时长——大模型幻觉出来的时间戳，整条丢弃", () => {
    const result = filterValidL2Suggestions(
      [suggestion({ startSeconds: 6595, endSeconds: 6641 })],
      4014,
    );
    expect(result).toEqual([]);
  });

  it("起点合法但终点超出总时长——截断到总时长，不整条丢弃", () => {
    const result = filterValidL2Suggestions(
      [suggestion({ startSeconds: 4000, endSeconds: 4020 })],
      4014,
    );
    expect(result).toEqual([suggestion({ startSeconds: 4000, endSeconds: 4014 })]);
  });

  it("终点早于或等于起点的退化区间会被丢弃", () => {
    const result = filterValidL2Suggestions(
      [suggestion({ startSeconds: 30, endSeconds: 30 })],
      100,
    );
    expect(result).toEqual([]);
  });
});
