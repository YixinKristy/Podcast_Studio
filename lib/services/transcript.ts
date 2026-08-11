import type { RawTranscript } from "@/lib/asr/fun-asr";
import type { Json } from "@/lib/db/database.types";

export interface TranscriptSegment {
  text: string;
  speaker: string;
  start: number; // 秒
  end: number; // 秒
  confidence?: number;
  [key: string]: Json | undefined;
}

// Fun-ASR 原始 JSON -> 我们存的句级格式，时间戳从毫秒转秒（架构铁律 #4：单一来源）
export function parseSegments(raw: RawTranscript): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  for (const transcript of raw.transcripts ?? []) {
    for (const s of transcript.sentences ?? []) {
      segments.push({
        text: s.text ?? "",
        speaker: String(s.speaker_id ?? "0"),
        start: Number(s.begin_time) / 1000,
        end: Number(s.end_time) / 1000,
        confidence: typeof s.confidence === "number" ? s.confidence : undefined,
      });
    }
  }
  return segments.sort((a, b) => a.start - b.start);
}

// D4：有效语音占比 <10% 判定为"没识别到足够的人声"
export function voiceActivityRatio(segments: TranscriptSegment[], durationSeconds: number): number {
  if (durationSeconds <= 0) return 0;
  const speechSeconds = segments.reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0);
  return speechSeconds / durationSeconds;
}

// D6：单说话人节目自动检测
export function countSpeakers(segments: TranscriptSegment[]): number {
  return new Set(segments.map((s) => s.speaker)).size;
}

const LOW_CONFIDENCE_THRESHOLD = 0.7;

// D3：整体置信度偏低。注：Fun-ASR 返回结果里具体哪个字段是置信度，没有拿真实数据验证过
// （spike 阶段没细看这个字段），这里做了防御式解析——如果字段缺失就返回 null，不误判。
export function averageConfidence(segments: TranscriptSegment[]): number | null {
  const withConfidence = segments.filter((s) => typeof s.confidence === "number");
  if (withConfidence.length === 0) return null;
  return withConfidence.reduce((sum, s) => sum + (s.confidence ?? 0), 0) / withConfidence.length;
}

export function isLowConfidence(segments: TranscriptSegment[]): boolean {
  const avg = averageConfidence(segments);
  return avg !== null && avg < LOW_CONFIDENCE_THRESHOLD;
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// P4 逐字稿导出（05-PRD §P4）：复制全文 / 下载 txt·markdown。单说话人节目不带说话人前缀，
// 跟处理中页的显示逻辑保持一致。
export function formatTranscriptPlainText(
  segments: TranscriptSegment[],
  showSpeakerLabels: boolean,
): string {
  return segments
    .map((s) => {
      const parts = [`[${formatTimestamp(s.start)}]`];
      if (showSpeakerLabels) parts.push(`说话人${s.speaker}`);
      parts.push(s.text);
      return parts.join(" ");
    })
    .join("\n");
}

export function formatTranscriptMarkdown(
  segments: TranscriptSegment[],
  showSpeakerLabels: boolean,
): string {
  return segments
    .map((s) => {
      const parts = [`\`[${formatTimestamp(s.start)}]\``];
      if (showSpeakerLabels) parts.push(`**说话人${s.speaker}**`);
      parts.push(s.text);
      return parts.join(" ");
    })
    .join("\n\n");
}
