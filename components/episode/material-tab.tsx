"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Database } from "@/lib/db/database.types";
import type { TitleContent } from "@/prompts/title";
import type { ShownotesContent } from "@/prompts/shownotes";
import type { ChaptersContent } from "@/prompts/chapters";
import type { NoteContent } from "@/prompts/note";

type MaterialRow = Database["public"]["Tables"]["materials"]["Row"];
type MaterialType = "title" | "shownotes" | "chapters" | "note";

interface MaterialTabProps {
  episodeId: string;
  type: MaterialType;
  material: MaterialRow | null;
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// 单次生成正常情况下不会超过这个时长（长逐字稿也是一次 Qwen 调用），
// 超过了大概率是请求半路挂了（比如 serverless 超时），而不是还在正常跑
const STALL_SECONDS = 90;

function secondsSince(isoTime: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(isoTime).getTime()) / 1000));
}

function ContentView({ type, content }: { type: MaterialType; content: unknown }) {
  if (!content) return null;

  if (type === "title") {
    const c = content as TitleContent;
    return (
      <div className="space-y-2">
        {c.candidates.map((cand, i) => (
          <div key={i} className="rounded-md border p-3">
            <span className="bg-muted mr-2 rounded px-1.5 py-0.5 text-xs">{cand.style}</span>
            {cand.title}
          </div>
        ))}
      </div>
    );
  }

  if (type === "shownotes") {
    const c = content as ShownotesContent;
    return (
      <div className="space-y-3 text-sm">
        <div>
          <div className="text-muted-foreground mb-1 font-medium">简介</div>
          {c.intro}
        </div>
        {c.guestIntro && (
          <div>
            <div className="text-muted-foreground mb-1 font-medium">嘉宾介绍</div>
            {c.guestIntro}
          </div>
        )}
        {c.mentions.length > 0 && (
          <div>
            <div className="text-muted-foreground mb-1 font-medium">提及清单</div>
            <ul className="list-disc pl-5">
              {c.mentions.map((m, i) => (
                <li key={i}>
                  {m.name}（{m.type}）{m.note && ` - ${m.note}`}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  if (type === "chapters") {
    const c = content as ChaptersContent;
    return (
      <ul className="space-y-1 text-sm">
        {c.chapters.map((ch, i) => (
          <li key={i}>
            <span className="text-muted-foreground mr-2 font-mono">
              [{formatTimestamp(ch.startSeconds)}]
            </span>
            {ch.title}
          </li>
        ))}
      </ul>
    );
  }

  const c = content as NoteContent;
  return (
    <div className="space-y-2 text-sm">
      <div className="font-medium">{c.title}</div>
      <p className="whitespace-pre-wrap">{c.body}</p>
      <div className="text-primary">{c.hashtags.map((h) => `#${h}`).join("  ")}</div>
    </div>
  );
}

export function MaterialTab({ episodeId, type, material }: MaterialTabProps) {
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const status = material?.status ?? "pending";

  async function reroll() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/materials/${type}/generate`, {
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

  async function confirm() {
    await fetch(`/api/episodes/${episodeId}/materials/${type}/confirm`, { method: "POST" });
  }

  function startEdit() {
    setEditValue(JSON.stringify(material?.content ?? {}, null, 2));
    setEditing(true);
  }

  async function saveEdit() {
    setBusy(true);
    setMessage(null);
    try {
      const parsed = JSON.parse(editValue);
      const res = await fetch(`/api/episodes/${episodeId}/materials/${type}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: parsed }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setMessage(json.error ?? "保存失败");
        return;
      }
      setEditing(false);
    } catch {
      setMessage("JSON 格式不对");
    } finally {
      setBusy(false);
    }
  }

  if (status === "generating") {
    const elapsed = material ? secondsSince(material.updated_at) : 0;
    const stalled = elapsed > STALL_SECONDS;
    return (
      <div>
        <p className="text-muted-foreground text-sm">生成中...（已等待 {elapsed} 秒）</p>
        {stalled && (
          <div className="mt-2">
            <p className="text-muted-foreground text-xs">
              等的有点久了，可能是中途失败了，可以直接重试
            </p>
            <Button size="sm" variant="outline" className="mt-1" onClick={reroll} disabled={busy}>
              {busy ? "重试中..." : "重试"}
            </Button>
          </div>
        )}
        {message && <p className="text-destructive mt-2 text-sm">{message}</p>}
      </div>
    );
  }

  // material 为 null 说明这个类型还从来没触发过生成——可能是转写完成时的自动触发链路
  // 没覆盖到（比如这期是功能上线前就转写完的老 episode），不能一直卡在无操作的状态
  if (status === "pending") {
    return (
      <div>
        <Button size="sm" onClick={reroll} disabled={busy}>
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
        <Button size="sm" onClick={reroll} disabled={busy}>
          重试
        </Button>
      </div>
    );
  }

  return (
    <div>
      {editing ? (
        <div className="space-y-2">
          <Textarea
            rows={12}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            className="font-mono text-xs"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={saveEdit} disabled={busy}>
              保存
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)}>
              取消
            </Button>
          </div>
        </div>
      ) : (
        <ContentView type={type} content={material?.content} />
      )}

      {!editing && (
        <div className="mt-4 space-y-3">
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-md border px-3 py-1.5 text-sm"
              placeholder="重roll指令，例如：更口语点"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
            />
            <Button size="sm" variant="outline" onClick={reroll} disabled={busy}>
              {busy ? "处理中..." : "重新生成"}
            </Button>
            <Button size="sm" variant="outline" onClick={startEdit}>
              编辑
            </Button>
            <Button size="sm" onClick={confirm} disabled={!!material?.confirmed_at}>
              {material?.confirmed_at ? "已确认" : "确认"}
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">当前版本 v{material?.version ?? 1}</p>
        </div>
      )}
      {message && <p className="text-destructive mt-2 text-sm">{message}</p>}
    </div>
  );
}
