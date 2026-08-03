import { describe, expect, it } from "vitest";
import { validateDuration, validateFileBasics } from "@/lib/upload/validate";

function fakeFile(name: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], name);
}

describe("validateFileBasics", () => {
  it("rejects unsupported extensions", () => {
    const result = validateFileBasics(fakeFile("clip.mov", 1024));
    expect(result?.message).toContain("不支持");
  });

  it("accepts supported extensions under the size limit", () => {
    expect(validateFileBasics(fakeFile("episode.mp3", 1024))).toBeNull();
  });

  it("rejects files over 500MB", () => {
    const result = validateFileBasics(fakeFile("huge.mp3", 501 * 1024 * 1024));
    expect(result?.message).toContain("超过 500MB");
  });
});

describe("validateDuration", () => {
  it("rejects durations over 2 hours", () => {
    const result = validateDuration(2 * 60 * 60 + 1);
    expect(result?.message).toContain("超过 2 小时");
  });

  it("accepts durations at or under 2 hours", () => {
    expect(validateDuration(2 * 60 * 60)).toBeNull();
  });
});
