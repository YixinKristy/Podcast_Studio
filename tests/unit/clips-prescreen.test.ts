import { describe, expect, it } from "vitest";
import { computeTurns } from "@/lib/services/clips/turns";
import {
  prescreenCandidates,
  MIN_WINDOW_SECONDS,
  MAX_WINDOW_SECONDS,
} from "@/lib/services/clips/prescreen";
import type { TranscriptSegment } from "@/lib/services/transcript";

describe("computeTurns", () => {
  it("groups consecutive same-speaker segments into one turn", () => {
    const segments: TranscriptSegment[] = [
      { text: "a", speaker: "0", start: 0, end: 5 },
      { text: "b", speaker: "0", start: 5, end: 10 },
      { text: "c", speaker: "1", start: 10, end: 15 },
      { text: "d", speaker: "0", start: 15, end: 20 },
    ];
    const turns = computeTurns(segments);
    expect(turns).toHaveLength(3);
    expect(turns[0]).toMatchObject({ speaker: "0", start: 0, end: 10 });
    expect(turns[0]!.segments).toHaveLength(2);
    expect(turns[1]).toMatchObject({ speaker: "1", start: 10, end: 15 });
    expect(turns[2]).toMatchObject({ speaker: "0", start: 15, end: 20 });
  });

  it("empty input returns empty turns", () => {
    expect(computeTurns([])).toEqual([]);
  });
});

// 构造一段有明显信号密度差异的转录稿：中段一大段说话人交锋+笑声+问答，其余是平淡独白（单人一直说）
function buildSegments(): TranscriptSegment[] & { peakTime: number } {
  const segments: TranscriptSegment[] = [];
  let t = 0;
  // 开场：平淡独白，全程同一说话人（合并成一个语轮），没有交锋信号
  for (let i = 0; i < 6; i++) {
    segments.push({
      text: "今天天气还可以我们随便聊聊最近的生活琐事没什么特别的",
      speaker: "0",
      start: t,
      end: t + 8,
    });
    t += 8;
  }
  // 中段：换人问答 + 笑声，应该被识别为高光段
  segments.push({ text: "你说这件事真的假的？", speaker: "1", start: t, end: t + 3 });
  t += 3;
  const peakTime = t;
  segments.push({
    text: "哈哈哈真的，我跟你说这个事情特别离谱，当时我们都惊了，然后场面一度非常尴尬",
    speaker: "0",
    start: t,
    end: t + 22,
  });
  t += 22;
  segments.push({ text: "笑死我了", speaker: "1", start: t, end: t + 2 });
  t += 2;
  segments.push({ text: "对对对", speaker: "0", start: t, end: t + 2 });
  t += 2;
  // 结尾：又是平淡独白（换一个说话人，跟中段区分开）
  for (let i = 0; i < 6; i++) {
    segments.push({
      text: "后面我们又聊了一些其他没什么营养的话题就这样吧",
      speaker: "1",
      start: t,
      end: t + 8,
    });
    t += 8;
  }
  return Object.assign(segments, { peakTime }) as TranscriptSegment[] & { peakTime: number };
}

describe("prescreenCandidates", () => {
  it("空转录稿返回空数组", () => {
    expect(prescreenCandidates([])).toEqual([]);
  });

  it("信号密度高的片段（说话人交锋+笑声+问答）应该排到候选最靠前的位置", () => {
    const segments = buildSegments();
    const candidates = prescreenCandidates(segments);

    expect(candidates.length).toBeGreaterThan(0);
    const top = candidates[0]!;
    // 最高分候选窗口应该覆盖住高光时刻（笑声那句话所在的时间点）
    expect(top.startSeconds).toBeLessThanOrEqual(segments.peakTime);
    expect(top.endSeconds).toBeGreaterThanOrEqual(segments.peakTime);
  });

  it("候选窗口的起止永远落在真实语轮边界上，不会切在语轮中间", () => {
    const segments = buildSegments();
    const turns = computeTurns(segments);
    const turnStarts = new Set(turns.map((t) => t.start));
    const turnEnds = new Set(turns.map((t) => t.end));

    for (const c of prescreenCandidates(segments)) {
      expect(turnStarts.has(c.startSeconds)).toBe(true);
      expect(turnEnds.has(c.endSeconds)).toBe(true);
    }
  });

  it("候选窗口时长尽量落在 [MIN, MAX] 秒范围内", () => {
    const segments = buildSegments();
    for (const c of prescreenCandidates(segments)) {
      const duration = c.endSeconds - c.startSeconds;
      expect(duration).toBeGreaterThanOrEqual(MIN_WINDOW_SECONDS - 0.01);
      expect(duration).toBeLessThanOrEqual(MAX_WINDOW_SECONDS + 0.01);
    }
  });

  it("候选窗口之间不重叠（按语轮范围去重）", () => {
    const segments = buildSegments();
    const candidates = prescreenCandidates(segments).sort(
      (a, b) => a.turnStartIndex - b.turnStartIndex,
    );
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i]!.turnStartIndex).toBeGreaterThan(candidates[i - 1]!.turnEndIndex);
    }
  });
});
