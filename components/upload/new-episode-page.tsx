"use client";

import { useState } from "react";
import { UploadZone } from "./upload-zone";
import { EpisodeInfoCard } from "./episode-info-card";

interface NewEpisodePageProps {
  showName: string;
  episodeNo: number;
}

export function NewEpisodePage({ showName, episodeNo }: NewEpisodePageProps) {
  const [episodeId, setEpisodeId] = useState<string | null>(null);

  return (
    <main className="mx-auto grid max-w-5xl grid-cols-1 gap-6 p-8 md:grid-cols-5">
      <div className="md:col-span-3">
        <UploadZone onUploaded={setEpisodeId} />
      </div>
      <div className="md:col-span-2">
        <EpisodeInfoCard showName={showName} episodeNo={episodeNo} episodeId={episodeId} />
      </div>
    </main>
  );
}
