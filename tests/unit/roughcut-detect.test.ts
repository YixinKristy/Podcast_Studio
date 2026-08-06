import { describe, expect, it } from "vitest";
import { detectL1Suggestions, isFillerOnlySegment } from "@/lib/services/roughcut/detect";
import type { TranscriptSegment } from "@/lib/services/transcript";

describe("isFillerOnlySegment", () => {
  it("单独一句纯填充词判定为 true", () => {
    expect(isFillerOnlySegment("嗯。")).toBe(true);
    expect(isFillerOnlySegment("啊")).toBe(true);
    expect(isFillerOnlySegment("那个那个")).toBe(true);
    expect(isFillerOnlySegment("就是说")).toBe(true);
  });

  it("混合了填充词和真实内容的句子不算——没有词级时间戳切不出来", () => {
    expect(isFillerOnlySegment("嗯，我觉得这个事情挺有意思的")).toBe(false);
    expect(isFillerOnlySegment("那个，我们今天聊聊友情")).toBe(false);
  });

  it("空字符串不算", () => {
    expect(isFillerOnlySegment("")).toBe(false);
    expect(isFillerOnlySegment("。")).toBe(false);
  });
});

describe("detectL1Suggestions", () => {
  it("识别纯填充词句子", () => {
    const segments: TranscriptSegment[] = [
      { text: "今天天气不错", speaker: "0", start: 0, end: 3 },
      { text: "嗯。", speaker: "0", start: 3, end: 4 },
      { text: "我们开始录节目吧", speaker: "0", start: 4, end: 7 },
    ];
    const suggestions = detectL1Suggestions(segments);
    const fillers = suggestions.filter((s) => s.type === "filler");
    expect(fillers).toHaveLength(1);
    expect(fillers[0]).toMatchObject({ startSeconds: 3, endSeconds: 4 });
  });

  it("识别超过 2.5s 的长停顿", () => {
    const segments: TranscriptSegment[] = [
      { text: "第一句", speaker: "0", start: 0, end: 2 },
      { text: "第二句", speaker: "0", start: 5, end: 7 }, // 2->5, 停顿 3s
      { text: "第三句", speaker: "0", start: 8, end: 10 }, // 7->8，停顿 1s，不够
    ];
    const suggestions = detectL1Suggestions(segments);
    const pauses = suggestions.filter((s) => s.type === "long_pause");
    expect(pauses).toHaveLength(1);
    expect(pauses[0]).toMatchObject({ startSeconds: 2, endSeconds: 5 });
  });

  it("空转录稿不报错，返回空数组", () => {
    expect(detectL1Suggestions([])).toEqual([]);
  });

  it("建议按时间排序", () => {
    const segments: TranscriptSegment[] = [
      { text: "嗯。", speaker: "0", start: 10, end: 11 },
      { text: "第一句", speaker: "0", start: 0, end: 2 },
      { text: "第二句", speaker: "0", start: 15, end: 17 },
    ];
    const suggestions = detectL1Suggestions(segments);
    const starts = suggestions.map((s) => s.startSeconds);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });
});
