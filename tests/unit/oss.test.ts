import { describe, expect, it } from "vitest";
import { buildContentDisposition } from "@/lib/storage/oss";

describe("buildContentDisposition", () => {
  it("ASCII 文件名两个字段一致", () => {
    expect(buildContentDisposition("clip.mp3")).toBe(
      `attachment; filename="clip.mp3"; filename*=UTF-8''clip.mp3`,
    );
  });

  it("中文文件名：ASCII 兜底字段替换成下划线，filename* 保留完整 UTF-8 编码", () => {
    const result = buildContentDisposition("我送捧花时哭了.mp3");
    expect(result).toContain(
      `filename="`.concat("_".repeat("我送捧花时哭了".length)).concat(".mp3"),
    );
    expect(result).toContain(`filename*=UTF-8''${encodeURIComponent("我送捧花时哭了.mp3")}`);
  });

  it("去掉换行/分号/引号，防止 header 注入", () => {
    const result = buildContentDisposition('evil\r\nfilename;"x.mp3');
    // 输入里的换行/分号/引号必须被剥离，不能原样进到最终的 header 值里
    expect(result).not.toContain("\r");
    expect(result).not.toContain("\n");
    expect(result).not.toContain(";x.mp3");
    expect(result).toBe(
      `attachment; filename="evilfilenamex.mp3"; filename*=UTF-8''${encodeURIComponent("evilfilenamex.mp3")}`,
    );
  });

  it("清理后文件名整个变空时，ASCII 兜底给一个默认名而不是空字符串", () => {
    const result = buildContentDisposition('";\r\n');
    expect(result).toContain(`filename="download.mp3"`);
  });
});
