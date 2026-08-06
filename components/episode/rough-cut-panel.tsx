"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/db/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { Database } from "@/lib/db/database.types";
import type { StoredSuggestion } from "@/lib/services/roughcut/generate";
import { computeKeptRanges } from "@/lib/services/roughcut/ranges";

type RoughCutRow = Database["public"]["Tables"]["rough_cuts"]["Row"];

// 跟物料生成一致的"等太久大概率是挂了"阈值
const STALL_SECONDS = 90;

function secondsSince(isoTime: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(isoTime).getTime()) / 1000));
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const TYPE_LABELS: Record<string, string> = {
  filler: "填充词",
  long_pause: "长停顿",
  retake: "口误重说",
  redundant: "冗余表达",
  off_topic: "跑题",
  low_density: "低信息密度",
};

function SuggestionRow({
  suggestion,
  onToggle,
  onPreview,
}: {
  suggestion: StoredSuggestion;
  onToggle: (id: string, checked: boolean) => void;
  onPreview?: (seconds: number) => void;
}) {
  return (
    <label className="flex items-start gap-2 rounded-md border p-2 text-sm">
      <Checkbox
        checked={suggestion.selected}
        onCheckedChange={(checked) => onToggle(suggestion.id, checked === true)}
        className="mt-0.5"
      />
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="bg-muted rounded px-1.5 py-0.5 text-xs">
            {TYPE_LABELS[suggestion.type] ?? suggestion.type}
          </span>
          <span className="text-muted-foreground font-mono text-xs">
            [{formatTimestamp(suggestion.startSeconds)} - {formatTimestamp(suggestion.endSeconds)}]
          </span>
          <span className="text-muted-foreground text-xs">
            置信度 {Math.round(suggestion.confidence * 100)}%
          </span>
          {onPreview && (
            <button
              type="button"
              className="text-primary text-xs underline"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onPreview(suggestion.startSeconds);
              }}
            >
              ▶ 试听
            </button>
          )}
        </div>
        <p className="mt-1">{suggestion.reason}</p>
      </div>
    </label>
  );
}

interface RoughCutPanelProps {
  episodeId: string;
  episodeDurationSeconds: number;
  onPreview?: (seconds: number) => void;
}

