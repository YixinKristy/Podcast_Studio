import { createClient } from "@/lib/db/supabase/server";
import { getOwnShow } from "@/lib/services/show";
import { nextEpisodeNo } from "@/lib/services/upload";
import { Button } from "@/components/ui/button";
import { NewEpisodePage } from "@/components/upload/new-episode-page";
import { signOutAction } from "./actions";

export default async function UploadPage() {
  const supabase = await createClient();
  const { data: show } = await getOwnShow(supabase);
  const episodeNo = show ? await nextEpisodeNo(supabase, show.id) : 1;

  return (
    <div>
      <div className="flex justify-end p-4">
        <form action={signOutAction}>
          <Button type="submit" variant="outline" size="sm">
            退出登录
          </Button>
        </form>
      </div>
      <NewEpisodePage showName={show?.name ?? ""} episodeNo={episodeNo} />
    </div>
  );
}
