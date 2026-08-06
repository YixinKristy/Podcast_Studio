import type { TranscriptSegment } from "@/lib/services/transcript";

// docs/04 §1.2 L1 清理层：确定性高的信号，纯代码检测，不用 LLM——
// 跟切片预筛（lib/services/clips/prescreen.ts）一样的"便宜信号在前"思路。

const FILLER_WORDS = [
  "嗯",
  "啊",
  "呃",
  "就是说",
  "然后然后",
  "那个那个",
  "这个这个",
  "就是",
  "那个",
  "这个",
];

const LONG_PAUSE_SECONDS = 2.5;

export interface RuleSuggestion {
  layer: "L1";
  type: "filler" | "long_pause";
  startSeconds: number;
  endSeconds: number;
  reason: string;
  confidence: number;
}

// 整句话去掉标点后，反复贪心剥掉已知填充词，如果能被完全剥空，说明这句话本身
// 就是纯填充词（比如单独一句"嗯。"），不是句子中间夹了个语气词——后者没有词级
// 时间戳，切不出来，这里只处理能整句删掉的情况
export function isFillerOnlySegment(text: string): boolean {
  const stripped = text.replace(/[，。！？、；：""''…—\s]/g, "");
  if (stripped.length === 0) return false;

  let remaining = stripped;
  let changed = true;
  while (changed && remaining.length > 0) {
    changed = false;
    for (const filler of FILLER_WORDS) {
      if (remaining.startsWith(filler)) {
        remaining = remaining.slice(filler.length);
        changed = true;
        break;
      }
    }
  }
  return remaining.length === 0;
}

export function detectL1Suggestions(segments: TranscriptSegment[]): RuleSuggestion[] {
  const suggestions: RuleSuggestion[] = [];

  for (const seg of segments) {
    if (isFillerOnlySegment(seg.text)) {
      suggestions.push({
        layer: "L1",
        type: "filler",
        startSeconds: seg.start,
        endSeconds: seg.end,
        reason: `纯语气词/填充词："${seg.text}"`,
        confidence: 0.9,
      });
    }
  }

  for (let i = 0; i < segments.length - 1; i++) {
    const gap = segments[i + 1]!.start - segments[i]!.end;
    if (gap > LONG_PAUSE_SECONDS) {
      suggestions.push({
        layer: "L1",
        type: "long_pause",
        startSeconds: segments[i]!.end,
        endSeconds: segments[i + 1]!.start,
        reason: `长停顿 ${gap.toFixed(1)}s`,
        confidence: 0.9,
      });
    }
  }

  return suggestions.sort((a, b) => a.startSeconds - b.startSeconds);
}
