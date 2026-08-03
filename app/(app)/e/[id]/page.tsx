import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/db/supabase/server";
import { ProcessingPage } from "@/components/episode/processing-page";
import { EpisodeInfoCard } from "@/components/upload/episode-info-card";

export default async function EpisodePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: episode } = await supabase
    .from("episodes")
    .select(
      "id, status, audio_url, duration_seconds, transcript, speaker_count, low_confidence, episode_no, show_id, generate_materials",
    )
    .eq("id", id)
    .single();

  if (!episode) {
    notFound();
  }

  const { data: show } = await supabase
    .from("shows")
    .select("name")
    .eq("id", episode.show_id)
    .single();

  // 音频已经传完但还没点「开始生成」（比如上传完就关掉了页面）——回到信息卡让用户接着填、接着开始，
  // 不是重新走一遍上传
  if (episode.status === "uploaded") {
    return (
      <main className="mx-auto max-w-md p-8">
        <Link href="/episodes" className="text-muted-foreground mb-4 block text-sm hover:underline">
          ← 我的节目
        </Link>
        <EpisodeInfoCard
          showName={show?.name ?? ""}
          episodeNo={episode.episode_no ?? 1}
          episodeId={episode.id}
        />
      </main>
    );
  }

  return <ProcessingPage episodeId={id} initialEpisode={episode} showName={show?.name ?? ""} />;
}
