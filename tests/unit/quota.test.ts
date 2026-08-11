import { describe, expect, it } from "vitest";
import { isUnlimitedQuotaEmail } from "@/lib/services/quota";

describe("isUnlimitedQuotaEmail", () => {
  it("grants unlimited quota to syx@qq.com", () => {
    expect(isUnlimitedQuotaEmail("syx@qq.com")).toBe(true);
  });

  it("normalizes case and whitespace", () => {
    expect(isUnlimitedQuotaEmail("  SYX@qq.com ")).toBe(true);
  });

  it("does not grant unlimited quota to other accounts", () => {
    expect(isUnlimitedQuotaEmail("someone@example.com")).toBe(false);
    expect(isUnlimitedQuotaEmail(null)).toBe(false);
  });
});
