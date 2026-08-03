import { quickHash } from "./hash";

export interface UploadProgress {
  uploadedChunks: number;
  totalChunks: number;
  bytesUploaded: number;
  totalBytes: number;
}

export type UploadOutcome =
  | { status: "duplicate"; episodeId: string; episodeNo: number | null; createdAt: string }
  | { status: "done"; episodeId: string };

interface InitResponse {
  kind: "duplicate" | "resume" | "new";
  episodeId?: string;
  episodeNo?: number | null;
  createdAt?: string;
  sessionId?: string;
  uploadedPartNumbers?: number[];
  chunkSize?: number;
  totalChunks?: number;
}

const MAX_RETRIES = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function uploadChunkWithRetry(
  sessionId: string,
  partNo: number,
  chunk: Blob,
  signal?: AbortSignal,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (signal?.aborted) throw new DOMException("aborted", "AbortError");
    try {
      const res = await fetch(`/api/uploads/${sessionId}/parts/${partNo}`, {
        method: "PUT",
        body: chunk,
        signal,
      });
      if (res.ok) return;
      if (res.status === 410) {
        // 会话过期/不存在，重试没意义
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "上传会话已失效，请重新开始");
      }
      lastError = new Error(`分片 ${partNo} 上传失败（HTTP ${res.status}）`);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      lastError = err;
    }
    if (attempt < MAX_RETRIES) {
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("分片上传失败");
}

// C3：中途断网 —— 每个分片自带重试；C3 重进页面续传 —— 同一份文件的 hash 命中未完成 session，
// 服务端返回已传分片列表，这里只补传剩下的，不用从头传。
export async function uploadEpisodeFile(
  file: File,
  opts: { onProgress?: (p: UploadProgress) => void; signal?: AbortSignal } = {},
): Promise<UploadOutcome> {
  const contentHash = await quickHash(file);

  const initRes = await fetch("/api/uploads/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contentHash,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
    }),
  });
  if (!initRes.ok) {
    const json = await initRes.json().catch(() => ({}));
    throw new Error(json.error ?? "初始化上传失败");
  }
  const init: InitResponse = await initRes.json();

  if (init.kind === "duplicate") {
    return {
      status: "duplicate",
      episodeId: init.episodeId!,
      episodeNo: init.episodeNo ?? null,
      createdAt: init.createdAt!,
    };
  }

  const sessionId = init.sessionId!;
  const chunkSize = init.chunkSize!;
  const totalChunks = init.totalChunks!;
  const alreadyUploaded = new Set(init.uploadedPartNumbers ?? []);

  opts.onProgress?.({
    uploadedChunks: alreadyUploaded.size,
    totalChunks,
    bytesUploaded: alreadyUploaded.size * chunkSize,
    totalBytes: file.size,
  });

  for (let partNo = 1; partNo <= totalChunks; partNo++) {
    if (alreadyUploaded.has(partNo)) continue;

    const start = (partNo - 1) * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const chunk = file.slice(start, end);

    await uploadChunkWithRetry(sessionId, partNo, chunk, opts.signal);

    alreadyUploaded.add(partNo);
    opts.onProgress?.({
      uploadedChunks: alreadyUploaded.size,
      totalChunks,
      bytesUploaded: Math.min(alreadyUploaded.size * chunkSize, file.size),
      totalBytes: file.size,
    });
  }

  const completeRes = await fetch(`/api/uploads/${sessionId}/complete`, {
    method: "POST",
    signal: opts.signal,
  });
  if (!completeRes.ok) {
    const json = await completeRes.json().catch(() => ({}));
    throw new Error(json.error ?? "完成上传失败");
  }
  const completeJson = await completeRes.json();
  return { status: "done", episodeId: completeJson.episodeId };
}
