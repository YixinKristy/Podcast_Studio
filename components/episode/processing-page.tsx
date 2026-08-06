"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/db/supabase/client";
import { Button } from "@/components/ui/button";
import type { Database } from "@/lib/db/database.types";
import type { TranscriptSegment } from "@/lib/services/transcript";
import { MaterialsPanel } from "./materials-panel";
import { RoughCutPanel } from "./rough-cut-panel";

type EpisodeRow = Pick<
  Database["public"]["Tables"]["episodes"]["Row"],
  | "id"
  | "status"
  | "audio_url"
  | "duration_seconds"
  | "transcript"
  | "speaker_count"
  | "low_confidence"
  | "episode_no"
  | "generate_materials"
>;

interface ProcessingPageProps {
  episodeId: string;
  initialEpisode: EpisodeRow;
  showName: string;
}

const SPEAKER_COLORS = ["#E05B4B", "#2E7DD1", "#1FA764", "#B7791F", "#7C3AED"];

function speakerColor(speaker: string, order: string[]): string {
  const idx = order.indexOf(speaker);
  return SPEAKER_COLORS[idx % SPEAKER_COLORS.length] ?? "#666";
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const STAGES = [
  { key: "uploaded", label: "上传" },
  { key: "transcribing", label: "转写" },
  { key: "generating", label: "生成物料" },
  { key: "ready", label: "完成" },
] as const;

function currentStageIndex(status: string): number {
  if (status === "uploaded") return 0;
  if (status === "transcribing") return 1;
  if (status === "generating") return 2;
  if (status === "ready" || status === "published") return 3;
  return 0;
}

const SECTIONS = [
  { key: "roughcut", label: "粗剪" },
  { key: "materials", label: "发布物料" },
] as const;

export function ProcessingPage({ episodeId, initialEpisode, showName }: ProcessingPageProps) {
  const [episode, setEpisode] = useState<EpisodeRow>(initialEpisode);
  const [retrying, setRetrying] = useState(false);
  const [audioPlaybackUrl, setAudioPlaybackUrl] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<(typeof SECTIONS)[number]["key"]>("roughcut");
  const [previewRange, setPreviewRange] = useState<{ id: string; endSeconds: number } | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const startedAtRef = useRef(Date.now());

  useEffect(() => {
    // generating 也要继续轮询——物料全部跑完后服务端会把状态迁移成 ready，
    // 轮询在这一步停掉的话页面永远看不到这个变化
    if (episode.status !== "transcribing" && episode.status !== "generating") return;
    const supabase = createClient();
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from("episodes")
        .select(
          "id, status, audio_url, duration_seconds, transcript, speaker_count, low_confidence, episode_no, generate_materials",
        )
        .eq("id", episodeId)
        .single();
      if (data) setEpisode(data);
    }, 3000);
    return () => clearInterval(interval);
  }, [episode.status, episodeId]);

  useEffect(() => {
    // bucket 是私有的，episode.audio_url 存的是不带签名的地址，播放器直接用会 403。
    // 转写完出现逐字稿之后才需要播放，这时候单独去要一个签名过的下载链接。
    if (!episode.audio_url || audioPlaybackUrl) return;
    fetch(`/api/episodes/${episodeId}/audio-url`)
      .then((res) => res.json())
      .then((json) => setAudioPlaybackUrl(json.url ?? null))
      .catch(() => setAudioPlaybackUrl(null));
  }, [episode.audio_url, audioPlaybackUrl, episodeId]);

  function seekAudio(seconds: number) {
    if (!audioRef.current) return;
    audioRef.current.currentTime = seconds;
    void audioRef.current.play();
    setPreviewRange(null);
  }

  // 粗剪建议的"试听"——跟普通跳转的区别是要在片段结尾自动停，不然用户听完
  // 这几秒还得自己手动暂停，体验上不像是在"试听一个片段"。再点一次当前正在
  // 试听的那条就是停止（toggle），图标状态跟着 previewRange 走。
  function togglePreview(id: string, startSeconds: number, endSeconds: number) {
    const audio = audioRef.current;
    if (!audio) return;
    if (previewRange?.id === id) {
      audio.pause();
      setPreviewRange(null);
      return;
    }
    audio.currentTime = startSeconds;
    // 播放被浏览器自动播放策略拦截时，play() 的 promise 会 reject，浏览器还可能
    // 顺带触发一次 pause 事件——如果提前标成"正在试听"，这个 pause 事件会立刻把
    // 状态清掉，图标却已经切到了"播放中"，显得很诡异。等 play() 真正成功了再标状态。
    audio
      .play()
      .then(() => setPreviewRange({ id, endSeconds }))
      .catch(() => {});
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !previewRange) return;
    function handleTimeUpdate() {
      if (audio && previewRange && audio.currentTime >= previewRange.endSeconds) {
        audio.pause();
      }
    }
    function handlePause() {
      setPreviewRange(null);
    }
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("pause", handlePause);
    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("pause", handlePause);
    };
  }, [previewRange]);

  async function retry() {
    setRetrying(true);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/start`, { method: "POST" });
      if (res.ok) {
        setEpisode((e) => ({ ...e, status: "transcribing" }));
      }
    } finally {
      setRetrying(false);
    }
  }

  const stageIdx = currentStageIndex(episode.status);
  const segments = (episode.transcript as unknown as TranscriptSegment[] | null) ?? [];
  const speakerOrder = Array.from(new Set(segments.map((s) => s.speaker)));
  const showSpeakerLabels = (episode.speaker_count ?? 0) > 1;

  const estimateSeconds = episode.duration_seconds
    ? Math.round(episode.duration_seconds / 4)
    : null;
  const elapsedSeconds = Math.round((Date.now() - startedAtRef.current) / 1000);

  return (
    <div className="mx-auto max-w-6xl p-8">
      <Link href="/episodes" className="text-muted-foreground text-sm hover:underline">
        ← 我的节目
      </Link>
      <div className="mt-2 mb-2 text-sm text-muted-foreground">
        {showName} · 第 {episode.episode_no} 期
      </div>

      <div className="mb-6 flex items-center gap-2">
        {STAGES.map((stage, i) => (
          <div key={stage.key} className="flex items-center gap-2">
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                i < stageIdx
                  ? "bg-green-600 text-white"
                  : i === stageIdx
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {i < stageIdx ? "✓" : i + 1}
            </span>
            <span className="text-sm">{stage.label}</span>
            {i < STAGES.length - 1 && <span className="text-muted-foreground mx-1">→</span>}
          </div>
        ))}
      </div>

      {episode.status === "transcribing" && (
        <div className="rounded-xl border p-8 text-center">
          <p className="font-medium">转写中...</p>
          {estimateSeconds !== null && estimateSeconds > 120 && (
            <p className="text-muted-foreground mt-1 text-sm">
              预计还需约 {Math.max(0, Math.round((estimateSeconds - elapsedSeconds) / 60))} 分钟
            </p>
          )}
          <p className="text-muted-foreground mt-3 text-xs">可以关掉页面，全部完成后回来看</p>
        </div>
      )}

      {episode.status === "transcribe_failed" && (
        <div className="rounded-xl border p-8 text-center">
          <p className="font-medium text-destructive">转写失败了</p>
          <p className="text-muted-foreground mt-1 text-sm">
            没识别到足够的人声，或转写服务出错，额度已退回
          </p>
          <Button className="mt-4" onClick={retry} disabled={retrying}>
            {retrying ? "重试中..." : "一键重试"}
          </Button>
        </div>
      )}

      {/* P4 发布台布局：逐字稿是常驻参考栏，不是转写完顺手往下堆的一段内容——
          左边固定住方便边看逐字稿边核对右边物料，不用来回滚动一个很长的单栏页面 */}
      {segments.length > 0 && (
        <div className="mt-6 grid gap-6 md:grid-cols-5">
          <div className="md:sticky md:top-6 md:col-span-2 md:self-start">
            {episode.low_confidence && (
              <div className="mb-3 rounded-md bg-yellow-50 px-4 py-2 text-sm text-yellow-800">
                识别置信度偏低，建议校对后刷新
              </div>
            )}
            {audioPlaybackUrl && (
              <audio ref={audioRef} controls src={audioPlaybackUrl} className="mb-4 w-full">
                <track kind="captions" />
              </audio>
            )}

            <div className="max-h-[70vh] space-y-1 overflow-y-auto rounded-xl border p-4">
              {segments.map((seg, i) => (
                <button
                  key={i}
                  type="button"
                  className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-muted"
                  onClick={() => seekAudio(seg.start)}
                >
                  {showSpeakerLabels && (
                    <span
                      className="mr-2 font-semibold"
                      style={{ color: speakerColor(seg.speaker, speakerOrder) }}
                    >
                      说话人{seg.speaker}
                    </span>
                  )}
                  <span className="text-muted-foreground mr-2">[{formatTimestamp(seg.start)}]</span>
                  {seg.text}
                </button>
              ))}
            </div>
          </div>

          <div className="md:col-span-3">
            {/* docs/04 Stage 1 粗剪 跟 Stage 2 七件套发布物料是不同阶段的东西，
                分 Tab 展示——两块内容都不小，堆在一个栏里太乱 */}
            {(() => {
              const showMaterials =
                episode.status === "generating" ||
                episode.status === "ready" ||
                episode.status === "published";
              const sections = SECTIONS.filter((s) => s.key !== "materials" || showMaterials);
              return (
                <>
                  <div className="mb-4 flex gap-2 border-b">
                    {sections.map((s) => (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() => setActiveSection(s.key)}
                        className={`px-3 py-2 text-sm ${
                          activeSection === s.key
                            ? "border-primary text-primary border-b-2 font-medium"
                            : "text-muted-foreground"
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>

                  {activeSection === "roughcut" && (
                    <RoughCutPanel
                      episodeId={episodeId}
                      episodeDurationSeconds={episode.duration_seconds ?? 0}
                      onPreview={togglePreview}
                      previewingId={previewRange?.id ?? null}
                    />
                  )}
                  {activeSection === "materials" && showMaterials && (
                    <MaterialsPanel
                      episodeId={episodeId}
                      enabledTypes={(episode.generate_materials as string[] | null) ?? []}
                    />
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
