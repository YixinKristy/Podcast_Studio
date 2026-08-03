import { notFound } from "next/navigation";
import { createClient } from "@/lib/db/supabase/server";
import { ProcessingPage } from "@/components/episode/processing-page";

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

  return <ProcessingPage episodeId={id} initialEpisode={episode} showName={show?.name ?? ""} />;
}
