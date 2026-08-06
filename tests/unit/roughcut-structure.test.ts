import { describe, expect, it } from "vitest";
import { resolveStructuralSegments, type RawStructuralSegment } from "@/prompts/roughcut";
import type { TranscriptSegment } from "@/lib/services/transcript";

const TRANSCRIPT: TranscriptSegment[] = [
  { text: "a", speaker: "0", start: 0, end: 5 },
  { text: "b", speaker: "1", start: 5, end: 12 },
  { text: "c", speaker: "0", start: 12, end: 20 },
  { text: "d", speaker: "1", start: 20, end: 30 },
];

function rawSegment(overrides: Partial<RawStructuralSegment>): RawStructuralSegment {
  return {
    startIndex: 0,
    endIndex: 0,
    topic: "测试话题",
    relation: "core",
    infoDensity: 5,
    tension: 5,
    refsBackIndex: [],
    referencedByIndex: [],
    ...overrides,
  };
}

describe("resolveStructuralSegments", () => {
  it("把行号解析成真实转录行对应的秒数——不是 LLM 自己报的数字", () => {
    const result = resolveStructuralSegments(
      [rawSegment({ startIndex: 1, endIndex: 2 })],
      TRANSCRIPT,
    );
    expect(result[0]!.startSeconds).toBe(5);
    expect(result[0]!.endSeconds).toBe(20);
  });

  it("refsBackIndex/referencedByIndex 也解析成对应转录行的起点秒数", () => {
    const result = resolveStructuralSegments(
      [rawSegment({ startIndex: 3, endIndex: 3, refsBackIndex: [0, 1], referencedByIndex: [2] })],
      TRANSCRIPT,
    );
    expect(result[0]!.refsBack).toEqual([0, 5]);
    expect(result[0]!.referencedBy).toEqual([12]);
  });

  it("越界的行号 clamp 到合法范围，而不是丢弃整条或报错", () => {
    const result = resolveStructuralSegments(
      [rawSegment({ startIndex: 2, endIndex: 99 })],
      TRANSCRIPT,
    );
    expect(result[0]!.startSeconds).toBe(12);
    expect(result[0]!.endSeconds).toBe(30);
  });

  it("endIndex 小于 startIndex 时 clamp 成不早于 startIndex，避免负长度区间", () => {
    const result = resolveStructuralSegments(
      [rawSegment({ startIndex: 3, endIndex: 1 })],
      TRANSCRIPT,
    );
    expect(result[0]!.startSeconds).toBe(20);
    expect(result[0]!.endSeconds).toBe(30);
  });

  it("转录稿为空时返回空数组，不报错", () => {
    expect(resolveStructuralSegments([rawSegment({})], [])).toEqual([]);
  });
});
