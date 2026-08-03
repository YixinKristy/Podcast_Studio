"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const MATERIAL_LABELS: Record<string, string> = {
  title: "标题",
  cover: "封面",
  shownotes: "Shownotes",
  chapters: "章节",
  quotes: "金句卡",
  clips: "切片",
  note: "宣传笔记",
};
const ALL_MATERIALS = Object.keys(MATERIAL_LABELS);

interface EpisodeInfoCardProps {
  showName: string;
  episodeNo: number;
  episodeId: string | null;
  onStartGenerate?: () => void;
}

export function EpisodeInfoCard({
  showName,
  episodeNo,
  episodeId,
  onStartGenerate,
}: EpisodeInfoCardProps) {
  const router = useRouter();
  const [promoteNote, setPromoteNote] = useState("");
  const [guestName, setGuestName] = useState("");
  const [materials, setMaterials] = useState<string[]>(ALL_MATERIALS);
  const [moreOpen, setMoreOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function toggleMaterial(key: string) {
    setMaterials((prev) => (prev.includes(key) ? prev.filter((m) => m !== key) : [...prev, key]));
  }

  async function submit() {
    if (!episodeId) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/episodes/${episodeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          promoteNote,
          guests: guestName ? [{ name: guestName }] : [],
          generateMaterials: materials,
        }),
      });
      if (!res.ok) {
        setMessage("保存失败，稍后再试");
        return;
      }

      const startRes = await fetch(`/api/episodes/${episodeId}/start`, { method: "POST" });
      if (!startRes.ok) {
        const json = await startRes.json().catch(() => ({}));
        setMessage(json.error ?? "开始生成失败，稍后再试");
        return;
      }

      onStartGenerate?.();
      router.push(`/e/${episodeId}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 rounded-xl border p-5">
      <div className="text-muted-foreground border-b pb-3 text-sm">
        {showName} · 第 {episodeNo} 期
      </div>

      <div className="space-y-2">
        <Label htmlFor="promote-note">这期想宣传/传达什么？（填了会明显更准）</Label>
        <Textarea
          id="promote-note"
          rows={4}
          placeholder="核心想推嘉宾『稳定是幻觉』的暴论；想吸引正在犹豫离职的听众"
          value={promoteNote}
          onChange={(e) => setPromoteNote(e.target.value)}
        />
      </div>

      <Collapsible open={moreOpen} onOpenChange={setMoreOpen}>
        <CollapsibleTrigger className="text-sm underline">
          更多设置 {moreOpen ? "▴" : "▾"}
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3 space-y-4">
          <div className="space-y-2">
            <Label htmlFor="guest-name">本期嘉宾（常驻说话人不用填）</Label>
            <Input
              id="guest-name"
              placeholder="嘉宾名字"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>生成项</Label>
            <div className="grid grid-cols-2 gap-2">
              {ALL_MATERIALS.map((key) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={materials.includes(key)}
                    onCheckedChange={() => toggleMaterial(key)}
                  />
                  {MATERIAL_LABELS[key]}
                </label>
              ))}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Button className="w-full" disabled={!episodeId || saving} onClick={submit}>
        {episodeId ? (saving ? "处理中..." : "开始生成") : "上传完自动开始"}
      </Button>
      {message && <p className="text-muted-foreground text-sm">{message}</p>}
    </div>
  );
}
