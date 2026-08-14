import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContentView } from "@/components/episode/material-tab";

describe("ContentView", () => {
  it("does not crash when chapters content is an empty object", () => {
    const html = renderToStaticMarkup(
      createElement(ContentView, { type: "chapters", content: {} }),
    );
    expect(html).toContain("内容格式异常");
  });

  it("does not crash when shownotes mentions content is an empty object", () => {
    const html = renderToStaticMarkup(
      createElement(ContentView, { type: "shownotes_mentions", content: {} }),
    );
    expect(html).toContain("内容格式异常");
  });
});
