// 独立技术验证脚本，不进主应用。用法：npm run spike-asr -- <本地音频文件路径>
// 依据 docs/12-ASR接入要点与设计影响.md 的硬约束实现，改动前请先读那份文档。
import { config } from "dotenv";
config({ path: ".env.local" });

import { execFile } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import OSS from "ali-oss";

const execFileAsync = promisify(execFile);

class SpikeError extends Error {}

class HttpError extends Error {
  constructor(
    public status: number,
    public body: string,
    message: string,
  ) {
    super(message);
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new SpikeError(`缺少环境变量 ${name}，请在 .env.local 中配置（参考 .env.example）`);
  }
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

function describeError(err: unknown): string {
  if (err instanceof HttpError) {
    return `${err.message}${err.body ? ` — ${err.body.slice(0, 500)}` : ""}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

// 5xx 和超时按指数退避重试；4xx（鉴权/参数错误）不重试，直接暴露给上层给出明确提示
interface RetryOptions {
  label: string;
  retries?: number;
  baseDelayMs?: number;
}

async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const retries = opts.retries ?? 4;
  const baseDelay = opts.baseDelayMs ?? 1000;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err instanceof HttpError ? err.status : undefined;
      const retryable = (status !== undefined && status >= 500) || isTimeoutError(err);
      if (attempt === retries || !retryable) {
        throw err;
      }
      const delay = baseDelay * 2 ** attempt;
      console.warn(`  ${opts.label} 失败（第 ${attempt + 1} 次），${delay}ms 后重试：${describeError(err)}`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

async function fetchJson(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<unknown> {
  const { timeoutMs = 30_000, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...rest, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) {
      throw new HttpError(res.status, text, `HTTP ${res.status} ${res.statusText}`);
    }
    return text ? JSON.parse(text) : undefined;
  } finally {
    clearTimeout(timer);
  }
}

async function runBinary(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync(cmd, args);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      throw new SpikeError(`未找到命令 ${cmd}，请先安装 ffmpeg（包含 ffprobe）`);
    }
    throw err;
  }
}

// ---- 一、ffprobe 探测 + 单声道转换（说话人分离仅支持单声道，硬约束 ★1）----

interface ProbeResult {
  channels: number;
  sampleRate: number;
  codecName: string;
  durationSec: number;
}

async function probeAudio(filePath: string): Promise<ProbeResult> {
  const { stdout } = await runBinary("ffprobe", [
    "-v", "error",
    "-print_format", "json",
    "-select_streams", "a:0",
    "-show_entries", "stream=channels,sample_rate,codec_name:format=duration",
    filePath,
  ]);
  const parsed = JSON.parse(stdout);
  const stream = parsed.streams?.[0];
  if (!stream) {
    throw new SpikeError(`ffprobe 没有探测到音频流：${filePath}，请确认文件未损坏`);
  }
  return {
    channels: Number(stream.channels),
    sampleRate: Number(stream.sample_rate),
    codecName: String(stream.codec_name),
    durationSec: Number(parsed.format?.duration ?? 0),
  };
}

async function ensureMono(filePath: string, channels: number): Promise<string> {
  if (channels === 1) {
    console.log("  音频已是单声道，跳过转换");
    return filePath;
  }
  console.log(`  检测到 ${channels} 声道，转换为单声道（说话人分离仅支持单声道）...`);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const outDir = path.join(path.dirname(filePath), ".spike-asr-tmp");
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${base}.mono${ext}`);
  await runBinary("ffmpeg", ["-y", "-i", filePath, "-ac", "1", outPath]);
  console.log(`  已生成单声道文件：${outPath}`);
  return outPath;
}

// ---- 二、上传 OSS 并生成签名 URL ----

function createOssClient(): OSS {
  return new OSS({
    region: requireEnv("ALIYUN_OSS_REGION"),
    accessKeyId: requireEnv("ALIYUN_ACCESS_KEY_ID"),
    accessKeySecret: requireEnv("ALIYUN_ACCESS_KEY_SECRET"),
    bucket: requireEnv("ALIYUN_OSS_BUCKET"),
  });
}

async function uploadAndSign(client: OSS, filePath: string): Promise<{ objectKey: string; signedUrl: string }> {
  const objectKey = `spike-asr/${Date.now()}-${path.basename(filePath)}`;
  await withRetry(() => client.put(objectKey, filePath), { label: "OSS 上传" });
  // 24h 有效，够 Fun-ASR 在任务窗口内多次拉取
  const signedUrl = client.signatureUrl(objectKey, { expires: 24 * 3600 });
  return { objectKey, signedUrl };
}

// ---- 三、Fun-ASR 异步转写：提交 -> 轮询 -> 下载（硬约束 ★2 关闭敏感词表 / ★3 URL 24h 有效）----

function getBaseUrl(): string {
  const workspaceId = requireEnv("DASHSCOPE_WORKSPACE_ID");
  return `https://${workspaceId}.cn-beijing.maas.aliyuncs.com/api/v1`;
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${requireEnv("DASHSCOPE_API_KEY")}`,
    "Content-Type": "application/json",
  };
}

// 官方文档未在 docs/12 中给出提交接口的具体路径后缀，这里按 DashScope 异步 ASR 的通用形状假设；
// 如百炼控制台文档给出的路径不同，可通过 DASHSCOPE_ASR_SUBMIT_PATH 覆盖，不用改代码。
const ASR_SUBMIT_PATH = process.env.DASHSCOPE_ASR_SUBMIT_PATH ?? "/services/audio/asr/transcription";

interface SubmitResponse {
  output?: { task_id?: string };
}

async function submitTranscription(audioUrl: string): Promise<string> {
  const baseUrl = getBaseUrl();
  let json: SubmitResponse;
  try {
    json = (await withRetry(
      () =>
        fetchJson(`${baseUrl}${ASR_SUBMIT_PATH}`, {
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
      { label: "提交转写任务" },
    )) as SubmitResponse;
  } catch (err) {
    const status = err instanceof HttpError ? err.status : undefined;
    if (status === 401 || status === 403) {
      throw new SpikeError(
        "鉴权失败：请检查 DASHSCOPE_API_KEY 是否为「华北2（北京）」地域的 Key，以及 DASHSCOPE_WORKSPACE_ID 是否正确",
      );
    }
    throw err;
  }
  const taskId = json.output?.task_id;
  if (!taskId) {
    throw new SpikeError(`提交转写任务返回异常，没有 task_id：${JSON.stringify(json)}`);
  }
  return taskId;
}

interface TaskStatusResponse {
  output?: {
    task_status?: string;
    message?: string;
    code?: string;
    results?: { transcription_url?: string }[];
    task_metrics?: unknown;
  };
}

async function pollTask(taskId: string): Promise<{ transcriptionUrl: string }> {
  const baseUrl = getBaseUrl();
  const pollIntervalMs = 3000;
  const maxWaitMs = 2 * 60 * 60 * 1000; // 与说话人分离建议的 2h 音频上限对齐
  const startedAt = Date.now();

  for (;;) {
    if (Date.now() - startedAt > maxWaitMs) {
      throw new SpikeError(`转写任务轮询超时（超过 ${maxWaitMs / 60_000} 分钟），task_id=${taskId}`);
    }
    const json = (await withRetry(
      () => fetchJson(`${baseUrl}/tasks/${taskId}`, { method: "GET", headers: authHeaders() }),
      { label: "查询任务状态" },
    )) as TaskStatusResponse;
    const status = json.output?.task_status;
    if (status === "SUCCEEDED") {
      const transcriptionUrl = json.output?.results?.[0]?.transcription_url;
      if (!transcriptionUrl) {
        throw new SpikeError(`任务成功但没有 transcription_url：${JSON.stringify(json.output)}`);
      }
      process.stdout.write("\n");
      return { transcriptionUrl };
    }
    if (status === "FAILED") {
      throw new SpikeError(`转写任务失败：${json.output?.message ?? json.output?.code ?? "未知原因"}（task_id=${taskId}）`);
    }
    const waitedSec = Math.round((Date.now() - startedAt) / 1000);
    process.stdout.write(`\r  任务状态：${status ?? "UNKNOWN"}（已等待 ${waitedSec}s）`);
    await sleep(pollIntervalMs);
  }
}

// 任务完成后必须立即下载并落盘，不能只存 URL（硬约束 ★3：24h 后失效）
async function downloadTranscript(url: string): Promise<unknown> {
  try {
    return await withRetry(() => fetchJson(url), { label: "下载转写结果 JSON" });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : undefined;
    if (status === 403 || status === 404) {
      throw new SpikeError("结果 URL 已过期或无法访问（transcription_url 仅 24 小时有效），需要重新提交转写任务");
    }
    throw err;
  }
}

// ---- 四、解析与格式化 ----

interface Sentence {
  beginTimeMs: number;
  endTimeMs: number;
  text: string;
  speakerId?: string | number;
}

function extractSentences(raw: unknown): Sentence[] {
  const transcripts = (raw as { transcripts?: unknown[] })?.transcripts ?? [];
  const sentences: Sentence[] = [];
  for (const transcript of transcripts) {
    const rawSentences = (transcript as { sentences?: unknown[] })?.sentences ?? [];
    for (const s of rawSentences) {
      const sentence = s as { begin_time: number; end_time: number; text?: string; speaker_id?: string | number };
      sentences.push({
        beginTimeMs: Number(sentence.begin_time),
        endTimeMs: Number(sentence.end_time),
        text: String(sentence.text ?? ""),
        speakerId: sentence.speaker_id,
      });
    }
  }
  sentences.sort((a, b) => a.beginTimeMs - b.beginTimeMs);
  return sentences;
}

function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const mm = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const ss = (totalSeconds % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

function formatReadableTranscript(sentences: Sentence[]): string {
  return sentences.map((s) => `[说话人${s.speakerId ?? "?"}][${formatTimestamp(s.beginTimeMs)}] ${s.text}`).join("\n");
}

function checkForMaskedText(sentences: Sentence[]): void {
  const masked = sentences.filter((s) => s.text.includes("*"));
  if (masked.length === 0) {
    console.log("✅ 未发现 * 打码痕迹（敏感词表已生效关闭）");
    return;
  }
  console.warn(`⚠️  发现 ${masked.length} 句包含 "*"，可能是系统敏感词表未关闭成功，请人工核对：`);
  for (const s of masked.slice(0, 5)) {
    console.warn(`  [${formatTimestamp(s.beginTimeMs)}] ${s.text}`);
  }
}

function printStats(opts: { durationSec: number; elapsedMs: number; sentences: Sentence[] }): void {
  const speakerCount = new Set(opts.sentences.map((s) => s.speakerId)).size;
  console.log("\n===== 统计 =====");
  console.log(`音频时长：${(opts.durationSec / 60).toFixed(1)} 分钟`);
  console.log(`总耗时：${(opts.elapsedMs / 1000).toFixed(1)} 秒`);
  console.log(`说话人数：${speakerCount}`);
  console.log(`句子数：${opts.sentences.length}`);
  const price = process.env.FUNASR_PRICE_PER_MINUTE_CNY;
  if (price) {
    const cost = (opts.durationSec / 60) * Number(price);
    console.log(`预估费用：约 ${cost.toFixed(2)} 元（按 ${price} 元/分钟估算）`);
  } else {
    console.log("预估费用：未配置 FUNASR_PRICE_PER_MINUTE_CNY，跳过估算");
  }
}

// ---- 五、主流程 ----

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("用法：npm run spike-asr -- <本地音频文件路径>");
    process.exitCode = 1;
    return;
  }
  try {
    await stat(inputPath);
  } catch {
    throw new SpikeError(`文件不存在：${inputPath}`);
  }

  const startedAt = Date.now();

  console.log("[1/6] ffprobe 探测音频...");
  const probe = await probeAudio(inputPath);
  console.log(
    `  声道数=${probe.channels} 采样率=${probe.sampleRate} 编码=${probe.codecName} 时长=${(probe.durationSec / 60).toFixed(1)}分钟`,
  );
  if (probe.durationSec > 2 * 3600) {
    console.warn("⚠️  音频时长超过 2 小时，说话人分离官方建议上限是 2 小时，可能识别失败或超时");
  }

  console.log("[2/6] 检查声道，需要时转换为单声道...");
  const monoPath = await ensureMono(inputPath, probe.channels);

  console.log("[3/6] 上传到 OSS 并生成签名 URL...");
  const ossClient = createOssClient();
  const { objectKey, signedUrl } = await uploadAndSign(ossClient, monoPath);
  console.log(`  已上传：${objectKey}`);

  console.log("[4/6] 提交 Fun-ASR 转写任务...");
  const taskId = await submitTranscription(signedUrl);
  console.log(`  task_id=${taskId}`);

  console.log("[5/6] 轮询任务状态...");
  const { transcriptionUrl } = await pollTask(taskId);
  console.log("  任务完成，立即下载结果...");
  const raw = await downloadTranscript(transcriptionUrl);

  console.log("[6/6] 落盘与格式化...");
  const outDir = path.join(process.cwd(), "output", "spike-asr");
  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rawPath = path.join(outDir, `${stamp}-raw.json`);
  const readablePath = path.join(outDir, `${stamp}-transcript.txt`);
  await writeFile(rawPath, JSON.stringify(raw, null, 2), "utf-8");

  const sentences = extractSentences(raw);
  await writeFile(readablePath, formatReadableTranscript(sentences), "utf-8");

  console.log(`  原始 JSON：${rawPath}`);
  console.log(`  可读转写稿：${readablePath}`);

  checkForMaskedText(sentences);
  printStats({ durationSec: probe.durationSec, elapsedMs: Date.now() - startedAt, sentences });
}

main().catch((err) => {
  console.error(`\n❌ 失败：${err instanceof SpikeError ? err.message : describeError(err)}`);
  process.exitCode = 1;
});
