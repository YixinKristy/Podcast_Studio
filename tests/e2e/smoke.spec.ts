import { test, expect } from "@playwright/test";

test("marketing page loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "播客后期分发助手" })).toBeVisible();
});
