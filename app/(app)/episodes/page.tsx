import Link from "next/link";
import { createClient } from "@/lib/db/supabase/server";
import { getOwnShow } from "@/lib/services/show";
import { listEpisodes } from "@/lib/services/episode";
import { Button } from "@/components/ui/button";
import { EpisodesList } from "@/components/episode/episodes-list";
import { signOutAction } from "../new/actions";

export default async function EpisodesPage() {
  const supabase = await createClient();
  const { data: show } = await getOwnShow(supabase);
  const episodes = show ? ((await listEpisodes(supabase, show.id)).data ?? []) : [];

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-semibold">{show?.name ?? "我的节目"}</h1>
        <div className="flex items-center gap-2">
          <Button size="sm" nativeButton={false} render={<Link href="/new" />}>
            + 新建一期
          </Button>
          <form action={signOutAction}>
            <Button type="submit" variant="outline" size="sm">
              退出登录
            </Button>
          </form>
        </div>
      </div>

      <EpisodesList episodes={episodes} />
    </div>
  );
}
