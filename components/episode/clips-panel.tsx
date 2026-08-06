"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Database } from "@/lib/db/database.types";
import type { ClipsStoredContent, ClipWithAudio, RejectedCandidate } from "@/prompts/clips";

type MaterialRow = Database["public"]["Tables"]["materials"]["Row"];

// 跟 material-tab.tsx 保持一致的"等太久大概率是挂了"阈值；切片会更慢（要跑 ffmpeg），
// 但同一个阈值够用——真挂了不会因为多给 90s 就变成没挂
const STALL_SECONDS = 90;

function secondsSince(isoTime: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(isoTime).getTime()) / 1000));
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const DOWNGRADE_LABELS: Record<string, string> = {
  quote_card: "金句卡",
  xhs_image: "小红书图文内页",
  bilibili_long: "B站长切片",
  shownotes: "shownotes 亮点",
};

function clipShareText(clip: ClipWithAudio): string {
  return [
    clip.hookSubtitle,
    "",
    clip.transcriptLines.map((l) => `${l.starred ? "⭐" : ""}[${l.speaker}] ${l.text}`).join("\n"),
    "",
    clip.endCard,
    "",
    clip.noteTitle,
    clip.noteBody,
    clip.hashtags.map((h) => `#${h}`).join(" "),
  ].join("\n");
}

function ClipCard({
  clip,
  audioUrl,
  downloadUrl,
}: {
  clip: ClipWithAudio;
  audioUrl: string | undefined;
  downloadUrl: string | undefined;
}) {
  const duration = Math.round(clip.endSeconds - clip.startSeconds);

  return (
    <div className="rounded-xl border p-4">
      <div className="mb-2 flex items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            clip.category === "A" ? "bg-blue-50 text-blue-700" : "bg-purple-50 text-purple-700"
          }`}
        >
          {clip.category}类 · {clip.category === "A" ? "独立成立" : "留缺口"}
        </span>
        <span className="text-muted-foreground text-xs">
          [{formatTimestamp(clip.startSeconds)} - {formatTimestamp(clip.endSeconds)}] · {duration}s
        </span>
      </div>

      {audioUrl && (
        <audio controls src={audioUrl} className="mb-3 w-full">
          <track kind="captions" />
        </audio>
      )}

      <div className="space-y-2 text-sm">
        <div>
          <span className="text-muted-foreground font-medium">宣传方向：</span>
          {clip.promoDirection}
        </div>
        <div>
          <span className="text-muted-foreground font-medium">宣传点：</span>
          {clip.promoPoint}
        </div>
        <div>
          <span className="text-muted-foreground font-medium">钩子字幕：</span>
          {clip.hookSubtitle}
        </div>

        <details className="rounded border p-2">
          <summary className="text-muted-foreground cursor-pointer text-xs">字幕稿</summary>
          <div className="mt-2 space-y-1">
            {clip.transcriptLines.map((line, i) => (
              <p key={i} className={line.starred ? "text-primary font-semibold" : ""}>
                {line.starred && "⭐ "}[{line.speaker}] {line.text}
              </p>
            ))}
          </div>
        </details>

        <div>
          <span className="text-muted-foreground font-medium">片尾卡：</span>
          {clip.endCard}
        </div>

        <div className="rounded-md border p-2">
          <div className="font-medium">{clip.noteTitle}</div>
          <p className="whitespace-pre-wrap">{clip.noteBody}</p>
          <div className="text-primary">{clip.hashtags.map((h) => `#${h}`).join("  ")}</div>
        </div>

        <details className="rounded border p-2">
          <summary className="text-muted-foreground cursor-pointer text-xs">六条硬测试自检</summary>
          <ul className="mt-2 space-y-1 text-xs">
            <li>{clip.tests.hook ? "✓" : "✗"} 钩子测试</li>
            <li>{clip.tests.standalone ? "✓" : "✗"} 独立测试</li>
            <li>{clip.tests.tension ? "✓" : "✗"} 张力测试</li>
            <li>{clip.tests.task ? "✓" : "✗"} 任务测试</li>
            <li>{clip.tests.source ? "✓" : "✗"} 同源测试</li>
            <li>{clip.tests.duration ? "✓" : "✗"} 时长测试</li>
            <li className="text-muted-foreground">{clip.tests.notes}</li>
          </ul>
        </details>
      </div>

      <div className="mt-3 flex gap-2">
        {downloadUrl && (
          <a href={downloadUrl} download className="text-sm underline">
            下载 mp3
          </a>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() => void navigator.clipboard.writeText(clipShareText(clip))}
        >
          复制该条全部文案
        </Button>
      </div>
    </div>
  );
}

