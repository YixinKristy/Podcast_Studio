import type { TranscriptSegment } from "@/lib/services/transcript";
import { computeTurns, type Turn } from "./turns";

// docs/10 ★1 + docs/13 一、Stage 1：确定性预筛，不花钱。从转录稿算出候选窗口交给 LLM 精选，
// 不能把全稿直接喂 LLM（贵且长上下文中间段容易被忽略）。

export const MIN_WINDOW_SECONDS = 25;
export const MAX_WINDOW_SECONDS = 90;
export const MAX_CANDIDATES = 20;

const LAUGH_KEYWORDS = ["哈哈", "笑死", "天呐", "天哪", "真的假的", "绝了", "离谱", "笑"];

function laughHits(text: string): number {
  return LAUGH_KEYWORDS.reduce((n, kw) => n + (text.includes(kw) ? 1 : 0), 0);
}

// 单个语轮的信号分——分数越高，越可能是切片的"种子"
function scoreTurn(turns: Turn[], i: number): number {
  const turn = turns[i]!;
  const duration = Math.max(0.1, turn.end - turn.start);
  let score = 0;

  // 说话人切换密度：本轮前后 2 轮组成的小窗口里，单位时间切换了几次——对话交锋的信号
  const lo = Math.max(0, i - 2);
  const hi = Math.min(turns.length - 1, i + 2);
  const windowDuration = turns[hi]!.end - turns[lo]!.start;
  if (windowDuration > 0) score += ((hi - lo) / windowDuration) * 30;

  // 笑声/感叹词密度——情绪高点
  const laughs = turn.segments.reduce((n, s) => n + laughHits(s.text), 0);
  score += (laughs / duration) * 20;

  // 问答对结构：本轮以问句收尾，紧接着换人且对方说了够长——一个完整的叙事单元
  const lastSeg = turn.segments[turn.segments.length - 1]!;
  const isQuestion = /[？?]$/.test(lastSeg.text.trim());
  const next = turns[i + 1];
  if (isQuestion && next && next.speaker !== turn.speaker && next.end - next.start >= 20) {
    score += 8;
  }

  // 句长突变：本轮内部句长忽长忽短（交锋），或者整轮就是一段独白（叙事）
  const lengths = turn.segments.map((s) => s.text.length);
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / lengths.length;
  const coefficientOfVariation = mean > 0 ? Math.sqrt(variance) / mean : 0;
  score += coefficientOfVariation * 3;
  if (turn.segments.length === 1 && duration > 20) score += 3;

  // 静音间隔：本轮开头前有明显停顿，是个天然的好起点
  const prev = turns[i - 1];
  if (prev && turn.start - prev.end > 1.5) score += 2;

  return score;
}

// 以种子语轮为中心，向两侧按语轮整轮扩展，直到落进 [min, max] 秒——
// 语轮完整度是硬约束，不是打分项：窗口起止永远是某个语轮的起止，不会切在语轮中间
function expandWindow(
  turns: Turn[],
  seedIndex: number,
  min: number,
  max: number,
): { startIdx: number; endIdx: number } {
  let startIdx = seedIndex;
  let endIdx = seedIndex;
  let tryLeftNext = true;

  while (turns[endIdx]!.end - turns[startIdx]!.start < min) {
    const canExpandLeft = startIdx > 0 && turns[endIdx]!.end - turns[startIdx - 1]!.start <= max;
    const canExpandRight =
      endIdx < turns.length - 1 && turns[endIdx + 1]!.end - turns[startIdx]!.start <= max;
    if (!canExpandLeft && !canExpandRight) break;

    if (tryLeftNext && canExpandLeft) {
      startIdx -= 1;
    } else if (!tryLeftNext && canExpandRight) {
      endIdx += 1;
    } else if (canExpandLeft) {
      startIdx -= 1;
    } else {
      endIdx += 1;
    }
    tryLeftNext = !tryLeftNext;
  }

  return { startIdx, endIdx };
}

export interface ClipCandidateWindow {
  startSeconds: number;
  endSeconds: number;
  score: number;
  turnStartIndex: number;
  turnEndIndex: number;
}

export function prescreenCandidates(segments: TranscriptSegment[]): ClipCandidateWindow[] {
  const turns = computeTurns(segments);
  if (turns.length === 0) return [];

  const scored = turns.map((_, i) => ({ index: i, score: scoreTurn(turns, i) }));
  scored.sort((a, b) => b.score - a.score);

  const chosen: ClipCandidateWindow[] = [];

  for (const { index } of scored) {
    if (chosen.some((w) => index >= w.turnStartIndex && index <= w.turnEndIndex)) continue;

    const { startIdx, endIdx } = expandWindow(turns, index, MIN_WINDOW_SECONDS, MAX_WINDOW_SECONDS);
    const overlapsExisting = chosen.some(
      (w) => startIdx <= w.turnEndIndex && endIdx >= w.turnStartIndex,
    );
    if (overlapsExisting) continue;

    const windowScore = scored
      .filter((s) => s.index >= startIdx && s.index <= endIdx)
      .reduce((sum, s) => sum + s.score, 0);

    chosen.push({
      startSeconds: turns[startIdx]!.start,
      endSeconds: turns[endIdx]!.end,
      score: windowScore,
      turnStartIndex: startIdx,
      turnEndIndex: endIdx,
    });

    if (chosen.length >= MAX_CANDIDATES) break;
  }

  return chosen.sort((a, b) => b.score - a.score);
}

export function formatCandidateForPrompt(
  window: ClipCandidateWindow,
  segments: TranscriptSegment[],
  index: number,
): string {
  const lines = segments
    .filter((s) => s.start >= window.startSeconds && s.end <= window.endSeconds)
    .map((s) => `[说话人${s.speaker}] ${s.text}`)
    .join("\n");
  return `候选 ${index + 1}（${window.startSeconds.toFixed(1)}s - ${window.endSeconds.toFixed(1)}s）：\n${lines}`;
}
