import { describe, expect, it } from "vitest";
import { normalizeUrl } from "../src/evidence/normalize-url.js";

describe("normalizeUrl", () => {
  it("lowercases host and removes hash fragments", () => {
    expect(normalizeUrl("https://Example.COM/Path/Page#section")).toBe("https://example.com/Path/Page");
  });

  it("removes common tracking parameters and preserves meaningful query params", () => {
    expect(normalizeUrl("https://example.com/a?utm_source=x&id=42&gclid=abc&utm_content=z")).toBe("https://example.com/a?id=42");
  });

  it("trims trailing slash from non-root paths", () => {
    expect(normalizeUrl("https://example.com/docs/")).toBe("https://example.com/docs");
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com/");
  });

  it("adds https for bare host input", () => {
    expect(normalizeUrl("Example.com/docs?fbclid=1&q=test")).toBe("https://example.com/docs?q=test");
  });
});