function RejectedList({ rejected }: { rejected: RejectedCandidate[] }) {
  if (rejected.length === 0) return null;
  return (
    <details className="rounded-xl border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        候选池（{rejected.length} 条被淘汰，淘汰不等于浪费）
      </summary>
      <div className="mt-2 space-y-2 text-sm">
        {rejected.map((r, i) => (
          <div key={i} className="border-b pb-2 last:border-0">
            <div className="text-muted-foreground text-xs">
              [{formatTimestamp(r.startSeconds)} - {formatTimestamp(r.endSeconds)}]
            </div>
            <div>{r.reason}</div>
            <div className="text-muted-foreground text-xs">
              降级去向：{DOWNGRADE_LABELS[r.downgradeTo] ?? r.downgradeTo}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

interface ClipsPanelProps {
  episodeId: string;
  material: MaterialRow | null;
}

export function ClipsPanel({ episodeId, material }: ClipsPanelProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [audioUrls, setAudioUrls] = useState<string[]>([]);
  const [downloadUrls, setDownloadUrls] = useState<string[]>([]);

  const status = material?.status ?? "pending";
  const content = (material?.content as unknown as ClipsStoredContent | null) ?? null;

  useEffect(() => {
    if (status !== "ready" || !content || content.clips.length === 0) return;
    fetch(`/api/episodes/${episodeId}/materials/clips/audio-urls`)
      .then((res) => res.json())
      .then((json) => {
        setAudioUrls(json.urls ?? []);
        setDownloadUrls(json.downloadUrls ?? []);
      })
      .catch(() => {
        setAudioUrls([]);
        setDownloadUrls([]);
      });
    // content 只在版本变化时才需要重新签 URL，用 version 而不是整个 content 对象做依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeId, status, material?.version]);

  async function generate() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/materials/clips/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: instruction || undefined }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setMessage(json.error ?? "生成失败");
        return;
      }
      setInstruction("");
    } finally {
      setBusy(false);
    }
  }

  async function confirmAll() {
    await fetch(`/api/episodes/${episodeId}/materials/clips/confirm`, { method: "POST" });
  }

  if (status === "generating") {
    const elapsed = material ? secondsSince(material.updated_at) : 0;
    const stalled = elapsed > STALL_SECONDS;
    return (
      <div>
        <p className="text-muted-foreground text-sm">
          生成中...（已等待 {elapsed} 秒——切片要真实切音频，会比文本物料慢一些）
        </p>
        {stalled && (
          <div className="mt-2">
            <p className="text-muted-foreground text-xs">
              等的有点久了，可能是中途失败了，可以直接重试
            </p>
            <Button size="sm" variant="outline" className="mt-1" onClick={generate} disabled={busy}>
              {busy ? "重试中..." : "重试"}
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (status === "pending") {
    return (
      <div>
        <Button size="sm" onClick={generate} disabled={busy}>
          {busy ? "生成中..." : "开始生成"}
        </Button>
        {message && <p className="text-destructive mt-2 text-sm">{message}</p>}
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div>
        <p className="text-destructive mb-2 text-sm">这项生成失败了</p>
        <Button size="sm" onClick={generate} disabled={busy}>
          重试
        </Button>
      </div>
    );
  }

  if (!content || content.clips.length === 0) {
    return (
      <div>
        <p className="text-muted-foreground text-sm">
          本期未识别到合格片段（六条硬测试未通过），你可以在逐字稿划选一段自行生成切片
        </p>
        {content && <RejectedList rejected={content.rejected} />}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {content.clips.map((clip, i) => (
        <ClipCard key={i} clip={clip} audioUrl={audioUrls[i]} downloadUrl={downloadUrls[i]} />
      ))}

      <RejectedList rejected={content.rejected} />

      <div className="space-y-3 border-t pt-4">
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-md border px-3 py-1.5 text-sm"
            placeholder="重roll指令，例如：多要点共鸣向的"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
          />
          <Button size="sm" variant="outline" onClick={generate} disabled={busy}>
            {busy ? "处理中..." : "重新生成"}
          </Button>
          <Button size="sm" onClick={confirmAll} disabled={!!material?.confirmed_at}>
            {material?.confirmed_at ? "已确认" : "确认"}
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">当前版本 v{material?.version ?? 1}</p>
      </div>
      {message && <p className="text-destructive text-sm">{message}</p>}
    </div>
  );
}
