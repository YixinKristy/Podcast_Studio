export interface TimeRange {
  startSeconds: number;
  endSeconds: number;
}

export interface KeptRange extends TimeRange {
  fadeIn: boolean;
  fadeOut: boolean;
}

// 把"要剪掉的区间"（用户勾选的建议）转成"要保留的区间"——重叠的剪掉区间先合并，
// 剩下的间隙就是要保留、拼接进粗剪音频的部分。紧挨着剪切点的一侧要做淡入/淡出防爆音，
// 音频最开头/最结尾（没有紧邻剪切）不需要。
export function computeKeptRanges(cutRanges: TimeRange[], totalDuration: number): KeptRange[] {
  if (totalDuration <= 0) return [];
  if (cutRanges.length === 0) {
    return [{ startSeconds: 0, endSeconds: totalDuration, fadeIn: false, fadeOut: false }];
  }

  const clamped = cutRanges.map((r) => ({
    startSeconds: Math.max(0, Math.min(r.startSeconds, totalDuration)),
    endSeconds: Math.max(0, Math.min(r.endSeconds, totalDuration)),
  }));
  const sorted = clamped.sort((a, b) => a.startSeconds - b.startSeconds);

  const merged: TimeRange[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.startSeconds <= last.endSeconds) {
      last.endSeconds = Math.max(last.endSeconds, r.endSeconds);
    } else {
      merged.push({ ...r });
    }
  }

  const kept: KeptRange[] = [];
  let cursor = 0;
  for (const cut of merged) {
    if (cut.startSeconds > cursor) {
      kept.push({
        startSeconds: cursor,
        endSeconds: cut.startSeconds,
        fadeIn: cursor > 0,
        fadeOut: true,
      });
    }
    cursor = Math.max(cursor, cut.endSeconds);
  }
  if (cursor < totalDuration) {
    kept.push({
      startSeconds: cursor,
      endSeconds: totalDuration,
      fadeIn: cursor > 0,
      fadeOut: false,
    });
  }

  return kept;
}
