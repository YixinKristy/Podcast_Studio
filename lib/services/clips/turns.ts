import type { TranscriptSegment } from "@/lib/services/transcript";

export interface Turn {
  speaker: string;
  start: number;
  end: number;
  segments: TranscriptSegment[];
}

// 语轮 = 同一说话人连续发言的一整段（可能好几句），是切片和章节共同的"完整性"最小单位——
// 切一段素材，起止都必须落在语轮边界上，不能切在语轮中间。
export function computeTurns(segments: TranscriptSegment[]): Turn[] {
  const turns: Turn[] = [];
  for (const seg of segments) {
    const last = turns[turns.length - 1];
    if (last && last.speaker === seg.speaker) {
      last.end = seg.end;
      last.segments.push(seg);
    } else {
      turns.push({ speaker: seg.speaker, start: seg.start, end: seg.end, segments: [seg] });
    }
  }
  return turns;
}

// docs/10 ★2：LLM 报的起止时间不能直接信，必须吸附到真实存在的语轮边界——
// 起点吸附最近的语轮起点，终点吸附最近的语轮终点，问答才不会被拦腰切断
export function snapClipBoundaries(
  startSeconds: number,
  endSeconds: number,
  turns: Turn[],
): { startSeconds: number; endSeconds: number } {
  if (turns.length === 0) return { startSeconds, endSeconds };

  const nearestStart = turns.reduce((closest, t) =>
    Math.abs(t.start - startSeconds) < Math.abs(closest.start - startSeconds) ? t : closest,
  ).start;
  const nearestEnd = turns.reduce((closest, t) =>
    Math.abs(t.end - endSeconds) < Math.abs(closest.end - endSeconds) ? t : closest,
  ).end;

  if (nearestEnd <= nearestStart) {
    // 吸附后起止倒挂了（候选给的区间太窄，两头吸到了同一个语轮）——保底不裁剪
    return { startSeconds, endSeconds };
  }
  return { startSeconds: nearestStart, endSeconds: nearestEnd };
}
