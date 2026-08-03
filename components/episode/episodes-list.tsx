"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { Database } from "@/lib/db/database.types";

type EpisodeRow = Pick<
  Database["public"]["Tables"]["episodes"]["Row"],
  "id" | "episode_no" | "status" | "duration_seconds" | "created_at"
>;

interface EpisodesListProps {
  episodes: EpisodeRow[];
}

const STATUS_LABEL: Record<string, { text: string; className: string }> = {
  uploaded: { text: "待开始", className: "bg-muted text-muted-foreground" },
  transcribing: { text: "处理中", className: "bg-blue-50 text-blue-700" },
  generating: { text: "处理中", className: "bg-blue-50 text-blue-700" },
  transcribe_failed: { text: "失败", className: "bg-destructive/10 text-destructive" },
  ready: { text: "待校对", className: "bg-yellow-50 text-yellow-800" },
  published: { text: "已发布", className: "bg-green-50 text-green-700" },
};

function formatDuration(seconds: number | null): string {
  if (!seconds) return "";
  const m = Math.round(seconds / 60);
  return `${m} 分钟`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function EpisodesList({ episodes }: EpisodesListProps) {
  const router = useRouter();
  const [retryingId, setRetryingId] = useState<string | null>(null);

  if (episodes.length === 0) {
    return (
      <div className="rounded-xl border p-12 text-center">
        <p className="font-medium">还没有上传过节目</p>
        <p className="text-muted-foreground mt-1 text-sm">上传第一期，10 分钟后来拿物料</p>
        <Button className="mt-4" nativeButton={false} render={<Link href="/new" />}>
          上传第一期
        </Button>
      </div>
    );
  }

  async function retry(episodeId: string) {
    setRetryingId(episodeId);
    try {
      const res = await fetch(`/api/episodes/${episodeId}/start`, { method: "POST" });
      if (res.ok) {
        router.push(`/e/${episodeId}`);
      }
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <div className="space-y-3">
      {episodes.map((ep) => {
        const status = STATUS_LABEL[ep.status] ?? { text: ep.status, className: "bg-muted" };
        const isFailed = ep.status === "transcribe_failed";

        return (
          <div key={ep.id} className="flex items-center justify-between rounded-xl border p-4">
            <Link href={`/e/${ep.id}`} className="flex-1">
              <div className="font-medium">第 {ep.episode_no} 期</div>
              <div className="text-muted-foreground mt-1 text-sm">
                {formatDate(ep.created_at)}
                {ep.duration_seconds ? ` · ${formatDuration(ep.duration_seconds)}` : ""}
              </div>
              {isFailed && (
                <div className="text-destructive mt-1 text-sm">
                  没识别到足够的人声，或转写服务出错，额度已退回
                </div>
              )}
            </Link>
            <div className="flex items-center gap-3">
              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${status.className}`}>
                {status.text}
              </span>
              {isFailed && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={retryingId === ep.id}
                  onClick={() => retry(ep.id)}
                >
                  {retryingId === ep.id ? "重试中..." : "重试"}
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
