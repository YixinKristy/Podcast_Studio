import { describe, expect, it } from "vitest";
import {
  averageConfidence,
  countSpeakers,
  isLowConfidence,
  parseSegments,
  voiceActivityRatio,
  type TranscriptSegment,
} from "@/lib/services/transcript";
import type { RawTranscript } from "@/lib/asr/fun-asr";

describe("parseSegments", () => {
  it("converts ms to seconds and sorts by start time", () => {
    const raw: RawTranscript = {
      transcripts: [
        {
          sentences: [
            { begin_time: 5000, end_time: 6000, text: "第二句", speaker_id: 1 },
            { begin_time: 0, end_time: 2000, text: "第一句", speaker_id: 0 },
          ],
        },
      ],
    };
    const segments = parseSegments(raw);
    expect(segments).toEqual([
      { text: "第一句", speaker: "0", start: 0, end: 2, confidence: undefined },
      { text: "第二句", speaker: "1", start: 5, end: 6, confidence: undefined },
    ]);
  });

  it("returns an empty array when there are no transcripts", () => {
    expect(parseSegments({})).toEqual([]);
  });
});

describe("voiceActivityRatio", () => {
  it("computes the speech-to-duration ratio", () => {
    const segments: TranscriptSegment[] = [
      { text: "a", speaker: "0", start: 0, end: 10 },
      { text: "b", speaker: "0", start: 20, end: 30 },
    ];
    expect(voiceActivityRatio(segments, 100)).toBeCloseTo(0.2);
  });

  it("returns 0 for a zero-length duration instead of dividing by zero", () => {
    expect(voiceActivityRatio([], 0)).toBe(0);
  });
});

describe("countSpeakers", () => {
  it("counts distinct speaker labels", () => {
    const segments: TranscriptSegment[] = [
      { text: "a", speaker: "0", start: 0, end: 1 },
      { text: "b", speaker: "1", start: 1, end: 2 },
      { text: "c", speaker: "0", start: 2, end: 3 },
    ];
    expect(countSpeakers(segments)).toBe(2);
  });
});

describe("averageConfidence / isLowConfidence", () => {
  it("returns null when no segment has a confidence value", () => {
    const segments: TranscriptSegment[] = [{ text: "a", speaker: "0", start: 0, end: 1 }];
    expect(averageConfidence(segments)).toBeNull();
    expect(isLowConfidence(segments)).toBe(false);
  });

  it("flags low confidence below the threshold", () => {
    const segments: TranscriptSegment[] = [
      { text: "a", speaker: "0", start: 0, end: 1, confidence: 0.5 },
      { text: "b", speaker: "0", start: 1, end: 2, confidence: 0.4 },
    ];
    expect(isLowConfidence(segments)).toBe(true);
  });

  it("does not flag confidence at or above the threshold", () => {
    const segments: TranscriptSegment[] = [
      { text: "a", speaker: "0", start: 0, end: 1, confidence: 0.9 },
      { text: "b", speaker: "0", start: 1, end: 2, confidence: 0.85 },
    ];
    expect(isLowConfidence(segments)).toBe(false);
  });
});
