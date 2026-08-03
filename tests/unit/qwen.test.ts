import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { generateStructured } from "@/lib/ai/qwen";

function mockChatResponse(content: string) {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  } as Response;
}

const schema = z.object({ value: z.number() });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("generateStructured", () => {
  it("returns parsed content when the first response already matches the schema", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockChatResponse('{"value": 42}'));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateStructured({ system: "s", user: "u", schema });
    expect(result).toEqual({ value: 42 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // 架构铁律 #7：坏数据自动重试 1 次
  it("retries once when the first response fails schema validation, then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockChatResponse('{"value": "not a number"}'))
      .mockResolvedValueOnce(mockChatResponse('{"value": 7}'));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateStructured({ system: "s", user: "u", schema });
    expect(result).toEqual({ value: 7 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws after the retry also fails validation, without a third attempt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockChatResponse('{"value": "still bad"}'));
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateStructured({ system: "s", user: "u", schema })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries when the LLM doesn't return valid JSON at all", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockChatResponse("not json at all"))
      .mockResolvedValueOnce(mockChatResponse('{"value": 1}'));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateStructured({ system: "s", user: "u", schema });
    expect(result).toEqual({ value: 1 });
  });
});
