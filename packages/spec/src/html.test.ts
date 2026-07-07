import { describe, expect, it } from "vitest";
import { decodeAttr, encodeAttr } from "./index.js";

describe("HTML attribute encode/decode (§5.4)", () => {
  const cases = [
    "plain text",
    'a "quoted" value',
    "angle < brackets > here",
    "ampersand & more",
    'everything & < > " together',
    "it's an apostrophe",
  ];

  for (const value of cases) {
    it(`round-trips ${JSON.stringify(value)}`, () => {
      expect(decodeAttr(encodeAttr(value))).toBe(value);
    });
  }

  it("encodes the four reserved characters", () => {
    expect(encodeAttr('& < > "')).toBe("&amp; &lt; &gt; &quot;");
  });

  it("does not double-decode an encoded ampersand", () => {
    // A literal `&quot;` text encodes to `&amp;quot;` and must decode back exactly.
    expect(decodeAttr(encodeAttr("&quot;"))).toBe("&quot;");
  });
});
