// LLM 适配层：百炼 Qwen，走 OpenAI 兼容模式（接口形状是文档化稳定的，比猜原生百炼接口靠谱，
// 已经实测跑通过，见 docs/decisions/ 目录）。以后要换 DeepSeek 只用改这一个文件。
import type { ZodType } from "zod";

export class AiGenerationError extends Error {}

export interface GenerateStructuredInput<T> {
  system: string;
  user: string;
  schema: ZodType<T>;
  model?: string;
}

// 架构铁律 #7：外部响应必过 zod 校验，坏数据自动重试 1 次
export async function generateStructured<T>({
  system,
  user,
  schema,
  model = "qwen-plus",
}: GenerateStructuredInput<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    let content: string;
    try {
      content = await callQwen(system, user, model);
    } catch (err) {
      lastError = err;
      continue;
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(content);
    } catch {
      lastError = new AiGenerationError(`LLM 没有返回合法 JSON: ${content.slice(0, 200)}`);
      continue;
    }

    const result = schema.safeParse(parsedJson);
    if (result.success) {
      return result.data;
    }
    lastError = new AiGenerationError(`LLM 输出不满足 schema: ${result.error.message}`);
  }
  throw lastError instanceof Error ? lastError : new AiGenerationError("生成失败");
}

async function callQwen(system: string, user: string, model: string): Promise<string> {
  const res = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new AiGenerationError(`Qwen 调用失败 HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = await res.json();
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new AiGenerationError(`Qwen 返回格式不对: ${JSON.stringify(json).slice(0, 300)}`);
  }
  return content;
}
