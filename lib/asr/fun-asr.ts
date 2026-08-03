// Fun-ASR 客户端。硬约束和调用方式已经在任务 1.1 的 scripts/spike-asr.ts 里验证过，
// 这里是同一套逻辑的可复用版本（去掉 CLI 相关的部分）。
export class FunAsrError extends Error {}

class HttpError extends Error {
  constructor(
    public status: number,
    public body: string,
    message: string,
  ) {
    super(message);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  retries = 4,
  baseDelayMs = 1000,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err instanceof HttpError ? err.status : undefined;
      const retryable =
        (status !== undefined && status >= 500) ||
        (err instanceof Error && err.name === "AbortError");
      if (attempt === retries || !retryable) throw err;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastErr;
}

async function fetchJson(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<unknown> {
  const { timeoutMs = 30_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...rest, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, text, `HTTP ${res.status} ${res.statusText}`);
    return text ? JSON.parse(text) : undefined;
  } finally {
    clearTimeout(timer);
  }
}

function getBaseUrl(): string {
  return `https://${process.env.DASHSCOPE_WORKSPACE_ID}.cn-beijing.maas.aliyuncs.com/api/v1`;
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`,
    "Content-Type": "application/json",
  };
}

// docs/12 没给出提交接口的确切路径，按 DashScope 异步 ASR 的通用形状假设，
// 可以用 DASHSCOPE_ASR_SUBMIT_PATH 覆盖（跟 spike 脚本一样的处理方式）
const ASR_SUBMIT_PATH =
  process.env.DASHSCOPE_ASR_SUBMIT_PATH ?? "/services/audio/asr/transcription";

async function submitTranscription(audioUrl: string): Promise<string> {
  let json: { output?: { task_id?: string } };
  try {
    json = (await withRetry(
      () =>
        fetchJson(`${getBaseUrl()}${ASR_SUBMIT_PATH}`, {
          method: "POST",
          headers: { ...authHeaders(), "X-DashScope-Async": "enable" },
          body: JSON.stringify({
            model: "fun-asr",
            input: { file_urls: [audioUrl] },
            parameters: {
              diarization_enabled: true,
              language_hints: ["zh", "en"],
              channel_id: [0],
              // 硬约束 ★2：不传就是默认开启，命中词会被替换成等长 *
              special_word_filter: { system_reserved_filter: false },
            },
          }),
        }),
      "提交转写任务",
    )) as { output?: { task_id?: string } };
  } catch (err) {
    const status = err instanceof HttpError ? err.status : undefined;
    if (status === 401 || status === 403) {
      throw new FunAsrError("鉴权失败：检查 DASHSCOPE_API_KEY 是否为北京地域的 Key");
    }
    throw err;
  }
  const taskId = json.output?.task_id;
  if (!taskId) throw new FunAsrError(`提交转写任务没有返回 task_id：${JSON.stringify(json)}`);
  return taskId;
}

interface TaskStatusResponse {
  output?: {
    task_status?: string;
    message?: string;
    code?: string;
    results?: { transcription_url?: string }[];
  };
}

async function pollTaskUntilDone(
  taskId: string,
  onTick?: (status: string) => void,
): Promise<string> {
  const pollIntervalMs = 3000;
  const maxWaitMs = 2 * 60 * 60 * 1000; // 跟说话人分离建议的 2h 音频上限对齐
  const startedAt = Date.now();

  for (;;) {
    if (Date.now() - startedAt > maxWaitMs) {
      throw new FunAsrError(
        `转写任务轮询超时（超过 ${maxWaitMs / 60_000} 分钟），task_id=${taskId}`,
      );
    }
    const json = (await withRetry(
      () => fetchJson(`${getBaseUrl()}/tasks/${taskId}`, { method: "GET", headers: authHeaders() }),
      "查询任务状态",
    )) as TaskStatusResponse;
    const status = json.output?.task_status;
    if (status === "SUCCEEDED") {
      const url = json.output?.results?.[0]?.transcription_url;
      if (!url)
        throw new FunAsrError(`任务成功但没有 transcription_url：${JSON.stringify(json.output)}`);
      return url;
    }
    if (status === "FAILED") {
      throw new FunAsrError(
        `转写任务失败：${json.output?.message ?? json.output?.code ?? "未知原因"}`,
      );
    }
    onTick?.(status ?? "UNKNOWN");
    await sleep(pollIntervalMs);
  }
}

// 任务完成后必须立即下载并落盘，不能只存 URL（硬约束 ★3：24h 后失效，对应 docs/07 D10）
async function downloadTranscript(url: string): Promise<unknown> {
  try {
    return await withRetry(() => fetchJson(url), "下载转写结果 JSON");
  } catch (err) {
    const status = err instanceof HttpError ? err.status : undefined;
    if (status === 403 || status === 404) {
      throw new FunAsrError("结果 URL 已过期或无法访问（24 小时有效），需要重新提交转写任务");
    }
    throw err;
  }
}

export interface RawSentence {
  begin_time: number;
  end_time: number;
  text?: string;
  speaker_id?: string | number;
  emotion?: string;
  // Fun-ASR 每句带一个整体置信度；具体字段名没有实测确认过，做兜底解析
  confidence?: number;
}

export interface RawTranscript {
  transcripts?: { sentences?: RawSentence[] }[];
}

export async function transcribeAudio(
  audioUrl: string,
  onPollTick?: (status: string) => void,
): Promise<RawTranscript> {
  const taskId = await submitTranscription(audioUrl);
  const transcriptionUrl = await pollTaskUntilDone(taskId, onPollTick);
  const raw = await downloadTranscript(transcriptionUrl);
  return raw as RawTranscript;
}
