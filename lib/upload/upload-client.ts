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
const PARALLEL_UPLOADS = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function relayUploadChunk(
  sessionId: string,
  partNo: number,
  chunk: Blob,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/uploads/${sessionId}/parts/${partNo}`, {
    method: "PUT",
    body: chunk,
    signal,
  });
  if (res.ok) return;
  if (res.status === 410) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error ?? "上传会话已失效，请重新开始");
  }
  throw new Error(`分片 ${partNo} 上传失败（HTTP ${res.status}）`);
}

async function directUploadChunk(
  sessionId: string,
  partNo: number,
  chunk: Blob,
  signal?: AbortSignal,
): Promise<void> {
  const signRes = await fetch(`/api/uploads/${sessionId}/parts/${partNo}`, { signal });
  if (!signRes.ok) {
    const json = await signRes.json().catch(() => ({}));
    throw new Error(json.error ?? "创建上传链接失败");
  }
  const { uploadUrl } = (await signRes.json()) as { uploadUrl?: string };
  if (!uploadUrl) throw new Error("创建上传链接失败");

  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    body: chunk,
    signal,
  });
  if (!uploadRes.ok) {
    throw new Error(`分片 ${partNo} 直传失败（HTTP ${uploadRes.status}）`);
  }

  const etag = uploadRes.headers.get("ETag") ?? uploadRes.headers.get("etag");
  if (!etag) {
    throw new Error("OSS 没有暴露 ETag，请检查 Bucket CORS 的 ExposeHeader");
  }

  const recordRes = await fetch(`/api/uploads/${sessionId}/parts/${partNo}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ etag }),
    signal,
  });
  if (!recordRes.ok) {
    const json = await recordRes.json().catch(() => ({}));
    throw new Error(json.error ?? "记录分片失败");
  }
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
      try {
        await directUploadChunk(sessionId, partNo, chunk, signal);
      } catch {
        await relayUploadChunk(sessionId, partNo, chunk, signal);
      }
      return;
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

  const pendingPartNumbers = Array.from({ length: totalChunks }, (_, i) => i + 1).filter(
    (partNo) => !alreadyUploaded.has(partNo),
  );
  let cursor = 0;

  async function uploadNextChunk(): Promise<void> {
    while (cursor < pendingPartNumbers.length) {
      const partNo = pendingPartNumbers[cursor++];
      if (partNo === undefined) return;
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
  }

  await Promise.all(
    Array.from({ length: Math.min(PARALLEL_UPLOADS, pendingPartNumbers.length) }, () =>
      uploadNextChunk(),
    ),
  );

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