export function RoughCutPanel({
  episodeId,
  episodeDurationSeconds,
  onPreview,
}: RoughCutPanelProps) {
  const [roughCut, setRoughCut] = useState<RoughCutRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  async function refetch() {
    const supabase = createClient();
    const { data } = await supabase
      .from("rough_cuts")
      .select("*")
      .eq("episode_id", episodeId)
      .maybeSingle();
    setRoughCut(data);
    return data;
  }

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("rough_cuts")
      .select("*")
      .eq("episode_id", episodeId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setRoughCut(data);
      });
    return () => {
      cancelled = true;
    };
  }, [episodeId]);

  // 只在生成中/渲染中才轮询——ready 之后这一行只会被我们自己的操作改动，
  // 一直轮询反而会跟勾选框的乐观更新赛跑，把还没落库的本地状态覆盖掉，
  // 表现为"勾选了又消失"
  useEffect(() => {
    if (roughCut?.status !== "generating" && roughCut?.render_status !== "generating") return;
    let cancelled = false;
    const supabase = createClient();
    const interval = setInterval(async () => {
      const { data } = await supabase
        .from("rough_cuts")
        .select("*")
        .eq("episode_id", episodeId)
        .maybeSingle();
      if (!cancelled) setRoughCut(data);
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [episodeId, roughCut?.status, roughCut?.render_status]);

  useEffect(() => {
    if (roughCut?.render_status !== "ready" || !roughCut.audio_url) return;
    fetch(`/api/episodes/${episodeId}/rough-cut/audio-url`)
      .then((res) => res.json())
      .then((json) => setAudioUrl(json.url ?? null))
      .catch(() => setAudioUrl(null));
  }, [episodeId, roughCut?.render_status, roughCut?.audio_url]);

  async function generate() {
    setBusy(true);
    setMessage(null);
    // 生成接口是同步等 LLM 跑完才返回的，请求期间本地状态不会自己变——
    // 先乐观标成 generating，好让下面的"已等待 N 秒"计时器立刻显示，
    // 而不是要等整个请求结束后才看到状态变化
    setRoughCut((prev) =>
      prev ? { ...prev, status: "generating", updated_at: new Date().toISOString() } : prev,
    );
    try {
      const res = await fetch(`/api/episodes/${episodeId}/rough-cut/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction: instruction || undefined }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setMessage(json.error ?? "生成失败");
        await refetch();
        return;
      }
      setInstruction("");
      await refetch();
    } finally {
      setBusy(false);
    }
  }

  async function toggleSuggestion(id: string, checked: boolean) {
    // ready 状态下不再有轮询在跑（见上面的轮询 effect），所以这里可以放心直接读
    // 当前的 roughCut 闭包变量——不需要绕道 setState 的 updater 回调去拿"最新值"，
    // 那样反而不可靠：updater 什么时候真正执行不保证早于下面这行读 selectedIds，
    // 曾经导致发出空数组、把所有建议在数据库里整体清成未选中
    if (!roughCut) return;
    const suggestions = (roughCut.suggestions as unknown as StoredSuggestion[]).map((s) =>
      s.id === id ? { ...s, selected: checked } : s,
    );
    setRoughCut({ ...roughCut, suggestions: suggestions as unknown as RoughCutRow["suggestions"] });
    const selectedIds = suggestions.filter((s) => s.selected).map((s) => s.id);
    await fetch(`/api/episodes/${episodeId}/rough-cut/selection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectedIds }),
    });
  }

  async function render() {
    setRendering(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/rough-cut/render`, { method: "POST" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setMessage(json.error ?? "渲染失败");
        await refetch();
        return;
      }
      await refetch();
    } finally {
      setRendering(false);
    }
  }

  const status = roughCut?.status ?? "pending";

  if (status === "generating") {
    const elapsed = roughCut ? secondsSince(roughCut.updated_at) : 0;
    const stalled = elapsed > STALL_SECONDS;
    return (
      <div>
        <p className="text-muted-foreground text-sm">生成中...（已等待 {elapsed} 秒）</p>
        {stalled && (
          <Button size="sm" variant="outline" className="mt-2" onClick={generate} disabled={busy}>
            {busy ? "重试中..." : "等的有点久了，重试"}
          </Button>
        )}
      </div>
    );
  }

  if (status === "pending") {
    return (
      <div>
        <p className="text-muted-foreground mb-3 text-sm">
          AI 分析这期的填充词、长停顿、冗余内容等，给出粗剪建议——不是自动帮你剪好，是给你参考，
          你勾选采纳的部分会被真实剪掉，生成一版半成品音频，方便你拖进剪映等工具继续精修。
        </p>
        <Button size="sm" onClick={generate} disabled={busy}>
          {busy ? "生成中..." : "生成粗剪建议"}
        </Button>
        {message && <p className="text-destructive mt-2 text-sm">{message}</p>}
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div>
        <p className="text-destructive mb-2 text-sm">生成失败了</p>
        <Button size="sm" onClick={generate} disabled={busy}>
          {busy ? "重试中..." : "重试"}
        </Button>
      </div>
    );
  }

  const suggestions = (roughCut?.suggestions as unknown as StoredSuggestion[]) ?? [];
  const l1 = suggestions.filter((s) => s.layer === "L1");
  const l2 = suggestions.filter((s) => s.layer === "L2");
  const renderStatus = roughCut?.render_status ?? "pending";
  const renderElapsed = roughCut ? secondsSince(roughCut.updated_at) : 0;

  // 之前有人反馈"勾了跟没勾一样"——大部分 L1 单条都很短，全靠听不容易感知到差别，
  // 所以在勾选阶段就把预计剪掉/剩余的时长摆出来，不用等渲染完才知道到底剪了多少
  const cutRanges = suggestions
    .filter((s) => s.selected)
    .map((s) => ({ startSeconds: s.startSeconds, endSeconds: s.endSeconds }));
  const keptDuration = computeKeptRanges(cutRanges, episodeDurationSeconds).reduce(
    (sum, r) => sum + (r.endSeconds - r.startSeconds),
    0,
  );
  const cutDuration = episodeDurationSeconds - keptDuration;

  return (
    <div className="space-y-4">
      {roughCut?.outline_markdown && (
        <details className="rounded-xl border p-3" open>
          <summary className="cursor-pointer text-sm font-medium">内容结构大纲</summary>
          <pre className="mt-2 font-sans text-sm whitespace-pre-wrap">
            {roughCut.outline_markdown}
          </pre>
        </details>
      )}

      <p className="text-muted-foreground text-sm">
        原时长 {formatTimestamp(episodeDurationSeconds)} → 按当前勾选预计剪后{" "}
        <span className="text-foreground font-medium">{formatTimestamp(keptDuration)}</span>
        （剪掉约 {Math.round(cutDuration)} 秒）
      </p>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold">填充词 / 长停顿（L1，默认采纳）</h4>
        {l1.length === 0 && <p className="text-muted-foreground text-sm">没有检测到</p>}
        {l1.map((s) => (
          <SuggestionRow
            key={s.id}
            suggestion={s}
            onToggle={toggleSuggestion}
            onPreview={onPreview}
          />
        ))}
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold">内容判断（L2，逐条确认要不要采纳）</h4>
        {l2.length === 0 && (
          <p className="text-muted-foreground text-sm">没有识别到明显可删的内容</p>
        )}
        {l2.map((s) => (
          <SuggestionRow
            key={s.id}
            suggestion={s}
            onToggle={toggleSuggestion}
            onPreview={onPreview}
          />
        ))}
      </div>

      <div className="flex gap-2 border-t pt-3">
        <input
          className="flex-1 rounded-md border px-3 py-1.5 text-sm"
          placeholder="重roll指令，例如：再多删一些无关的闲聊"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
        />
        <Button size="sm" variant="outline" onClick={generate} disabled={busy}>
          {busy ? "处理中..." : "重新生成建议"}
        </Button>
      </div>

      <div className="border-t pt-3">
        {renderStatus === "pending" && (
          <Button size="sm" onClick={render} disabled={rendering}>
            {rendering ? "提交中..." : "生成粗剪音频"}
          </Button>
        )}
        {renderStatus === "generating" && (
          <p className="text-muted-foreground text-sm">
            粗剪音频渲染中...（已等待 {renderElapsed} 秒）
          </p>
        )}
        {renderStatus === "failed" && (
          <div>
            <p className="text-destructive mb-2 text-sm">渲染失败了</p>
            <Button size="sm" onClick={render} disabled={rendering}>
              {rendering ? "重试中..." : "重试"}
            </Button>
          </div>
        )}
        {renderStatus === "ready" && (
          <div className="space-y-2">
            {audioUrl && (
              <audio controls src={audioUrl} className="w-full">
                <track kind="captions" />
              </audio>
            )}
            <div className="flex gap-2">
              {audioUrl && (
                <a href={audioUrl} download className="text-sm underline">
                  下载粗剪音频
                </a>
              )}
              <Button size="sm" variant="outline" onClick={render} disabled={rendering}>
                {rendering ? "提交中..." : "按当前勾选重新生成"}
              </Button>
            </div>
          </div>
        )}
      </div>
      {message && <p className="text-destructive text-sm">{message}</p>}
    </div>
  );
}
