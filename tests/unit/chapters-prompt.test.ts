import { describe, expect, it } from "vitest";
import { postProcess, snapToTurnStart } from "@/prompts/chapters";
import type { MaterialGenerationContext } from "@/lib/services/materials/types";
import type { TranscriptSegment } from "@/lib/services/transcript";

function makeContext(segments: TranscriptSegment[]): MaterialGenerationContext {
  return {
    episodeId: "ep1",
    showName: "测试节目",
    showIntro: null,
    promoteNote: null,
    guests: [],
    transcriptText: "",
    segments,
  };
}

describe("snapToTurnStart", () => {
  const segments: TranscriptSegment[] = [
    { text: "a", speaker: "0", start: 0, end: 5 },
    { text: "b", speaker: "0", start: 5, end: 10 },
    { text: "c", speaker: "1", start: 10, end: 20 },
    { text: "d", speaker: "1", start: 20, end: 25 },
    { text: "e", speaker: "0", start: 25, end: 30 },
  ];
  const context = makeContext(segments);

  it("snaps to the turn start, ignoring a mid-turn sentence boundary that's closer in raw distance", () => {
    // segments[1] (说话人0) 在 t=5 也是一个句子起点，但不是语轮起点——3s 应该吸附到语轮起点 0
    expect(snapToTurnStart(3, context)).toBe(0);
  });

  it("snaps to a later turn start when it's closer", () => {
    // 22s 离说话人0第二轮的起点 25 更近（说话人1的轮次起点是 10）
    expect(snapToTurnStart(22, context)).toBe(25);
  });

  it("returns the input unchanged when there are no segments", () => {
    expect(snapToTurnStart(42, makeContext([]))).toBe(42);
  });
});

describe("postProcess (chapters)", () => {
  it("snaps every chapter's start time and forces the first chapter to 0", () => {
    const segments: TranscriptSegment[] = [
      { text: "a", speaker: "0", start: 0, end: 5 },
      { text: "b", speaker: "1", start: 12, end: 20 },
    ];
    const context = makeContext(segments);

    const result = postProcess(
      {
        chapters: [
          { startSeconds: 3, title: "开场" },
          { startSeconds: 11, title: "正题" },
        ],
      },
      context,
    );

    expect(result.chapters[0]!.startSeconds).toBe(0);
    expect(result.chapters[1]!.startSeconds).toBe(12);
  });

  it("sorts chapters by start time even if the model returned them out of order", () => {
    const segments: TranscriptSegment[] = [
      { text: "a", speaker: "0", start: 0, end: 5 },
      { text: "b", speaker: "1", start: 30, end: 40 },
    ];
    const context = makeContext(segments);

    const result = postProcess(
      {
        chapters: [
          { startSeconds: 28, title: "后段" },
          { startSeconds: 1, title: "前段" },
        ],
      },
      context,
    );

    expect(result.chapters.map((c) => c.title)).toEqual(["前段", "后段"]);
  });
});
